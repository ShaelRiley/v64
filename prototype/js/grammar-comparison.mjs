import { performance } from "node:perf_hooks";
import { applyFrameCommands, OPCODE } from "./commands.mjs";
import { decodeVideoTimeline } from "./container.mjs";
import {
  applyPackedCommands,
  buildCommandTrace,
  encodePackedCommands,
  PACKED_OPCODE,
  parsePackedCommands
} from "./grammar-b.mjs";

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return {
    heapUsed: memory.heapUsed,
    arrayBuffers: memory.arrayBuffers,
    rss: memory.rss
  };
}

function updatePeak(peak, sample) {
  peak.heapUsed = Math.max(peak.heapUsed, sample.heapUsed);
  peak.arrayBuffers = Math.max(peak.arrayBuffers, sample.arrayBuffers);
  peak.rss = Math.max(peak.rss, sample.rss);
}

function decoderSourceMetrics(functions, opcodes) {
  const source = functions.map((fn) => fn.toString()).join("\n");
  const decisionTokens = source.match(/\b(?:if|switch|case)\b/g) ?? [];
  const loopTokens = source.match(/\b(?:for|while)\b/g) ?? [];
  return {
    opcodeCount: Object.keys(opcodes).length,
    functionCount: functions.length,
    sourceBytes: Buffer.byteLength(source),
    sourceLines: source.split("\n").length,
    decisionTokens: decisionTokens.length,
    loopTokens: loopTokens.length
  };
}

export function grammarDecoderComplexity() {
  return {
    phase1: decoderSourceMetrics([applyFrameCommands], OPCODE),
    grammarB: decoderSourceMetrics(
      [parsePackedCommands, applyPackedCommands],
      PACKED_OPCODE
    )
  };
}

export function prepareGrammarComparison(demuxed) {
  const timeline = decodeVideoTimeline(demuxed);
  const videoChunks = demuxed.chunks.filter(
    (chunk) => chunk.type === "VFRM" || chunk.type === "RPTF"
  );
  if (videoChunks.length !== timeline.length) {
    throw new Error("Video chunk/timeline disagreement");
  }

  const frames = [];
  let prior = null;
  for (let index = 0; index < timeline.length; index += 1) {
    const item = timeline[index];
    const chunk = videoChunks[index];
    if (item.repeat) {
      frames.push({ repeat: true, expected: item.state });
      prior = item.state;
      continue;
    }
    if (chunk.type !== "VFRM") throw new Error("VFRM timeline/chunk disagreement");
    const options = {
      columns: demuxed.header.columns,
      rows: demuxed.header.rows,
      paletteDepth: demuxed.header.paletteDepth,
      keyframe: item.keyframe
    };
    const phase1 = Buffer.from(chunk.payload.subarray(1));
    const trace = buildCommandTrace(item.state, prior, options);
    const grammarB = encodePackedCommands(trace);
    frames.push({
      repeat: false,
      keyframe: item.keyframe,
      expected: item.state,
      phase1,
      grammarB
    });
    prior = item.state;
  }

  return {
    columns: demuxed.header.columns,
    rows: demuxed.header.rows,
    paletteDepth: demuxed.header.paletteDepth,
    cadence: demuxed.header.cadence.label,
    frames
  };
}

export function decodePreparedGrammar(prepared, grammar, options = {}) {
  if (grammar !== "phase1" && grammar !== "grammarB") {
    throw new RangeError("Grammar must be phase1 or grammarB");
  }
  const verify = options.verify ?? true;
  const onFrame = options.onFrame ?? null;
  let prior = null;
  let codedFrames = 0;
  let repeatFrames = 0;

  for (const frame of prepared.frames) {
    if (frame.repeat) {
      if (!prior) throw new Error("Repeat frame has no prior decoded state");
      if (verify && !equalBytes(prior, frame.expected)) {
        throw new Error("Repeat frame does not preserve the expected state");
      }
      repeatFrames += 1;
      onFrame?.();
      continue;
    }

    const commandBytes = grammar === "phase1" ? frame.phase1 : frame.grammarB;
    const apply = grammar === "phase1" ? applyFrameCommands : applyPackedCommands;
    const decoded = apply(commandBytes, prior, {
      columns: prepared.columns,
      rows: prepared.rows,
      paletteDepth: prepared.paletteDepth,
      keyframe: frame.keyframe
    });
    if (verify && !equalBytes(decoded, frame.expected)) {
      throw new Error(`${grammar} decoded state mismatch`);
    }
    prior = decoded;
    codedFrames += 1;
    onFrame?.();
  }

  return {
    codedFrames,
    repeatFrames,
    nominalFrames: prepared.frames.length,
    finalState: prior
  };
}

export function benchmarkPreparedGrammar(prepared, grammar, repetitions = 5) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) {
    throw new RangeError("repetitions must be an integer from 1 through 100");
  }
  decodePreparedGrammar(prepared, grammar, { verify: true });

  const times = [];
  let peakHeapDeltaBytes = 0;
  let peakArrayBufferDeltaBytes = 0;
  let peakRssDeltaBytes = 0;
  let last = null;

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    global.gc?.();
    const baseline = memorySnapshot();
    const peak = { ...baseline };
    const started = performance.now();
    last = decodePreparedGrammar(prepared, grammar, {
      verify: false,
      onFrame: () => updatePeak(peak, memorySnapshot())
    });
    const elapsed = performance.now() - started;
    updatePeak(peak, memorySnapshot());
    times.push(elapsed);
    peakHeapDeltaBytes = Math.max(peakHeapDeltaBytes, peak.heapUsed - baseline.heapUsed);
    peakArrayBufferDeltaBytes = Math.max(
      peakArrayBufferDeltaBytes,
      peak.arrayBuffers - baseline.arrayBuffers
    );
    peakRssDeltaBytes = Math.max(peakRssDeltaBytes, peak.rss - baseline.rss);
  }

  return {
    grammar,
    repetitions,
    nominalFrames: last.nominalFrames,
    codedFrames: last.codedFrames,
    repeatFrames: last.repeatFrames,
    medianMilliseconds: Number(percentile(times, 0.5).toFixed(3)),
    p95Milliseconds: Number(percentile(times, 0.95).toFixed(3)),
    maximumMilliseconds: Number(Math.max(...times).toFixed(3)),
    peakHeapDeltaBytes,
    peakArrayBufferDeltaBytes,
    peakRssDeltaBytes
  };
}
