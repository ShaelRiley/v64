#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { demuxV64 } from "../prototype/js/container.mjs";
import {
  benchmarkPreparedGrammar,
  grammarDecoderComplexity,
  prepareGrammarComparison
} from "../prototype/js/grammar-comparison.mjs";

const FORMAT = "V64-COMBINED-GRAMMAR-GATE-1";
const structuralSummaryPath = resolve(
  process.argv[2] || "bench/generated/rd-glyph-study/summary.json"
);
const humanSummaryPath = resolve(
  process.argv[3] || "bench/generated/human-rd-glyph-study/summary.json"
);
const humanFilesDirectory = resolve(
  process.argv[4] || "bench/generated/human-rd-glyph-study/files"
);
const outputDirectory = resolve(
  process.argv[5] || "bench/generated/combined-grammar-study"
);
mkdirSync(outputDirectory, { recursive: true });

const CORPUS_WEIGHTS = Object.freeze({ structural: 0.25, human: 0.75 });
const REQUIRED_WEIGHTED_SAVINGS_PERCENT = 1;
const MAXIMUM_CORPUS_REGRESSION_PERCENT = 1;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function percentSavings(before, after) {
  return before ? Number(((before - after) / before * 100).toFixed(3)) : 0;
}

function readJson(path) {
  const bytes = readFileSync(path);
  return { bytes, value: JSON.parse(bytes) };
}

function grammarTotals(summary, corpus) {
  if (corpus === "structural") {
    const totals = summary.rankings?.grammarTotals ?? summary.grammarTotals;
    if (!totals) throw new Error("Structural summary has no grammar totals");
    return {
      phase1DeflateBytes: totals.phase1Deflate,
      grammarBDeflateBytes: totals.grammarBDeflate,
      grammarBHuffmanBytes: totals.grammarBHuffman,
      grammarBZstandardBytes: totals.grammarBZstandard
    };
  }
  const totals = summary.findings?.grammar;
  if (!totals) throw new Error("Human summary has no grammar totals");
  return {
    phase1DeflateBytes: totals.phase1DeflateBytes ?? totals.phase1GroupDeflateBytes,
    grammarBDeflateBytes: totals.grammarBDeflateBytes ?? totals.grammarBGroupDeflateBytes,
    grammarBHuffmanBytes: totals.grammarBHuffmanBytes,
    grammarBZstandardBytes: totals.grammarBZstandardBytes
  };
}

