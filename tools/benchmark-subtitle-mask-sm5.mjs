#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  analyzeRasterEntry,
  validateRasterCorpusManifest
} from "../prototype/js/raster-corpus.mjs";
import { benchmarkEntropyFixtures } from "../prototype/js/entropy-benchmark.mjs";
import { paletteAssetFromId } from "../prototype/js/palette-registry.mjs";
import { extractSubtitleMaskPlane } from "../prototype/js/subtitle-mask.mjs";
import { compositeSubtitleMaskPlane } from "../prototype/js/subtitle-mask-preview.mjs";
import {
  decodeSubtitleMaskSequence,
  encodeSubtitleMaskSequence,
  measureSubtitleMaskSequence
} from "../prototype/js/subtitle-mask-sm2.mjs";
import { selectSubtitleRegionsTemporally } from "../prototype/js/subtitle-mask-sm3.mjs";
import { stabilizeSubtitleSpans } from "../prototype/js/subtitle-mask-sm5.mjs";
import { renderCells } from "../prototype/js/video64.mjs";

const [manifestArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument || !outputArgument) {
  throw new Error("Usage: benchmark-subtitle-mask-sm5 MANIFEST.json OUTPUT_DIRECTORY");
}

const manifestPath = resolve(manifestArgument);
const outputDirectory = resolve(outputArgument);
const motionDirectory = resolve(outputDirectory, "motion");
const manifest = validateRasterCorpusManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
const sourceEntries = manifest.entries.filter((entry) => entry.structuralClass === "subtitles");
if (sourceEntries.length !== 8) {
  throw new Error(`SM5 full gate requires eight subtitle lanes; found ${sourceEntries.length}`);
}
const entries = sourceEntries.map((entry) => entry.paletteAsset === "V64-P256-CANDIDATE-1"
  ? entry
  : {
      ...entry,
      id: `${entry.id}-normative`,
      paletteAsset: "V64-P256-1"
    });
mkdirSync(motionDirectory, { recursive: true });

