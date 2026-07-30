import { createHash } from "node:crypto";
import * as zlib from "node:zlib";
import {
  applyPackedCommands,
  buildCommandTrace,
  encodePackedCommands
} from "./grammar-b.mjs";
import { generateCorpus, validateCorpusManifest } from "./corpus-fixtures.mjs";

export const ENTROPY_REPORT_VERSION = "V64-ENTROPY-SHOOTOUT-1";

function equalBytes(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function frameRecord(kind, commands) {
  const header = Buffer.alloc(5);
  header[0] = kind;
  header.writeUInt32LE(commands.length, 1);
  return Buffer.concat([header, commands]);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function percent(before, after) {
  return before ? (before - after) / before * 100 : 0;
}

export function deriveStaticByteCosts(buffers, options = {}) {
  const alpha = options.alpha ?? 0.5;
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1024) {
    throw new RangeError("Static-byte smoothing alpha must be positive and at most 1024");
  }
  if (!Array.isArray(buffers)) throw new TypeError("Static-byte training data must be an array");
  const counts = new Float64Array(256);
  counts.fill(alpha);
  let total = alpha * 256;
  for (const input of buffers) {
    const bytes = Buffer.from(input);
    for (const byte of bytes) {
      counts[byte] += 1;
      total += 1;
    }
  }
  return Array.from(counts, (count) => -Math.log2(count / total));
}

function encodeFixture(entry, frames, options = {}) {
  const byteCosts = options.byteCosts ?? null;
  const maxLiteralRun = options.maxLiteralRun ?? 32;
  const commandBuffers = [];
  const records = [];
  const traceHash = createHash("sha256");
  let commandBytes = 0;
  let codedFrames = 0;
  let repeatFrames = 0;
  let objectiveCost = 0;
  let prior = null;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const keyframe = index === 0;
    let kind;
    let packed;
    if (!keyframe && equalBytes(frame, prior)) {
      kind = 2;
      packed = Buffer.alloc(0);
      repeatFrames += 1;
    } else {
      kind = keyframe ? 0 : 1;
      const trace = buildCommandTrace(frame, keyframe ? null : prior, {
        columns: entry.grid.columns,
        rows: entry.grid.rows,
        paletteDepth: entry.paletteDepth,
        keyframe,
        maxLiteralRun,
        byteCosts
      });
      packed = encodePackedCommands(trace);
      if (packed.length !== trace.packedByteCost) {
        throw new Error(`Optimizer accounting mismatch for ${entry.id} frame ${index}`);
      }
      const decoded = applyPackedCommands(packed, keyframe ? null : prior, {
        columns: entry.grid.columns,
        rows: entry.grid.rows,
        paletteDepth: entry.paletteDepth,
        keyframe
      });
      if (!equalBytes(decoded, frame)) {
        throw new Error(`Entropy shootout round-trip mismatch for ${entry.id} frame ${index}`);
      }
      commandBuffers.push(packed);
      commandBytes += packed.length;
      objectiveCost += trace.objectiveCost;
      codedFrames += 1;
    }
    const record = frameRecord(kind, packed);
    records.push(record);
    traceHash.update(record);
    prior = frame;
  }

  const group = Buffer.concat(records);
  const compressed = zlib.deflateRawSync(group, { level: 9 });
  const restored = zlib.inflateRawSync(compressed);
  if (!equalBytes(restored, group)) throw new Error(`DEFLATE round-trip mismatch for ${entry.id}`);
  return {
    parser: byteCosts ? "static-byte-entropy-dynamic-programming" : "bounded-dynamic-programming",
    commandBuffers,
    commandBytes,
    groupInputBytes: group.length,
    deflateBytes: compressed.length,
    codedFrames,
    repeatFrames,
    objectiveCost,
    canonicalTraceSha256: traceHash.digest("hex")
  };
}

function publicMetrics(result) {
  const {
    commandBuffers: _commandBuffers,
    ...metrics
  } = result;
  return metrics;
}

