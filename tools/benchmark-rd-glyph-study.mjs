#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { generateCorpus } from "../prototype/js/corpus-fixtures.mjs";
import { CADENCES, PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import { renderCells } from "../prototype/js/video64.mjs";
import {
  analyzeRateDistortionTimeline,
  encodeSceneAwareCellTimeline
} from "../prototype/js/rate-distortion.mjs";
import { benchmarkCommandBackends } from "../prototype/js/command-benchmark.mjs";
import { demuxV64, muxV64, verifyV64 } from "../prototype/js/container.mjs";

const FORMAT = "V64-RD-GLYPH-STUDY-1";
const outputDirectory = resolve(process.argv[2] || "bench/generated/rd-glyph-study");
const manifestPath = resolve(process.argv[3] || "bench/corpus/seed-manifest.json");
mkdirSync(outputDirectory, { recursive: true });

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function proxyFromRendered(image) {
  if (image.width % 2 || image.height % 2) {
    throw new RangeError("Study renderer must have even dimensions");
  }
  const width = image.width / 2;
  const height = image.height / 2;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let oy = 0; oy < 2; oy += 1) {
          for (let ox = 0; ox < 2; ox += 1) {
            const source = (((y * 2 + oy) * image.width) + x * 2 + ox) * 4;
            sum += image.rgba[source + channel];
          }
        }
        rgba[target + channel] = Math.round(sum / 4);
      }
      rgba[target + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function configurationDefinitions() {
  return [
    { id: "glyph-16", mode: "balanced", glyphCounts: [16] },
    { id: "glyph-32", mode: "balanced", glyphCounts: [32] },
    { id: "glyph-64", mode: "balanced", glyphCounts: [64] },
    { id: "rd-compact", mode: "compact" },
    { id: "rd-balanced", mode: "balanced" },
    { id: "rd-quality", mode: "quality" }
  ];
}

function analyzeFixture(fixture, configuration) {
  const entry = fixture.entry;
  const cadence = CADENCES.find((item) => item.label === entry.cadence);
  const paletteDepthId = PALETTE_DEPTHS.indexOf(entry.paletteDepth);
  const sourceFrames = [...fixture.frames, ...fixture.frames, ...fixture.frames];
  const rendered = sourceFrames.map((frame) => renderCells(
    frame,
    entry.grid.columns,
    entry.grid.rows,
    entry.paletteDepth
  ));
  const proxies = rendered.map(proxyFromRendered);
  const width = proxies[0].width;
  const height = proxies[0].height;
  const analysis = analyzeRateDistortionTimeline(
    proxies.map((item) => item.rgba),
    {
      mode: configuration.mode,
      glyphCounts: configuration.glyphCounts,
      width,
      height,
      columns: entry.grid.columns,
      rows: entry.grid.rows,
      paletteDepth: entry.paletteDepth,
      paletteDepthId,
      cadenceId: cadence.id,
      maximumGroupFrames: 48,
      minimumGroupFrames: 2,
      useDictionary: true
    }
  );
  const chunks = encodeSceneAwareCellTimeline(analysis);
  const file = muxV64({
    columns: entry.grid.columns,
    rows: entry.grid.rows,
    cadenceId: cadence.id,
    paletteDepthId
  }, chunks);
  const verification = verifyV64(file);
  if (verification.frames !== sourceFrames.length) {
    throw new Error(`Frame verification mismatch for ${entry.id}/${configuration.id}`);
  }
  const backend = benchmarkCommandBackends(demuxV64(file), {
    sourceFileBytes: file.length,
    groupDurationsSeconds: [2]
  });
  return {
    id: entry.id,
    structuralClass: entry.structuralClass,
    configuration: configuration.id,
    sourceFrames: sourceFrames.length,
    sourceTreatment: "three repetitions of deterministic CC0 seed fixture",
    containerBytes: file.length,
    containerSha256: sha256(file),
    independentGroups: analysis.metrics.independentGroups,
    maximumGroupFrames: Math.max(...analysis.plan.groups.map((group) => group.frames)),
    groupStarts: analysis.plan.starts,
    sceneCuts: analysis.metrics.sceneCuts,
    estimatedRateBytes: analysis.metrics.estimatedRateBytes,
    meanDistortion: analysis.metrics.meanDistortion,
    meanPsnr: analysis.metrics.meanPsnr,
    glyphSelections: analysis.metrics.glyphSelections,
    verification,
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

function aggregate(results, definitions) {
  return definitions.map((definition) => {
    const rows = results.filter((result) => result.configuration === definition.id);
    const sum = (selector) => rows.reduce((total, row) => total + selector(row), 0);
    const mean = (selector) => sum(selector) / rows.length;
    const zstandardValues = rows.map((row) => row.grammar.grammarBZstandardBytes);
    return {
      id: definition.id,
      mode: definition.mode,
      glyphCounts: definition.glyphCounts ?? null,
      fixtures: rows.length,
      containerBytes: sum((row) => row.containerBytes),
      independentGroups: sum((row) => row.independentGroups),
      sceneCuts: sum((row) => row.sceneCuts),
      meanDistortion: Number(mean((row) => row.meanDistortion).toFixed(9)),
      meanPsnr: Number(mean((row) => row.meanPsnr).toFixed(6)),
      glyphSelections: Object.fromEntries([16, 32, 64].map((count) => [
        count,
        sum((row) => row.glyphSelections[count])
      ])),
      grammar: {
        phase1CommandBytes: sum((row) => row.grammar.phase1CommandBytes),
        phase1GroupDeflateBytes: sum((row) => row.grammar.phase1GroupDeflateBytes),
        grammarBCommandBytes: sum((row) => row.grammar.grammarBCommandBytes),
        grammarBGroupDeflateBytes: sum((row) => row.grammar.grammarBGroupDeflateBytes),
        grammarBHuffmanBytes: sum((row) => row.grammar.grammarBHuffmanBytes),
        grammarBZstandardBytes: zstandardValues.every(Number.isFinite)
          ? zstandardValues.reduce((total, value) => total + value, 0)
          : null
      }
    };
  });
}

function rankings(aggregates) {
  const glyphRows = aggregates.filter((item) => item.id.startsWith("glyph-"));
  const modeRows = aggregates.filter((item) => item.id.startsWith("rd-"));
  const byBytes = [...modeRows].sort((a, b) =>
    a.containerBytes - b.containerBytes || a.meanDistortion - b.meanDistortion
  );
  const byDistortion = [...modeRows].sort((a, b) =>
    a.meanDistortion - b.meanDistortion || a.containerBytes - b.containerBytes
  );
  const grammarTotals = {
    phase1Deflate: aggregates.reduce(
      (sum, item) => sum + item.grammar.phase1GroupDeflateBytes, 0
    ),
    grammarBDeflate: aggregates.reduce(
      (sum, item) => sum + item.grammar.grammarBGroupDeflateBytes, 0
    ),
    grammarBHuffman: aggregates.reduce(
      (sum, item) => sum + item.grammar.grammarBHuffmanBytes, 0
    ),
    grammarBZstandard: aggregates.every((item) =>
      Number.isFinite(item.grammar.grammarBZstandardBytes))
      ? aggregates.reduce((sum, item) => sum + item.grammar.grammarBZstandardBytes, 0)
      : null
  };
  const backendCandidates = [
    ["raw-deflate", grammarTotals.grammarBDeflate],
    ["canonical-huffman", grammarTotals.grammarBHuffman],
    ["zstandard", grammarTotals.grammarBZstandard]
  ].filter((item) => Number.isFinite(item[1]));
  backendCandidates.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return {
    smallestMode: byBytes[0].id,
    lowestDistortionMode: byDistortion[0].id,
    glyphBudgetOrderByBytes: [...glyphRows]
      .sort((a, b) => a.containerBytes - b.containerBytes)
      .map((item) => item.id),
    glyphBudgetOrderByDistortion: [...glyphRows]
      .sort((a, b) => a.meanDistortion - b.meanDistortion)
      .map((item) => item.id),
    grammarTotals,
    provisionalGrammarWinner: grammarTotals.grammarBDeflate <= grammarTotals.phase1Deflate
      ? "grammar-b"
      : "phase-1",
    provisionalEntropyWinner: backendCandidates[0][0],
    freezeStatus: "evidence-only; no final grammar or entropy freeze"
  };
}

function markdown(report) {
  const lines = [
    "# V64 scene-cut, rate-distortion, and glyph-budget study",
    "",
    `Format: \`${report.format}\``,
    "",
    "This generated report uses all eleven deterministic CC0 structural classes.",
    "Each 24-frame fixture is repeated three times to exercise scene cuts and the",
    "frozen 48-frame / two-second maximum independent-group boundary.",
    "",
    "| Configuration | Bytes | Groups | Scene cuts | Mean distortion | Mean PSNR | 16/32/64 selections |",
    "|---|---:|---:|---:|---:|---:|---|"
  ];
  for (const item of report.aggregates) {
    lines.push(
      `| ${item.id} | ${item.containerBytes} | ${item.independentGroups} | ${item.sceneCuts} | ${item.meanDistortion} | ${item.meanPsnr} | ${item.glyphSelections[16]}/${item.glyphSelections[32]}/${item.glyphSelections[64]} |`
    );
  }
  lines.push(
    "",
    "## Provisional evidence",
    "",
    `- Smallest target mode: **${report.rankings.smallestMode}**.`,
    `- Lowest-distortion target mode: **${report.rankings.lowestDistortionMode}**.`,
    `- Grammar comparison leader: **${report.rankings.provisionalGrammarWinner}**.`,
    `- Entropy comparison leader: **${report.rankings.provisionalEntropyWinner}**.`,
    "- These are benchmark leaders, not normative freezes.",
    "",
    "The full JSON contains per-class hashes, verification counters, scene-cut",
    "counts, glyph selections, and grammar/backend byte totals."
  );
  return `${lines.join("\n")}\n`;
}

const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
const generated = generateCorpus(manifest);
const definitions = configurationDefinitions();
const results = [];
for (const fixture of generated.fixtures) {
  for (const definition of definitions) {
    results.push(analyzeFixture(fixture, definition));
  }
}
const aggregates = aggregate(results, definitions);
const manifestDisplay = relative(process.cwd(), manifestPath).replaceAll("\\", "/");
const report = {
  format: FORMAT,
  source: {
    manifest: manifestDisplay,
    manifestSha256: sha256(manifestBytes),
    license: "CC0-1.0",
    structuralClasses: generated.fixtures.map((fixture) => fixture.entry.structuralClass),
    fixtures: generated.fixtures.length,
    framesPerFixture: 72
  },
  configurations: definitions,
  results,
  aggregates,
  rankings: rankings(aggregates)
};
const json = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(resolve(outputDirectory, "summary.json"), json);
writeFileSync(resolve(outputDirectory, "RESULTS.md"), markdown(report));
writeFileSync(resolve(outputDirectory, "summary.sha256"), `${sha256(Buffer.from(json))}\n`);
console.log(JSON.stringify({
  format: report.format,
  fixtures: report.source.fixtures,
  configurations: definitions.length,
  cases: results.length,
  summarySha256: sha256(Buffer.from(json)),
  rankings: report.rankings
}, null, 2));