function runFfmpeg(args, input = null) {
  const result = spawnSync("ffmpeg", args, {
    input,
    encoding: null,
    maxBuffer: 1024 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${result.status}): ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}

function sourceFrames(entry) {
  if (entry.source.kind !== "local-file") {
    throw new Error(`SM5 requires local-file source: ${entry.id}`);
  }
  const path = resolve(entry.source.path);
  const bytes = readFileSync(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== entry.source.sha256) throw new Error(`Source hash mismatch for ${entry.id}`);
  const width = entry.grid.columns * 8;
  const height = entry.grid.rows * 16;
  const cadence = Number(entry.cadence);
  const raw = runFfmpeg([
    "-v", "error", "-i", path,
    "-t", String(entry.maximumSeconds),
    "-vf", `fps=${cadence},scale=${width}:${height}:flags=area`,
    "-an", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"
  ]);
  const frameBytes = width * height * 4;
  if (!raw.length || raw.length % frameBytes) {
    throw new Error(`Truncated source raster for ${entry.id}`);
  }
  return {
    path,
    width,
    height,
    cadence,
    frames: Array.from({ length: raw.length / frameBytes }, (_, index) =>
      Buffer.from(raw.subarray(index * frameBytes, (index + 1) * frameBytes)))
  };
}

function writeMotion(path, width, height, cadence, frames) {
  runFfmpeg([
    "-y", "-v", "error",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`,
    "-r", String(cadence), "-i", "pipe:0", "-an",
    "-map_metadata", "-1", "-metadata", "creation_time=1970-01-01T00:00:00Z",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18",
    "-pix_fmt", "yuv420p", "-threads", "1", "-movflags", "+faststart", path
  ], Buffer.concat(frames));
}

function blindCode(entryId, variant) {
  return createHash("sha256")
    .update(`V64-SUBTITLE-MASK-TRANCHE-5\0${manifest.id}\0${entryId}\0${variant}`)
    .digest("hex").slice(0, 8).toUpperCase();
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function canonicalSequence(planes, entry) {
  const options = {
    cellCount: entry.grid.columns * entry.grid.rows,
    paletteDepth: entry.paletteDepth
  };
  const bytes = encodeSubtitleMaskSequence(planes, options);
  const decoded = decodeSubtitleMaskSequence(bytes);
  const second = encodeSubtitleMaskSequence(decoded.frames, options);
  if (!bytes.equals(second)) throw new Error(`Non-canonical subtitle sequence for ${entry.id}`);
  return { decoded, metrics: measureSubtitleMaskSequence(planes, options) };
}

const rows = [];
const keyRows = [];
const laneMetrics = [];
const analyzedFixtures = [];

for (const entry of entries) {
  const analyzed = analyzeRasterEntry(entry);
  analyzedFixtures.push({ entry: analyzed.entry, frames: analyzed.frames });
  const source = sourceFrames(entry);
  if (source.frames.length !== analyzed.frames.length) {
    throw new Error(`Frame mismatch for ${entry.id}`);
  }
  const palette = paletteAssetFromId(entry.paletteAsset);
  const baseFrames = analyzed.frames.map((frame) => renderCells(
    frame,
    entry.grid.columns,
    entry.grid.rows,
    entry.paletteDepth,
    palette.colors
  ));
  const broadFrames = source.frames.map((rgba) => extractSubtitleMaskPlane(
    rgba,
    source.width,
    source.height,
    entry.grid.columns,
    entry.grid.rows,
    {
      palette: palette.colors,
      paletteDepth: entry.paletteDepth,
      bandStart: 0.68,
      contrastFloor: 48
    }
  ));
  const selectorOptions = {
    palette: palette.colors,
    paletteDepth: entry.paletteDepth,
    bandStart: 0.62,
    contrastFloor: 72,
    maxGap: 2,
    temporalGap: 3,
    persistenceFrames: 3,
    sparseFloor: Math.max(8, Math.ceil(entry.grid.columns * 0.14)),
    maxCellsPerFrame: Math.ceil(entry.grid.columns * 2)
  };
  const temporal = selectSubtitleRegionsTemporally(
    broadFrames,
    entry.grid.columns,
    entry.grid.rows,
    selectorOptions
  );
  const stabilized = stabilizeSubtitleSpans(temporal.frames, {
    cellCount: entry.grid.columns * entry.grid.rows,
    paletteDepth: entry.paletteDepth,
    boundarySimilarity: 0.42,
    minimumSpanFrames: 2,
    sparseFrameCells: 2,
    minimumFrameFraction: 0.25,
    bitThreshold: 0.35,
    minimumMaskBits: 3,
    maximumMaskBits: 112
  });
  const sm4 = canonicalSequence(stabilized.frames, entry);

  const sm4Frames = sm4.decoded.frames.map((plane, frameIndex) =>
    compositeSubtitleMaskPlane(
      baseFrames[frameIndex],
      {
        cellCount: entry.grid.columns * entry.grid.rows,
        paletteDepth: entry.paletteDepth,
        entries: plane
      },
      entry.grid.columns,
      entry.grid.rows,
      palette.colors
    ));
  const variants = [
    { name: "base", frames: baseFrames },
    { name: "sm4-span", frames: sm4Frames }
  ];
  const outputs = {};
  for (const variant of variants) {
    const code = blindCode(entry.id, variant.name);
    const output = resolve(motionDirectory, `${code}.mp4`);
    writeMotion(
      output,
      variant.frames[0].width,
      variant.frames[0].height,
      source.cadence,
      variant.frames.map((image) => image.rgba)
    );
    const bytes = readFileSync(output);
    outputs[variant.name] = {
      code,
      bytes: statSync(output).size,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
    rows.push({
      group: `${entry.review.group}-sm4-full`,
      code,
      grid: `${entry.grid.columns}x${entry.grid.rows}`,
      motion: `motion/${code}.mp4`,
      bytes: outputs[variant.name].bytes,
      sha256: outputs[variant.name].sha256
    });
    keyRows.push({
      code,
      group: `${entry.review.group}-sm4-full`,
      entryId: entry.id,
      paletteAsset: entry.paletteAsset,
      variant: variant.name,
      metrics: variant.name === "sm4-span" ? sm4.metrics : null,
      spans: variant.name === "sm4-span" ? stabilized.spans : null
    });
  }

  laneMetrics.push({
    entryId: entry.id,
    paletteAsset: entry.paletteAsset,
    grid: `${entry.grid.columns}x${entry.grid.rows}`,
    frames: broadFrames.length,
    broadCells: broadFrames.reduce((sum, frame) => sum + frame.length, 0),
    temporalCells: temporal.frames.reduce((sum, frame) => sum + frame.length, 0),
    stabilizedCells: stabilized.frames.reduce((sum, frame) => sum + frame.length, 0),
    spanCount: stabilized.spans.length,
    spans: stabilized.spans,
    sequence: sm4.metrics,
    temporalDiagnostics: temporal.diagnostics,
    stabilizationDiagnostics: stabilized.diagnostics
  });
}

const baseReport = benchmarkEntropyFixtures({
  id: `${manifest.id}-SUBTITLES-NORMATIVE`,
  title: `${manifest.title} full subtitle subset with normative palette`,
  scope: "Eight matched legacy/normative subtitle lanes used for full SM4 span-aware total-byte accounting."
}, analyzedFixtures, {
  groupDurationsSeconds: [2],
  measurePerformance: false
});

const aggregate = laneMetrics.reduce((result, lane) => {
  result.frames += lane.frames;
  result.broadCells += lane.broadCells;
  result.temporalCells += lane.temporalCells;
  result.stabilizedCells += lane.stabilizedCells;
  result.spanCount += lane.spanCount;
  result.sm4DeflateBytes += lane.sequence.deflateBytes;
  return result;
}, {
  lanes: laneMetrics.length,
  frames: 0,
  broadCells: 0,
  temporalCells: 0,
  stabilizedCells: 0,
  spanCount: 0,
  sm4DeflateBytes: 0
});
aggregate.baseV64SelectedDeflateBytes = baseReport.totals.selectedDeflateBytes;
aggregate.totalV64PlusSm4DeflateBytes = aggregate.baseV64SelectedDeflateBytes + aggregate.sm4DeflateBytes;
aggregate.sm4OverheadPercent = Number((aggregate.sm4DeflateBytes /
  Math.max(1, aggregate.baseV64SelectedDeflateBytes) * 100).toFixed(3));
aggregate.sm4KilobitsPerSecond = Number((aggregate.sm4DeflateBytes * 8 /
  (aggregate.lanes * 2) / 1000).toFixed(3));

rows.sort((a, b) => a.group.localeCompare(b.group) || a.code.localeCompare(b.code));
const worksheet = [[
  "group", "code", "grid", "subtitle_transcription", "edge_clarity_1_to_5",
  "temporal_stability_1_to_5", "scene_preservation_1_to_5", "notes"
].join(",")];
for (const row of rows) {
  worksheet.push([row.group, row.code, row.grid, "", "", "", "", ""].map(csv).join(","));
}

writeFileSync(resolve(outputDirectory, "worksheet.csv"), `${worksheet.join("\n")}\n`);
writeFileSync(resolve(outputDirectory, "public-manifest.json"), `${JSON.stringify({
  format: "V64-SUBTITLE-MASK-REVIEW-PUBLIC-5",
  sourceManifest: manifest.id,
  rows
}, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "summary.json"), `${JSON.stringify({
  format: "V64-SUBTITLE-MASK-TRANCHE-5",
  sourceManifest: manifest.id,
  focus: "full eight-lane SM4 span-aware subtitle gate",
  palettePair: ["V64-P256-CANDIDATE-1", "V64-P256-1"],
  aggregate,
  baseV64: baseReport.totals,
  laneMetrics,
  reviewClips: rows.length
}, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "key.json"), `${JSON.stringify({
  format: "V64-SUBTITLE-MASK-REVIEW-KEY-5",
  warning: "Keep hidden until transcription and motion scoring are complete.",
  rows: keyRows
}, null, 2)}\n`);

console.log(JSON.stringify({
  format: "V64-SUBTITLE-MASK-TRANCHE-BUILD-5",
  outputDirectory,
  aggregate,
  reviewClips: rows.length
}, null, 2));