function benchmarkFixture(entry, frames, options = {}) {
  const maxLiteralRun = options.maxLiteralRun ?? 32;
  const alpha = options.alpha ?? 0.5;
  const packed = encodeFixture(entry, frames, { maxLiteralRun });
  const firstCosts = deriveStaticByteCosts(packed.commandBuffers, { alpha });
  const entropyPass1 = encodeFixture(entry, frames, { maxLiteralRun, byteCosts: firstCosts });
  const secondCosts = deriveStaticByteCosts(entropyPass1.commandBuffers, { alpha });
  const entropyPass2 = encodeFixture(entry, frames, { maxLiteralRun, byteCosts: secondCosts });
  const candidates = [
    { id: "packed", rank: 0, result: packed },
    { id: "entropy-pass-1", rank: 1, result: entropyPass1 },
    { id: "entropy-pass-2", rank: 2, result: entropyPass2 }
  ];
  candidates.sort((a, b) =>
    a.result.deflateBytes - b.result.deflateBytes ||
    a.result.commandBytes - b.result.commandBytes ||
    a.rank - b.rank
  );
  const selected = candidates[0];
  return {
    id: entry.id,
    structuralClass: entry.structuralClass,
    generator: entry.generator,
    provenance: entry.provenance,
    grid: entry.grid,
    paletteDepth: entry.paletteDepth,
    cadence: entry.cadence,
    frames: entry.frames,
    packed: publicMetrics(packed),
    entropyPass1: publicMetrics(entropyPass1),
    entropyPass2: publicMetrics(entropyPass2),
    selected: {
      candidate: selected.id,
      ...publicMetrics(selected.result),
      deflateSavingsBytes: packed.deflateBytes - selected.result.deflateBytes,
      deflateSavingsPercent: Number(percent(
        packed.deflateBytes, selected.result.deflateBytes
      ).toFixed(3))
    }
  };
}

export function benchmarkEntropyCorpus(manifestInput, options = {}) {
  const manifest = validateCorpusManifest(manifestInput);
  const { fixtures } = generateCorpus(manifest);
  const fixtureReports = fixtures.map(({ entry, frames }) =>
    benchmarkFixture(entry, frames, options)
  );
  const savings = fixtureReports.map((fixture) => fixture.selected.deflateSavingsPercent);
  const totals = fixtureReports.reduce((result, fixture) => {
    result.packedCommandBytes += fixture.packed.commandBytes;
    result.packedDeflateBytes += fixture.packed.deflateBytes;
    result.selectedCommandBytes += fixture.selected.commandBytes;
    result.selectedDeflateBytes += fixture.selected.deflateBytes;
    result.entropySelected += fixture.selected.candidate === "packed" ? 0 : 1;
    return result;
  }, {
    packedCommandBytes: 0,
    packedDeflateBytes: 0,
    selectedCommandBytes: 0,
    selectedDeflateBytes: 0,
    entropySelected: 0
  });
  const canonicalHash = createHash("sha256");
  for (const fixture of fixtureReports) {
    canonicalHash.update(fixture.id);
    canonicalHash.update(fixture.selected.canonicalTraceSha256);
  }
  return {
    format: ENTROPY_REPORT_VERSION,
    corpus: {
      id: manifest.id,
      title: manifest.title,
      scope: manifest.scope,
      entries: fixtureReports.length,
      structuralClasses: [...new Set(fixtureReports.map((fixture) => fixture.structuralClass))]
    },
    configuration: {
      parserCandidates: [
        "packed-byte dynamic programming",
        "static-byte entropy pass 1",
        "static-byte entropy pass 2"
      ],
      selectionBackend: "DEFLATE raw level 9",
      smoothingAlpha: options.alpha ?? 0.5,
      maxLiteralRun: options.maxLiteralRun ?? 32
    },
    totals: {
      ...totals,
      selectedDeflateSavingsBytes: totals.packedDeflateBytes - totals.selectedDeflateBytes,
      selectedDeflateSavingsPercent: Number(percent(
        totals.packedDeflateBytes, totals.selectedDeflateBytes
      ).toFixed(3)),
      packedSelected: fixtureReports.length - totals.entropySelected,
      medianFixtureSavingsPercent: Number(percentile(savings, 0.5).toFixed(3)),
      p75FixtureSavingsPercent: Number(percentile(savings, 0.75).toFixed(3)),
      canonicalSelectionSha256: canonicalHash.digest("hex")
    },
    fixtures: fixtureReports
  };
}
