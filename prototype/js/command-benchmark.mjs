import { createHash } from "node:crypto";
import * as zlib from "node:zlib";
import { decodeVideoTimeline } from "./container.mjs";
import {
  applyPackedCommands, buildCommandTrace, encodePackedCommands, measurePackedCommands
} from "./grammar-b.mjs";
import { measureFrameCommands } from "./commands.mjs";
import {
  decodeCanonicalHuffman, encodeCanonicalHuffman
} from "./canonical-huffman.mjs";

const REPORT_VERSION = "V64-COMMAND-SHOOTOUT-1";

function equalBytes(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function mergeCounts(target, source) {
  for (const [name, value] of Object.entries(source)) target[name] = (target[name] || 0) + value;
}

function frameRecord(kind, commands) {
  const header = Buffer.alloc(5);
  header[0] = kind;
  header.writeUInt32LE(commands.length, 1);
  return Buffer.concat([header, commands]);
}

function compressionPercent(before, after) {
  return before ? Number(((before - after) / before * 100).toFixed(3)) : 0;
}

function deflateFrames(payloads) {
  let rawDeflateBytes = 0;
  let selectiveStoredBytes = 0;
  let selectedFrames = 0;
  for (const payload of payloads) {
    const compressed = zlib.deflateRawSync(payload, { level: 9 });
    rawDeflateBytes += compressed.length;
    if (compressed.length + 8 < payload.length) {
      selectiveStoredBytes += compressed.length;
      selectedFrames += 1;
    } else selectiveStoredBytes += payload.length;
  }
  return { rawDeflateBytes, selectiveStoredBytes, selectedFrames };
}

function deflateGroups(groups) {
  let inputBytes = 0;
  let compressedBytes = 0;
  for (const records of groups) {
    const input = Buffer.concat(records);
    inputBytes += input.length;
    compressedBytes += zlib.deflateRawSync(input, { level: 9 }).length;
  }
  return { inputBytes, compressedBytes, groupCount: groups.length };
}

function codecFrames(payloads, encode, decode) {
  let compressedBytes = 0;
  for (const payload of payloads) {
    const compressed = encode(payload);
    const restored = decode(compressed);
    if (!equalBytes(restored, payload)) throw new Error("Entropy backend frame round-trip mismatch");
    compressedBytes += compressed.length;
  }
  return compressedBytes;
}

function codecGroups(groups, encode, decode) {
  let inputBytes = 0;
  let compressedBytes = 0;
  for (const records of groups) {
    const input = Buffer.concat(records);
    const compressed = encode(input);
    const restored = decode(compressed);
    if (!equalBytes(restored, input)) throw new Error("Entropy backend group round-trip mismatch");
    inputBytes += input.length;
    compressedBytes += compressed.length;
  }
  return { inputBytes, compressedBytes, groupCount: groups.length };
}

function canonicalTraceFrame(item, trace, commands) {
  return {
    timestamp: item.timestamp,
    duration: item.duration,
    keyframe: item.keyframe,
    packedBytes: commands.length,
    trace
  };
}

export function createCommandTraceDocument(demuxed) {
  const timeline = decodeVideoTimeline(demuxed);
  const videoChunks = demuxed.chunks.filter((chunk) => chunk.type === "VFRM" || chunk.type === "RPTF");
  if (videoChunks.length !== timeline.length) throw new Error("Video chunk/timeline disagreement");
  const frames = [];
  let prior = null;
  for (let index = 0; index < timeline.length; index += 1) {
    const item = timeline[index];
    if (!item.repeat) {
      const trace = buildCommandTrace(item.state, prior, {
        columns: demuxed.header.columns,
        rows: demuxed.header.rows,
        paletteDepth: demuxed.header.paletteDepth,
        keyframe: item.keyframe
      });
      const commands = encodePackedCommands(trace);
      frames.push(canonicalTraceFrame(item, trace, commands));
    }
    prior = item.state;
  }
  return {
    format: REPORT_VERSION,
    grammar: "V64-GRAMMAR-B",
    header: {
      columns: demuxed.header.columns,
      rows: demuxed.header.rows,
      paletteDepth: demuxed.header.paletteDepth,
      cadence: demuxed.header.cadence.label,
      tickRate: 60_000
    },
    codedFrames: frames.length,
    frames
  };
}

export function benchmarkCommandBackends(demuxed, options = {}) {
  const sourceFileBytes = options.sourceFileBytes ?? null;
  const timeline = decodeVideoTimeline(demuxed);
  const videoChunks = demuxed.chunks.filter((chunk) => chunk.type === "VFRM" || chunk.type === "RPTF");
  if (videoChunks.length !== timeline.length) throw new Error("Video chunk/timeline disagreement");

  const traceHash = createHash("sha256");
  const phase1Payloads = [];
  const grammarPayloads = [];
  const phase1Groups = [];
  const grammarGroups = [];
  const phase1 = {
    commandBytes: 0,
    payloadBytes: 0,
    storedVfrmBytes: 0,
    opcodes: {},
    cells: {},
    dictionaryEntries: 0,
    dictionaryReferences: 0
  };
  const grammar = {
    commandBytes: 0,
    payloadBytes: 0,
    opcodeBytes: 0,
    countBytes: 0,
    packedPayloadBytes: 0,
    opcodes: {},
    cells: {}
  };

  let currentPhase1Group = null;
  let currentGrammarGroup = null;
  let prior = null;
  let codedFrames = 0;
  let repeatSpans = 0;
  for (let index = 0; index < timeline.length; index += 1) {
    const item = timeline[index];
    const chunk = videoChunks[index];
    if (item.repeat) {
      repeatSpans += 1;
      prior = item.state;
      continue;
    }
    if (chunk.type !== "VFRM") throw new Error("VFRM timeline/chunk disagreement");
    codedFrames += 1;

    const phase1Commands = chunk.payload.subarray(1);
    const phase1Measured = measureFrameCommands(phase1Commands);
    phase1.commandBytes += phase1Commands.length;
    phase1.payloadBytes += chunk.payload.length;
    phase1.storedVfrmBytes += chunk.storedLength;
    mergeCounts(phase1.opcodes, phase1Measured.opcodes);
    mergeCounts(phase1.cells, phase1Measured.cells);
    phase1.dictionaryEntries += phase1Measured.dictionaryEntries;
    phase1.dictionaryReferences += phase1Measured.dictionaryReferences;
    phase1Payloads.push(chunk.payload);
    const kind = item.keyframe ? 0 : 1;
    if (item.keyframe || !currentPhase1Group) {
      currentPhase1Group = [];
      phase1Groups.push(currentPhase1Group);
    }
    currentPhase1Group.push(frameRecord(kind, phase1Commands));

    const trace = buildCommandTrace(item.state, prior, {
      columns: demuxed.header.columns,
      rows: demuxed.header.rows,
      paletteDepth: demuxed.header.paletteDepth,
      keyframe: item.keyframe
    });
    const packed = encodePackedCommands(trace);
    const decoded = applyPackedCommands(packed, prior, {
      columns: demuxed.header.columns,
      rows: demuxed.header.rows,
      paletteDepth: demuxed.header.paletteDepth,
      keyframe: item.keyframe
    });
    if (!equalBytes(decoded, item.state)) throw new Error(`Grammar B round-trip mismatch at ${item.timestamp}`);
    const measured = measurePackedCommands(packed, {
      columns: demuxed.header.columns,
      rows: demuxed.header.rows,
      paletteDepth: demuxed.header.paletteDepth,
      keyframe: item.keyframe
    });
    grammar.commandBytes += packed.length;
    grammar.payloadBytes += packed.length + 1;
    grammar.opcodeBytes += measured.opcodeBytes;
    grammar.countBytes += measured.countBytes;
    grammar.packedPayloadBytes += measured.payloadBytes;
    mergeCounts(grammar.opcodes, measured.opcodes);
    mergeCounts(grammar.cells, measured.cells);

    const payload = Buffer.concat([Buffer.from([kind]), packed]);
    grammarPayloads.push(payload);
    const record = frameRecord(kind, packed);
    if (item.keyframe || !currentGrammarGroup) {
      currentGrammarGroup = [];
      grammarGroups.push(currentGrammarGroup);
    }
    currentGrammarGroup.push(record);
    traceHash.update(record);
    prior = item.state;
  }

  const phase1Deflate = deflateFrames(phase1Payloads);
  const grammarDeflate = deflateFrames(grammarPayloads);
  const phase1GroupDeflate = deflateGroups(phase1Groups);
  const grammarGroupDeflate = deflateGroups(grammarGroups);
  const phase1HuffmanFrames = codecFrames(
    phase1Payloads, encodeCanonicalHuffman, decodeCanonicalHuffman
  );
  const grammarHuffmanFrames = codecFrames(
    grammarPayloads, encodeCanonicalHuffman, decodeCanonicalHuffman
  );
  const phase1HuffmanGroups = codecGroups(
    phase1Groups, encodeCanonicalHuffman, decodeCanonicalHuffman
  );
  const grammarHuffmanGroups = codecGroups(
    grammarGroups, encodeCanonicalHuffman, decodeCanonicalHuffman
  );
  const hasZstandard = typeof zlib.zstdCompressSync === "function" &&
    typeof zlib.zstdDecompressSync === "function";
  const phase1ZstandardFrames = hasZstandard
    ? codecFrames(phase1Payloads, zlib.zstdCompressSync, zlib.zstdDecompressSync)
    : null;
  const grammarZstandardFrames = hasZstandard
    ? codecFrames(grammarPayloads, zlib.zstdCompressSync, zlib.zstdDecompressSync)
    : null;
  const phase1ZstandardGroups = hasZstandard
    ? codecGroups(phase1Groups, zlib.zstdCompressSync, zlib.zstdDecompressSync)
    : null;
  const grammarZstandardGroups = hasZstandard
    ? codecGroups(grammarGroups, zlib.zstdCompressSync, zlib.zstdDecompressSync)
    : null;
  const fixedContainerBytes = sourceFileBytes === null ? null : sourceFileBytes - phase1.storedVfrmBytes;
  const projectedFiles = fixedContainerBytes === null ? null : {
    packedOnlyBytes: fixedContainerBytes + grammar.payloadBytes,
    selectiveDeflateBytes: fixedContainerBytes + grammarDeflate.selectiveStoredBytes
  };

  return {
    format: REPORT_VERSION,
    source: {
      fileBytes: sourceFileBytes,
      columns: demuxed.header.columns,
      rows: demuxed.header.rows,
      paletteDepth: demuxed.header.paletteDepth,
      cadence: demuxed.header.cadence.label,
      durationTicks: demuxed.header.duration,
      nominalFrames: timeline.reduce(
        (sum, item) => sum + item.duration / demuxed.header.cadence.frameTicks, 0
      ),
      codedFrames,
      repeatSpans,
      independentGroups: grammarGroups.length
    },
    phase1: {
      ...phase1,
      deflatePerFrameBytes: phase1Deflate.rawDeflateBytes,
      selectiveDeflateStoredBytes: phase1Deflate.selectiveStoredBytes,
      selectivelyCompressedFrames: phase1Deflate.selectedFrames,
      deflatePerGroupInputBytes: phase1GroupDeflate.inputBytes,
      deflatePerGroupBytes: phase1GroupDeflate.compressedBytes,
      canonicalHuffmanPerFrameBytes: phase1HuffmanFrames,
      canonicalHuffmanPerGroupBytes: phase1HuffmanGroups.compressedBytes,
      zstandardAvailable: hasZstandard,
      zstandardPerFrameBytes: phase1ZstandardFrames,
      zstandardPerGroupBytes: phase1ZstandardGroups?.compressedBytes ?? null
    },
    grammarB: {
      ...grammar,
      canonicalTraceSha256: traceHash.digest("hex"),
      deflatePerFrameBytes: grammarDeflate.rawDeflateBytes,
      selectiveDeflateStoredBytes: grammarDeflate.selectiveStoredBytes,
      selectivelyCompressedFrames: grammarDeflate.selectedFrames,
      deflatePerGroupInputBytes: grammarGroupDeflate.inputBytes,
      deflatePerGroupBytes: grammarGroupDeflate.compressedBytes,
      canonicalHuffmanPerFrameBytes: grammarHuffmanFrames,
      canonicalHuffmanPerGroupBytes: grammarHuffmanGroups.compressedBytes,
      zstandardAvailable: hasZstandard,
      zstandardPerFrameBytes: grammarZstandardFrames,
      zstandardPerGroupBytes: grammarZstandardGroups?.compressedBytes ?? null,
      savings: {
        packedCommandsVersusPhase1CommandsPercent: compressionPercent(
          phase1.commandBytes, grammar.commandBytes
        ),
        selectiveDeflateVersusPackedPayloadPercent: compressionPercent(
          grammar.payloadBytes, grammarDeflate.selectiveStoredBytes
        ),
        groupDeflateVersusGroupInputPercent: compressionPercent(
          grammarGroupDeflate.inputBytes, grammarGroupDeflate.compressedBytes
        )
      }
    },
    projectedFiles
  };
}

export { REPORT_VERSION };
