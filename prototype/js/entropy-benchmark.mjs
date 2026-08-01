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

function decodeIndependentGroup(compressed, entry) {
  const group = zlib.inflateRawSync(compressed);
  let offset = 0;
  let state = null;
  let frames = 0;
  while (offset < group.length) {
    if (group.length - offset < 5) throw new Error(`Truncated group record for ${entry.id}`);
    const kind = group[offset];
    const length = group.readUInt32LE(offset + 1);
    offset += 5;
    if (length > group.length - offset) throw new Error(`Oversized group record for ${entry.id}`);
    const commands = group.subarray(offset, offset + length);
    offset += length;
    if (kind === 0 || kind === 1) {
      state = applyPackedCommands(commands, state, {
        columns: entry.grid.columns,
        rows: entry.grid.rows,
        paletteDepth: entry.paletteDepth,
        keyframe: kind === 0
      });
    } else if (kind === 2) {
      if (length || !state) throw new Error(`Invalid repeat record for ${entry.id}`);
    } else throw new Error(`Unknown group frame kind ${kind} for ${entry.id}`);
    frames += 1;
  }
  return frames;
}

function measureSeekDecode(compressedGroups, entry, repetitions = 3) {
  const samples = [];
  let decodedFrames = 0;
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const compressed of compressedGroups) {
      const started = performance.now();
      const frames = decodeIndependentGroup(compressed, entry);
      samples.push(performance.now() - started);
      if (repetition === 0) decodedFrames += frames;
    }
  }
  return {
    repetitions,
    groups: compressedGroups.length,
    decodedFrames,
    medianMilliseconds: Number(percentile(samples, 0.5).toFixed(3)),
    p95Milliseconds: Number(percentile(samples, 0.95).toFixed(3)),
    maximumMilliseconds: Number(Math.max(...samples).toFixed(3))
  };
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
  const measurePerformance = Boolean(options.measurePerformance);
  const started = measurePerformance ? performance.now() : 0;
  const byteCosts = options.byteCosts ?? null;
  const maxLiteralRun = options.maxLiteralRun ?? 32;
  const groupFrames = options.groupFrames ?? Number.POSITIVE_INFINITY;
  if (!(groupFrames === Number.POSITIVE_INFINITY ||
      Number.isInteger(groupFrames) && groupFrames >= 1)) {
    throw new RangeError("groupFrames must be a positive integer or Infinity");
  }
  const commandBuffers = [];
  const groups = [];
  let records = null;
  const traceHash = createHash("sha256");
  let commandBytes = 0;
  let codedFrames = 0;
  let repeatFrames = 0;
  let objectiveCost = 0;
  let prior = null;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const keyframe = index === 0 || index % groupFrames === 0;
    if (keyframe) {
      records = [];
      groups.push(records);
    }
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

  const groupBuffers = groups.map((group) => Buffer.concat(group));
  const compressedGroups = groupBuffers.map((group) =>
    zlib.deflateRawSync(group, { level: 9 })
  );
  for (let index = 0; index < groupBuffers.length; index += 1) {
    const restored = zlib.inflateRawSync(compressedGroups[index]);
    if (!equalBytes(restored, groupBuffers[index])) {
      throw new Error(`DEFLATE round-trip mismatch for ${entry.id} group ${index}`);
    }
  }
  const encodeMilliseconds = measurePerformance
    ? Number((performance.now() - started).toFixed(3))
    : null;
  const seekDecode = measurePerformance
    ? measureSeekDecode(compressedGroups, entry)
    : null;
  return {
    parser: byteCosts ? "static-byte-entropy-dynamic-programming" : "bounded-dynamic-programming",
    commandBuffers,
    compressedGroups,
    commandBytes,
    groupFrames: Number.isFinite(groupFrames) ? groupFrames : frames.length,
    groups: groups.length,
    groupInputBytes: groupBuffers.reduce((sum, group) => sum + group.length, 0),
    deflateBytes: compressedGroups.reduce((sum, group) => sum + group.length, 0),
    codedFrames,
    repeatFrames,
    objectiveCost,
    ...(measurePerformance ? {
      encodeMilliseconds,
      seekDecode
    } : {}),
    canonicalTraceSha256: traceHash.digest("hex")
  };
}

function publicMetrics(result) {
  const {
    commandBuffers: _commandBuffers,
    compressedGroups: _compressedGroups,
    ...metrics
  } = result;
  return metrics;
}