function checkedTotals(totals, corpus) {
  for (const [name, value] of Object.entries(totals)) {
    if (name === "grammarBZstandardBytes" && value === null) continue;
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${corpus} ${name} must be a finite nonnegative number`);
    }
  }
  return totals;
}

function listV64Files(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".v64"))
    .map((entry) => resolve(directory, entry.name))
    .sort();
}

function aggregateDecoderRows(rows, grammar) {
  const selected = rows.map((row) => row[grammar]);
  const sum = (key) => selected.reduce((total, row) => total + row[key], 0);
  return {
    files: selected.length,
    nominalFrames: sum("nominalFrames"),
    codedFrames: sum("codedFrames"),
    repeatFrames: sum("repeatFrames"),
    medianMillisecondsPerFile: Number(
      (sum("medianMilliseconds") / selected.length).toFixed(3)
    ),
    worstP95Milliseconds: Number(
      Math.max(...selected.map((row) => row.p95Milliseconds)).toFixed(3)
    ),
    totalMedianMilliseconds: Number(sum("medianMilliseconds").toFixed(3)),
    peakHeapDeltaBytes: Math.max(...selected.map((row) => row.peakHeapDeltaBytes)),
    peakArrayBufferDeltaBytes: Math.max(
      ...selected.map((row) => row.peakArrayBufferDeltaBytes)
    ),
    peakRssDeltaBytes: Math.max(...selected.map((row) => row.peakRssDeltaBytes))
  };
}

function measureHumanDecoders(directory) {
  const files = listV64Files(directory);
  if (!files.length) throw new Error("Combined grammar gate found no human .v64 files");
  const rows = files.map((path) => {
    const bytes = readFileSync(path);
    const prepared = prepareGrammarComparison(demuxV64(bytes));
    return {
      file: basename(path),
      bytes: bytes.length,
      sha256: sha256(bytes),
      phase1: benchmarkPreparedGrammar(prepared, "phase1", 5),
      grammarB: benchmarkPreparedGrammar(prepared, "grammarB", 5)
    };
  });
  return {
    files: rows.length,
    rows,
    aggregates: {
      phase1: aggregateDecoderRows(rows, "phase1"),
      grammarB: aggregateDecoderRows(rows, "grammarB")
    }
  };
}

function decision(structural, human, decoder, complexity) {
  const structuralSavings = percentSavings(
    structural.phase1DeflateBytes,
    structural.grammarBDeflateBytes
  );
  const humanSavings = percentSavings(
    human.phase1DeflateBytes,
    human.grammarBDeflateBytes
  );
  const weightedSavings = Number((
    structuralSavings * CORPUS_WEIGHTS.structural +
    humanSavings * CORPUS_WEIGHTS.human
  ).toFixed(3));
  const grammarBDecodeDeltaPercent = Number((
    (decoder.grammarB.totalMedianMilliseconds - decoder.phase1.totalMedianMilliseconds) /
    decoder.phase1.totalMedianMilliseconds * 100
  ).toFixed(3));
  const grammarBComplexityIncrease = {
    opcodeCount: complexity.grammarB.opcodeCount - complexity.phase1.opcodeCount,
    sourceBytes: complexity.grammarB.sourceBytes - complexity.phase1.sourceBytes,
    decisionTokens: complexity.grammarB.decisionTokens - complexity.phase1.decisionTokens,
    loopTokens: complexity.grammarB.loopTokens - complexity.phase1.loopTokens
  };
  const noMaterialRegression = structuralSavings >= -MAXIMUM_CORPUS_REGRESSION_PERCENT &&
    humanSavings >= -MAXIMUM_CORPUS_REGRESSION_PERCENT;
  const earnsComplexity = weightedSavings >= REQUIRED_WEIGHTED_SAVINGS_PERCENT &&
    noMaterialRegression;

  return {
    corpusWeights: CORPUS_WEIGHTS,
    requiredWeightedSavingsPercent: REQUIRED_WEIGHTED_SAVINGS_PERCENT,
    maximumCorpusRegressionPercent: MAXIMUM_CORPUS_REGRESSION_PERCENT,
    structuralSavingsPercent: structuralSavings,
    humanSavingsPercent: humanSavings,
    weightedSavingsPercent: weightedSavings,
    grammarBDecodeTimeDeltaPercent: grammarBDecodeDeltaPercent,
    grammarBComplexityIncrease,
    noMaterialRegression,
    selectedGrammar: earnsComplexity ? "grammar-b" : "phase-1",
    freezeStatus: earnsComplexity
      ? "provisional combined-corpus winner; cross-language validation still required"
      : "retain Phase-1; Grammar B does not yet earn its decoder complexity",
    rationale: earnsComplexity
      ? "Grammar B clears the weighted complete-file threshold without materially regressing either corpus."
      : "Grammar B fails the weighted savings threshold or materially regresses at least one corpus while increasing decoder complexity."
  };
}

function markdown(report) {
  const lines = [
    "# Video 64 combined grammar decision gate",
    "",
    `Format: \`${report.format}\``,
    "",
    "This gate combines the deterministic structural corpus and legally reusable",
    "human raster corpus. Human material receives 75% decision weight and the",
    "structural stress corpus receives 25%. A more complex grammar must save at",
    "least 1% after weighting and may not regress either corpus by more than 1%.",
    "",
    "| Corpus | Phase-1 DEFLATE bytes | Grammar B DEFLATE bytes | Grammar B savings | Weight |",
    "|---|---:|---:|---:|---:|",
    `| structural | ${report.corpora.structural.phase1DeflateBytes} | ${report.corpora.structural.grammarBDeflateBytes} | ${report.decision.structuralSavingsPercent}% | 25% |`,
    `| human | ${report.corpora.human.phase1DeflateBytes} | ${report.corpora.human.grammarBDeflateBytes} | ${report.decision.humanSavingsPercent}% | 75% |`,
    "",
    `Weighted Grammar B savings: **${report.decision.weightedSavingsPercent}%**.`,
    `Selected grammar: **${report.decision.selectedGrammar}**.`,
    "",
    "## Decoder measurements on human files",
    "",
    "| Decoder | Files | Nominal frames | Total median ms | Worst p95 ms | Peak heap delta | Peak ArrayBuffer delta |",
    "|---|---:|---:|---:|---:|---:|---:|",
    `| Phase-1 | ${report.decoder.aggregates.phase1.files} | ${report.decoder.aggregates.phase1.nominalFrames} | ${report.decoder.aggregates.phase1.totalMedianMilliseconds} | ${report.decoder.aggregates.phase1.worstP95Milliseconds} | ${report.decoder.aggregates.phase1.peakHeapDeltaBytes} | ${report.decoder.aggregates.phase1.peakArrayBufferDeltaBytes} |`,
    `| Grammar B | ${report.decoder.aggregates.grammarB.files} | ${report.decoder.aggregates.grammarB.nominalFrames} | ${report.decoder.aggregates.grammarB.totalMedianMilliseconds} | ${report.decoder.aggregates.grammarB.worstP95Milliseconds} | ${report.decoder.aggregates.grammarB.peakHeapDeltaBytes} | ${report.decoder.aggregates.grammarB.peakArrayBufferDeltaBytes} |`,
    "",
    `Grammar B decode-time delta: **${report.decision.grammarBDecodeTimeDeltaPercent}%**.`,
    "",
    "## Static decoder surface",
    "",
    "| Decoder | Opcodes | Function bytes | Function lines | Decision tokens | Loop tokens |",
    "|---|---:|---:|---:|---:|---:|",
    `| Phase-1 | ${report.complexity.phase1.opcodeCount} | ${report.complexity.phase1.sourceBytes} | ${report.complexity.phase1.sourceLines} | ${report.complexity.phase1.decisionTokens} | ${report.complexity.phase1.loopTokens} |`,
    `| Grammar B | ${report.complexity.grammarB.opcodeCount} | ${report.complexity.grammarB.sourceBytes} | ${report.complexity.grammarB.sourceLines} | ${report.complexity.grammarB.decisionTokens} | ${report.complexity.grammarB.loopTokens} |`,
    "",
    `Decision status: ${report.decision.freezeStatus}.`,
    "",
    "The JSON report contains per-file hashes and resource measurements. This",
    "JavaScript result does not replace the required Rust and WebAssembly golden",
    "agreement before a final V1 grammar freeze."
  ];
  return `${lines.join("\n")}\n`;
}

