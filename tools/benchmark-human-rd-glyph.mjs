#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { CADENCES, HEADER_SIZE, PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import { benchmarkCommandBackends } from "../prototype/js/command-benchmark.mjs";
import {
  decodeVideoTimeline,
  demuxV64,
  muxV64,
  verifyV64
} from "../prototype/js/container.mjs";
import {
  analyzeRateDistortionTimeline,
  encodeSceneAwareCellTimeline
} from "../prototype/js/rate-distortion.mjs";
import { validateRasterCorpusManifest } from "../prototype/js/raster-corpus.mjs";
import { decodeRasterEntryProxyFrames } from "../prototype/js/raster-source-frames.mjs";

const FORMAT = "V64-HUMAN-RD-GLYPH-STUDY-1";
const outputDirectory = resolve(process.argv[2] || "bench/generated/human-rd-glyph-study");
const tranche1Path = resolve(process.argv[3] || "bench/corpus/human-raster-manifest.json");
const tranche2Path = resolve(process.argv[4] || "bench/corpus/human-raster-tranche-2-manifest.json");
const filesDirectory = resolve(outputDirectory, "files");
mkdirSync(filesDirectory, { recursive: true });

const TRANCHE1_IDS = Object.freeze([
  "lecture-candidate-1",
  "performance-candidate-1",
  "animation-candidate-1"
]);
const TRANCHE2_IDS = Object.freeze([
  "depth-40-baseline",
  "monochrome-40-baseline",
  "screen-40-baseline",
  "lecture-subtitle-60-baseline",
  "animation-subtitle-60-baseline",
  "lecture-subtitle-80-baseline",
  "animation-subtitle-80-baseline"
]);
const CONFIGURATIONS = Object.freeze([
  Object.freeze({ id: "primary-32-balanced", mode: "balanced", glyphCounts: Object.freeze([32]) }),
  Object.freeze({ id: "primary-32-quality", mode: "quality", glyphCounts: Object.freeze([32]) }),
  Object.freeze({ id: "option-64-quality", mode: "quality", glyphCounts: Object.freeze([64]) }),
  Object.freeze({ id: "adaptive-32-64-quality", mode: "quality", glyphCounts: Object.freeze([32, 64]) })
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

function percentDelta(before, after) {
  return before ? Number(((after - before) / before * 100).toFixed(3)) : 0;
}

function percentReduction(before, after) {
  return before ? Number(((before - after) / before * 100).toFixed(3)) : 0;
}

function normalizeEntry(entry) {
  const normalized = structuredClone(entry);
  normalized.id = `normative-${entry.id.replace(/-(candidate-1|baseline)$/, "")}`;
  normalized.paletteAsset = "V64-P256-1";
  normalized.temporalStability = 0.48;
  return normalized;
}

function selectedEntries(manifest, ids) {
  return ids.map((id) => {
    const entry = manifest.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Human gate source entry ${id} is missing`);
    return normalizeEntry(entry);
  });
}

function buildHumanGateManifest(tranche1, tranche2) {
  return validateRasterCorpusManifest({
    format: "V64-RASTER-CORPUS-MANIFEST-1",
    id: "V64-HUMAN-RD-GLYPH-GATE-1",
    title: "V64 normative human raster rate-distortion gate",
    scope: "Ten original CC0 source/grid lanes normalized to V64-P256-1 for the 32-primary versus optional-64 glyph study.",
    entries: [
      ...selectedEntries(tranche1, TRANCHE1_IDS),
      ...selectedEntries(tranche2, TRANCHE2_IDS)
    ]
  });
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

function decodeResourceMetrics(file, repetitions = 5) {
  const times = [];
  let peakHeapDeltaBytes = 0;
  let peakArrayBufferDeltaBytes = 0;
  let peakRssDeltaBytes = 0;
  let verification = null;
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    global.gc?.();
    const baseline = memorySnapshot();
    const peak = { ...baseline };
    const started = performance.now();
    const demuxed = demuxV64(file);
    updatePeak(peak, memorySnapshot());
    const timeline = decodeVideoTimeline(demuxed);
    updatePeak(peak, memorySnapshot());
    verification = verifyV64(file);
    updatePeak(peak, memorySnapshot());
    if (!timeline.length || !verification.valid) throw new Error("Decoder resource run did not verify");
    times.push(performance.now() - started);
    peakHeapDeltaBytes = Math.max(peakHeapDeltaBytes, peak.heapUsed - baseline.heapUsed);
    peakArrayBufferDeltaBytes = Math.max(
      peakArrayBufferDeltaBytes,
      peak.arrayBuffers - baseline.arrayBuffers
    );
    peakRssDeltaBytes = Math.max(peakRssDeltaBytes, peak.rss - baseline.rss);
  }
  return {
    repetitions,
    medianMilliseconds: Number(percentile(times, 0.5).toFixed(3)),
    p95Milliseconds: Number(percentile(times, 0.95).toFixed(3)),
    maximumMilliseconds: Number(Math.max(...times).toFixed(3)),
    peakHeapDeltaBytes,
    peakArrayBufferDeltaBytes,
    peakRssDeltaBytes,
    processMaxRssKiB: process.resourceUsage().maxRSS,
    verification
  };
}

function hostileCases(input) {
  const file = Buffer.from(input);
  const unknownFeature = Buffer.from(file);
  unknownFeature.writeUInt32LE(unknownFeature.readUInt32LE(12) | 0x100, 12);

  const declaredMaximum = Buffer.from(file);
  declaredMaximum.writeUInt32LE(0xffff_ffff, 116);

  const storedLength = Buffer.from(file);
  storedLength.writeUInt32LE(0xffff_ffff, HEADER_SIZE + 24);

  const crc = Buffer.from(file);
  const firstStoredLength = crc.readUInt32LE(HEADER_SIZE + 24);
  if (firstStoredLength < 1) throw new Error("Hostile fixture requires a nonempty first chunk");
  crc[HEADER_SIZE + 32] ^= 0x01;

  const unknownChunk = Buffer.from(file);
  unknownChunk.write("ZZZZ", HEADER_SIZE, 4, "ascii");

  return [
    { id: "unknown-mandatory-feature", bytes: unknownFeature },
    { id: "declared-maximum-stored", bytes: declaredMaximum },
    { id: "oversized-first-chunk", bytes: storedLength },
    { id: "crc-corruption", bytes: crc },
    { id: "unknown-mandatory-chunk", bytes: unknownChunk },
    { id: "truncated-file", bytes: file.subarray(0, file.length - 1) },
    { id: "trailing-byte", bytes: Buffer.concat([file, Buffer.from([0])]) }
  ];
}

function hostileResourceMetrics(file, repetitions = 5) {
  return hostileCases(file).map((testCase) => {
    const times = [];
    let accepted = 0;
    let message = null;
    let peakHeapDeltaBytes = 0;
    let peakArrayBufferDeltaBytes = 0;
    let peakRssDeltaBytes = 0;
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      global.gc?.();
      const baseline = memorySnapshot();
      const peak = { ...baseline };
      const started = performance.now();
      try {
        verifyV64(testCase.bytes);
        accepted += 1;
      } catch (error) {
        message ||= error.message;
      }
      updatePeak(peak, memorySnapshot());
      times.push(performance.now() - started);
      peakHeapDeltaBytes = Math.max(peakHeapDeltaBytes, peak.heapUsed - baseline.heapUsed);
      peakArrayBufferDeltaBytes = Math.max(
        peakArrayBufferDeltaBytes,
        peak.arrayBuffers - baseline.arrayBuffers
      );
      peakRssDeltaBytes = Math.max(peakRssDeltaBytes, peak.rss - baseline.rss);
    }
    if (accepted) throw new Error(`Hostile input ${testCase.id} was accepted ${accepted} times`);
    return {
      id: testCase.id,
      bytes: testCase.bytes.length,
      repetitions,
      accepted,
      rejection: message,
      medianMilliseconds: Number(percentile(times, 0.5).toFixed(3)),
      p95Milliseconds: Number(percentile(times, 0.95).toFixed(3)),
      maximumMilliseconds: Number(Math.max(...times).toFixed(3)),
      peakHeapDeltaBytes,
      peakArrayBufferDeltaBytes,
      peakRssDeltaBytes
    };
  });
}

function analyzeConfiguration(decoded, configuration) {
  const entry = decoded.entry;
  const paletteDepthId = PALETTE_DEPTHS.indexOf(entry.paletteDepth);
  const sourceFrames = [...decoded.frames, ...decoded.frames];
  const analysis = analyzeRateDistortionTimeline(sourceFrames, {
    mode: configuration.mode,
    glyphCounts: configuration.glyphCounts,
    width: decoded.width,
    height: decoded.height,
    columns: entry.grid.columns,
    rows: entry.grid.rows,
    paletteDepth: entry.paletteDepth,
    paletteDepthId,
    cadenceId: decoded.cadence.id,
    minimumGroupFrames: 2,
    palette: decoded.paletteAsset.colors,
    useDictionary: true
  });
  const chunks = encodeSceneAwareCellTimeline(analysis);
  const file = muxV64({
    columns: entry.grid.columns,
    rows: entry.grid.rows,
    cadenceId: decoded.cadence.id,
    paletteDepthId
  }, chunks);
  const verification = verifyV64(file);
  if (verification.frames !== sourceFrames.length) {
    throw new Error(`Frame verification mismatch for ${entry.id}/${configuration.id}`);
  }
  const maximumGroupFrames = Math.max(...analysis.plan.groups.map((group) => group.frames));
  if (maximumGroupFrames > analysis.metrics.maximumGroupFrames) {
    throw new Error(`Two-second group ceiling exceeded for ${entry.id}/${configuration.id}`);
  }
  const backend = benchmarkCommandBackends(demuxV64(file), {
    sourceFileBytes: file.length,
    groupDurationsSeconds: [2]
  });
  const filename = `${entry.id}--${configuration.id}.v64`;
  writeFileSync(resolve(filesDirectory, filename), file);
  return {
    id: entry.id,
    structuralClass: entry.structuralClass,
    coverageClasses: entry.coverageClasses ?? [entry.structuralClass],
    grid: entry.grid,
    cadence: entry.cadence,
    configuration: configuration.id,
    mode: configuration.mode,
    glyphCounts: configuration.glyphCounts,
    sourceFrames: decoded.frames.length,
    analyzedFrames: sourceFrames.length,
    sourceTreatment: "two repetitions of the provenance-checked CC0 raster lane",
    sourceIdentity: decoded.sourceIdentity,
    sourceSha256: decoded.sourceSha256,
    paletteAsset: decoded.paletteAsset.id,
    paletteSha256: decoded.paletteAsset.sha256,
    containerPath: `files/${filename}`,
    containerBytes: file.length,
    containerSha256: sha256(file),
    independentGroups: analysis.metrics.independentGroups,
    sceneCuts: analysis.metrics.sceneCuts,
    allowedMaximumGroupFrames: analysis.metrics.maximumGroupFrames,
    observedMaximumGroupFrames: maximumGroupFrames,
    estimatedRateBytes: analysis.metrics.estimatedRateBytes,
    meanDistortion: analysis.metrics.meanDistortion,
    meanPsnr: analysis.metrics.meanPsnr,
    glyphSelections: analysis.metrics.glyphSelections,
    verification,
    decodeResources: decodeResourceMetrics(file),
    grammar: {
      phase1CommandBytes: backend.phase1.commandBytes,
      phase1GroupDeflateBytes: backend.phase1.deflatePerGroupBytes,
      grammarBCommandBytes: backend.grammarB.commandBytes,
      grammarBGroupDeflateBytes: backend.grammarB.deflatePerGroupBytes,
      grammarBHuffmanBytes: backend.grammarB.canonicalHuffmanPerGroupBytes,
      grammarBZstandardBytes: backend.grammarB.zstandardPerGroupBytes,
      grammarBTraceSha256: backend.grammarB.canonicalTraceSha256
    }
  };
}

function aggregate(results) {
  return CONFIGURATIONS.map((configuration) => {
    const rows = results.filter((row) => row.configuration === configuration.id);
    const sum = (selector) => rows.reduce((total, row) => total + selector(row), 0);
    const mean = (selector) => sum(selector) / rows.length;
    const zstandard = rows.map((row) => row.grammar.grammarBZstandardBytes);
    return {
      id: configuration.id,
      mode: configuration.mode,
      glyphCounts: configuration.glyphCounts,
      lanes: rows.length,
      containerBytes: sum((row) => row.containerBytes),
      independentGroups: sum((row) => row.independentGroups),
      sceneCuts: sum((row) => row.sceneCuts),
      meanDistortion: Number(mean((row) => row.meanDistortion).toFixed(9)),
      meanPsnr: Number(mean((row) => row.meanPsnr).toFixed(6)),
      glyphSelections: Object.fromEntries([16, 32, 64].map((count) => [
        count,
        sum((row) => row.glyphSelections[count])
      ])),
      decodeResources: {
        medianMilliseconds: Number(mean((row) => row.decodeResources.medianMilliseconds).toFixed(3)),
        worstP95Milliseconds: Number(Math.max(...rows.map((row) => row.decodeResources.p95Milliseconds)).toFixed(3)),
        peakHeapDeltaBytes: Math.max(...rows.map((row) => row.decodeResources.peakHeapDeltaBytes)),
        peakArrayBufferDeltaBytes: Math.max(...rows.map((row) => row.decodeResources.peakArrayBufferDeltaBytes)),
        peakRssDeltaBytes: Math.max(...rows.map((row) => row.decodeResources.peakRssDeltaBytes))
      },
      grammar: {
        phase1GroupDeflateBytes: sum((row) => row.grammar.phase1GroupDeflateBytes),
        grammarBGroupDeflateBytes: sum((row) => row.grammar.grammarBGroupDeflateBytes),
        grammarBHuffmanBytes: sum((row) => row.grammar.grammarBHuffmanBytes),
        grammarBZstandardBytes: zstandard.every(Number.isFinite)
          ? zstandard.reduce((total, value) => total + value, 0)
          : null
      }
    };
  });
}

function findings(aggregates) {
  const byId = Object.fromEntries(aggregates.map((item) => [item.id, item]));
  const primaryBalanced = byId["primary-32-balanced"];
  const primaryQuality = byId["primary-32-quality"];
  const option64 = byId["option-64-quality"];
  const adaptive = byId["adaptive-32-64-quality"];
  const grammarPhase1 = aggregates.reduce(
    (sum, item) => sum + item.grammar.phase1GroupDeflateBytes, 0
  );
  const grammarB = aggregates.reduce(
    (sum, item) => sum + item.grammar.grammarBGroupDeflateBytes, 0
  );
  const huffman = aggregates.reduce(
    (sum, item) => sum + item.grammar.grammarBHuffmanBytes, 0
  );
  const zstandardValues = aggregates.map((item) => item.grammar.grammarBZstandardBytes);
  const zstandard = zstandardValues.every(Number.isFinite)
    ? zstandardValues.reduce((sum, value) => sum + value, 0)
    : null;
  return {
    primaryDefault: "primary-32-balanced",
    fullAlphabetOption: "option-64-quality",
    glyph32To64: {
      containerByteDeltaPercent: percentDelta(primaryQuality.containerBytes, option64.containerBytes),
      distortionReductionPercent: percentReduction(
        primaryQuality.meanDistortion,
        option64.meanDistortion
      )
    },
    adaptiveVersusPrimary32Quality: {
      containerByteDeltaPercent: percentDelta(primaryQuality.containerBytes, adaptive.containerBytes),
      distortionReductionPercent: percentReduction(
        primaryQuality.meanDistortion,
        adaptive.meanDistortion
      ),
      glyphSelections: adaptive.glyphSelections
    },
    balancedVersusQuality32: {
      containerByteDeltaPercent: percentDelta(primaryBalanced.containerBytes, primaryQuality.containerBytes),
      distortionReductionPercent: percentReduction(
        primaryBalanced.meanDistortion,
        primaryQuality.meanDistortion
      )
    },
    grammar: {
      phase1DeflateBytes: grammarPhase1,
      grammarBDeflateBytes: grammarB,
      grammarBHuffmanBytes: huffman,
      grammarBZstandardBytes: zstandard,
      grammarBVersusPhase1SavingsPercent: percentReduction(grammarPhase1, grammarB),
      deflateVersusZstandardSavingsPercent: Number.isFinite(zstandard)
        ? percentReduction(zstandard, grammarB)
        : null
    }
  };
}

function markdown(report) {
  const lines = [
    "# V64 human raster 32-primary rate-distortion gate",
    "",
    `Format: \`${report.format}\``,
    "",
    "Ten original CC0 source/grid lanes are normalized to the normative",
    "`V64-P256-1` palette. Each lane is decoded from its provenance-checked",
    "raster source and repeated twice to exercise scene cuts and the cadence-",
    "derived two-second independent-group ceiling.",
    "",
    "| Configuration | Bytes | Groups | Scene cuts | Mean distortion | Mean PSNR | 32/64 selections | Worst decode p95 ms |",
    "|---|---:|---:|---:|---:|---:|---|---:|"
  ];
  for (const item of report.aggregates) {
    lines.push(
      `| ${item.id} | ${item.containerBytes} | ${item.independentGroups} | ${item.sceneCuts} | ${item.meanDistortion} | ${item.meanPsnr} | ${item.glyphSelections[32]}/${item.glyphSelections[64]} | ${item.decodeResources.worstP95Milliseconds} |`
    );
  }
  lines.push(
    "",
    "## Policy under test",
    "",
    "- Video 64 and the `.v64` extension retain the canonical 64-glyph identity.",
    "- 32 glyphs is the primary/default optimization and product path.",
    "- 64 glyphs is an explicit additional quality option.",
    "- 16 glyphs is excluded from this product-facing human gate.",
    "",
    "## Measured comparisons",
    "",
    `- Fixed quality 32 → fixed quality 64 byte delta: **${report.findings.glyph32To64.containerByteDeltaPercent}%**.`,
    `- Fixed quality 32 → fixed quality 64 distortion reduction: **${report.findings.glyph32To64.distortionReductionPercent}%**.`,
    `- Adaptive 32/64 versus fixed quality 32 byte delta: **${report.findings.adaptiveVersusPrimary32Quality.containerByteDeltaPercent}%**.`,
    `- Adaptive 32/64 versus fixed quality 32 distortion reduction: **${report.findings.adaptiveVersusPrimary32Quality.distortionReductionPercent}%**.`,
    `- Grammar B versus Phase-1 group-DEFLATE savings: **${report.findings.grammar.grammarBVersusPhase1SavingsPercent}%**.`,
    "",
    "## Resource and hostile-input evidence",
    "",
    `- Largest checked container: **${report.resources.hostileSourceBytes} bytes**.`,
    `- Hostile cases rejected: **${report.resources.hostileInputs.length}/${report.resources.hostileInputs.length}**.`,
    `- Worst hostile-input p95 rejection time: **${report.resources.worstHostileP95Milliseconds} ms**.`,
    `- Worst hostile sampled heap delta: **${report.resources.worstHostileHeapDeltaBytes} bytes**.`,
    `- Worst hostile sampled ArrayBuffer delta: **${report.resources.worstHostileArrayBufferDeltaBytes} bytes**.`,
    "",
    "The full JSON contains per-lane source hashes, palette hashes, container",
    "hashes, group bounds, decoder measurements, grammar/backend totals, and",
    "hostile-input rejection messages."
  );
  return `${lines.join("\n")}\n`;
}

const tranche1Bytes = readFileSync(tranche1Path);
const tranche2Bytes = readFileSync(tranche2Path);
const tranche1 = JSON.parse(tranche1Bytes);
const tranche2 = JSON.parse(tranche2Bytes);
const manifest = buildHumanGateManifest(tranche1, tranche2);
writeFileSync(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const decodedLanes = manifest.entries.map((entry) =>
  decodeRasterEntryProxyFrames(entry, { baseDirectory: process.cwd() })
);
const results = [];
for (const decoded of decodedLanes) {
  for (const configuration of CONFIGURATIONS) {
    results.push(analyzeConfiguration(decoded, configuration));
  }
}
const aggregates = aggregate(results);
const largest = [...results].sort((left, right) => right.containerBytes - left.containerBytes)[0];
const hostileFile = readFileSync(resolve(outputDirectory, largest.containerPath));
const hostileInputs = hostileResourceMetrics(hostileFile);
const report = {
  format: FORMAT,
  source: {
    tranche1Manifest: relative(process.cwd(), tranche1Path).replaceAll("\\", "/"),
    tranche1Sha256: sha256(tranche1Bytes),
    tranche2Manifest: relative(process.cwd(), tranche2Path).replaceAll("\\", "/"),
    tranche2Sha256: sha256(tranche2Bytes),
    generatedManifest: "manifest.json",
    paletteAsset: "V64-P256-1",
    license: "CC0-1.0",
    lanes: manifest.entries.length,
    configurations: CONFIGURATIONS.length,
    cases: results.length
  },
  policy: {
    projectName: "Video 64",
    extension: ".v64",
    defaultGlyphCount: 32,
    optionalGlyphCount: 64,
    researchOnlyGlyphCount: 16
  },
  configurations: CONFIGURATIONS,
  decodedSources: decodedLanes.map((decoded) => ({
    id: decoded.entry.id,
    sourceIdentity: decoded.sourceIdentity,
    sourceSha256: decoded.sourceSha256,
    frames: decoded.frames.length,
    width: decoded.width,
    height: decoded.height,
    cadence: decoded.cadence.label,
    paletteAsset: decoded.paletteAsset.id,
    paletteSha256: decoded.paletteAsset.sha256,
    metrics: decoded.metrics
  })),
  results,
  aggregates,
  findings: findings(aggregates),
  resources: {
    hostileSource: largest.containerPath,
    hostileSourceSha256: largest.containerSha256,
    hostileSourceBytes: largest.containerBytes,
    hostileInputs,
    worstHostileP95Milliseconds: Math.max(...hostileInputs.map((item) => item.p95Milliseconds)),
    worstHostileHeapDeltaBytes: Math.max(...hostileInputs.map((item) => item.peakHeapDeltaBytes)),
    worstHostileArrayBufferDeltaBytes: Math.max(
      ...hostileInputs.map((item) => item.peakArrayBufferDeltaBytes)
    ),
    allRejected: hostileInputs.every((item) => item.accepted === 0)
  }
};
if (!report.resources.allRejected) throw new Error("One or more hostile inputs were accepted");
if (report.resources.worstHostileP95Milliseconds > 1000) {
  throw new Error("Hostile-input rejection exceeded the one-second measurement bound");
}
if (report.resources.worstHostileArrayBufferDeltaBytes > 64 * 1024 * 1024) {
  throw new Error("Hostile-input ArrayBuffer growth exceeded 64 MiB");
}
const json = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(resolve(outputDirectory, "summary.json"), json);
writeFileSync(resolve(outputDirectory, "RESULTS.md"), markdown(report));
writeFileSync(resolve(outputDirectory, "summary.sha256"), `${sha256(Buffer.from(json))}\n`);
console.log(JSON.stringify({
  format: report.format,
  lanes: report.source.lanes,
  configurations: report.source.configurations,
  cases: report.source.cases,
  summarySha256: sha256(Buffer.from(json)),
  findings: report.findings,
  resources: {
    hostileCases: hostileInputs.length,
    allRejected: report.resources.allRejected,
    worstHostileP95Milliseconds: report.resources.worstHostileP95Milliseconds,
    worstHostileArrayBufferDeltaBytes: report.resources.worstHostileArrayBufferDeltaBytes
  }
}, null, 2));