function benchmarkFixtureAtGroupFrames(entry, frames, options = {}) {
  const maxLiteralRun = options.maxLiteralRun ?? 32;
  const alpha = options.alpha ?? 0.5;
  const groupFrames = options.groupFrames ?? Number.POSITIVE_INFINITY;
  const measurePerformance = Boolean(options.measurePerformance);
  const packed = encodeFixture(entry, frames, {
    maxLiteralRun, groupFrames, measurePerformance
  });
  const firstCosts = deriveStaticByteCosts(packed.commandBuffers, { alpha });
  const entropyPass1 = encodeFixture(entry, frames, {
    maxLiteralRun, groupFrames, measurePerformance, byteCosts: firstCosts
  });
  const secondCosts = deriveStaticByteCosts(entropyPass1.commandBuffers, { alpha });
  const entropyPass2 = encodeFixture(entry, frames, {
    maxLiteralRun, groupFrames, measurePerformance, byteCosts: secondCosts
  });
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
    coverageClasses: entry.coverageClasses ?? [entry.structuralClass],
    recognizabilityTargets: entry.recognizabilityTargets ?? [],
    grid: entry.grid,
    paletteDepth: entry.paletteDepth,
    paletteAsset: entry.paletteAsset,
    paletteSha256: entry.paletteSha256,
    cadence: entry.cadence,
    frames: frames.length,
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

function groupFramesFor(entry, seconds) {
  const groupFrames = Math.max(1, Math.ceil(Number(entry.cadence) * seconds));
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isSafeInteger(groupFrames)) {
    throw new RangeError("Group durations must be positive finite seconds");
  }
  return groupFrames;
}

function benchmarkFixture(entry, frames, options = {}) {
  const report = benchmarkFixtureAtGroupFrames(entry, frames, options);
  const durations = options.groupDurationsSeconds ?? [];
  return {
    ...report,
    groupDurationSweep: durations.map((seconds) => {
      const groupFrames = groupFramesFor(entry, Number(seconds));
      const sweep = benchmarkFixtureAtGroupFrames(entry, frames, {
        ...options,
        groupFrames,
        groupDurationsSeconds: []
      });
      return {
        maximumSeconds: Number(seconds),
        groupFrames,
        groups: sweep.selected.groups,
        packedCommandBytes: sweep.packed.commandBytes,
        packedDeflateBytes: sweep.packed.deflateBytes,
        selectedCandidate: sweep.selected.candidate,
        selectedCommandBytes: sweep.selected.commandBytes,
        selectedDeflateBytes: sweep.selected.deflateBytes,
        selectedDeflateSavingsBytes: sweep.selected.deflateSavingsBytes,
        selectedDeflateSavingsPercent: sweep.selected.deflateSavingsPercent,
        ...(options.measurePerformance ? {
          encodeMilliseconds: sweep.selected.encodeMilliseconds,
          seekDecode: sweep.selected.seekDecode
        } : {}),
        canonicalTraceSha256: sweep.selected.canonicalTraceSha256
      };
    })
  };
}

export function benchmarkEntropyFixtures(corpus, fixtures, options = {}) {
  if (!corpus || typeof corpus !== "object" || !corpus.id || !corpus.title || !corpus.scope) {
    throw new TypeError("Entropy corpus metadata is incomplete");
  }
  if (!Array.isArray(fixtures) || !fixtures.length) {
    throw new TypeError("Entropy corpus requires analyzed fixtures");
  }
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
  const groupDurationSweep = (options.groupDurationsSeconds ?? []).map((seconds, index) => {
    const entries = fixtureReports.map((fixture) => fixture.groupDurationSweep[index]);
    return {
      maximumSeconds: Number(seconds),
      groups: entries.reduce((sum, entry) => sum + entry.groups, 0),
      packedCommandBytes: entries.reduce((sum, entry) => sum + entry.packedCommandBytes, 0),
      packedDeflateBytes: entries.reduce((sum, entry) => sum + entry.packedDeflateBytes, 0),
      selectedCommandBytes: entries.reduce((sum, entry) => sum + entry.selectedCommandBytes, 0),
      selectedDeflateBytes: entries.reduce((sum, entry) => sum + entry.selectedDeflateBytes, 0),
      selectedDeflateSavingsBytes: entries.reduce(
        (sum, entry) => sum + entry.selectedDeflateSavingsBytes, 0
      ),
      entropySelected: entries.filter((entry) => entry.selectedCandidate !== "packed").length,
      ...(options.measurePerformance ? {
        medianSeekMilliseconds: Number(percentile(
          entries.map((entry) => entry.seekDecode.medianMilliseconds), 0.5
        ).toFixed(3)),
        p95SeekMilliseconds: Number(percentile(
          entries.map((entry) => entry.seekDecode.p95Milliseconds), 0.95
        ).toFixed(3))
      } : {})
    };
  });
  return {
    format: ENTROPY_REPORT_VERSION,
    corpus: {
      id: corpus.id,
      title: corpus.title,
      scope: corpus.scope,
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
      maxLiteralRun: options.maxLiteralRun ?? 32,
      groupDurationsSeconds: options.groupDurationsSeconds ?? [],
      ...(options.measurePerformance ? {
        processMaxRssKiB: process.resourceUsage().maxRSS
      } : {})
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
    groupDurationSweep,
    fixtures: fixtureReports
  };
}

export function benchmarkEntropyCorpus(manifestInput, options = {}) {
  const manifest = validateCorpusManifest(manifestInput);
  const { fixtures } = generateCorpus(manifest);
  return benchmarkEntropyFixtures({
    id: manifest.id,
    title: manifest.title,
    scope: manifest.scope
  }, fixtures, options);
}