const structuralInput = readJson(structuralSummaryPath);
const humanInput = readJson(humanSummaryPath);
const structural = checkedTotals(
  grammarTotals(structuralInput.value, "structural"),
  "structural"
);
const human = checkedTotals(grammarTotals(humanInput.value, "human"), "human");
const decoder = measureHumanDecoders(humanFilesDirectory);
const complexity = grammarDecoderComplexity();
const report = {
  format: FORMAT,
  inputs: {
    structuralSummary: relative(process.cwd(), structuralSummaryPath).replaceAll("\\", "/"),
    structuralSummarySha256: sha256(structuralInput.bytes),
    humanSummary: relative(process.cwd(), humanSummaryPath).replaceAll("\\", "/"),
    humanSummarySha256: sha256(humanInput.bytes),
    humanFilesDirectory: relative(process.cwd(), humanFilesDirectory).replaceAll("\\", "/")
  },
  corpora: { structural, human },
  decoder,
  complexity,
  decision: decision(structural, human, decoder.aggregates, complexity)
};
const json = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(resolve(outputDirectory, "summary.json"), json);
writeFileSync(resolve(outputDirectory, "RESULTS.md"), markdown(report));
writeFileSync(resolve(outputDirectory, "summary.sha256"), `${sha256(Buffer.from(json))}\n`);
console.log(JSON.stringify({
  format: report.format,
  selectedGrammar: report.decision.selectedGrammar,
  weightedSavingsPercent: report.decision.weightedSavingsPercent,
  grammarBDecodeTimeDeltaPercent: report.decision.grammarBDecodeTimeDeltaPercent,
  humanFiles: report.decoder.files,
  summarySha256: sha256(Buffer.from(json))
}, null, 2));
