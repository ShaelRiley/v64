#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
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
  measureSubtitleMaskSequence,
  selectSubtitleRegions
} from "../prototype/js/subtitle-mask-sm2.mjs";
import { renderCells } from "../prototype/js/video64.mjs";

const [manifestArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument || !outputArgument) {
  throw new Error("Usage: benchmark-subtitle-mask-sm2 MANIFEST.json OUTPUT_DIRECTORY");
}

const manifestPath = resolve(manifestArgument);
const outputDirectory = resolve(outputArgument);
const motionDirectory = resolve(outputDirectory, "motion");
const manifest = validateRasterCorpusManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
const subtitleEntries = manifest.entries.filter((entry) => entry.structuralClass === "subtitles");
if (!subtitleEntries.length) throw new Error("SM2 benchmark requires subtitle entries");
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
    throw new Error(`SM2 benchmark currently requires local-file sources: ${entry.id}`);
  }
  const path = resolve(entry.source.path);
  const sourceBytes = readFileSync(path);
  const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
  if (actualHash !== entry.source.sha256) throw new Error(`Subtitle source hash mismatch for ${entry.id}`);
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
  if (!raw.length || raw.length % frameBytes) throw new Error(`Truncated subtitle raster for ${entry.id}`);
  return {
    path,
    width,
    height,
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
    .update(`V64-SUBTITLE-MASK-TRANCHE-2\0${manifest.id}\0${entryId}\0${variant}`)
    .digest("hex").slice(0, 8).toUpperCase();
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const publicRows = [];
const keyRows = [];
const laneMetrics = [];
const analyzedFixtures = [];

for (const entry of subtitleEntries) {
  const analyzed = analyzeRasterEntry(entry);
  analyzedFixtures.push({ entry: analyzed.entry, frames: analyzed.frames });
  const source = sourceFrames(entry);
  if (source.frames.length !== analyzed.frames.length) {
    throw new Error(`Full-cell and glyph analyses disagree on frame count for ${entry.id}`);
  }
  const palette = paletteAssetFromId(entry.paletteAsset);
  const baseFrames = analyzed.frames.map((frame) => renderCells(
    frame,
    entry.grid.columns,
    entry.grid.rows,
    entry.paletteDepth,
    palette.colors
  ));

  let sm1Cells = 0;
  let sm2Cells = 0;
  const selectedPlanes = source.frames.map((rgba) => {
    const broad = extractSubtitleMaskPlane(
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
    );
    sm1Cells += broad.length;
    const selected = selectSubtitleRegions(
      broad,
      entry.grid.columns,
      entry.grid.rows,
      {
        palette: palette.colors,
        paletteDepth: entry.paletteDepth,
        bandStart: 0.62,
        contrastFloor: 72,
        maxGap: 2
      }
    );
    sm2Cells += selected.length;
    return selected;
  });

  const sequence = encodeSubtitleMaskSequence(selectedPlanes, {
    cellCount: entry.grid.columns * entry.grid.rows,
    paletteDepth: entry.paletteDepth
  });
  const decoded = decodeSubtitleMaskSequence(sequence);
  const reencoded = encodeSubtitleMaskSequence(decoded.frames, {
    cellCount: decoded.cellCount,
    paletteDepth: decoded.paletteDepth
  });
  if (!sequence.equals(reencoded)) throw new Error(`SM2 canonical round trip failed for ${entry.id}`);

  const maskedFrames = decoded.frames.map((entries, frameIndex) => compositeSubtitleMaskPlane(
    baseFrames[frameIndex],
    {
      cellCount: entry.grid.columns * entry.grid.rows,
      paletteDepth: entry.paletteDepth,
      entries
    },
    entry.grid.columns,
    entry.grid.rows,
    palette.colors
  ));

  const variants = [
    { name: "base", frames: baseFrames },
    { name: "sm2", frames: maskedFrames }
  ];
  const outputs = {};
  for (const variant of variants) {
    const code = blindCode(entry.id, variant.name);
    const output = resolve(motionDirectory, `${code}.mp4`);
    writeMotion(
      output,
      variant.frames[0].width,
      variant.frames[0].height,
      Number(entry.cadence),
      variant.frames.map((image) => image.rgba)
    );
    const bytes = readFileSync(output);
    outputs[variant.name] = {
      code,
      bytes: statSync(output).size,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
    publicRows.push({
      code,
      group: `${entry.review.group}-sm2`,
      columns: entry.grid.columns,
      rows: entry.grid.rows,
      motion: `motion/${code}.mp4`,
      bytes: outputs[variant.name].bytes,
      sha256: outputs[variant.name].sha256,
      questions: [
        "Transcribe the subtitle exactly",
        "Rate subtitle edge clarity",
        "Rate temporal stability",
        "Rate preservation of faces, gestures, profiles, and staging"
      ]
    });
  }

  const sequenceMetrics = measureSubtitleMaskSequence(selectedPlanes, {
    cellCount: entry.grid.columns * entry.grid.rows,
    paletteDepth: entry.paletteDepth
  });
  const metric = {
    entryId: entry.id,
    paletteAsset: entry.paletteAsset,
    source: basename(source.path),
    grid: `${entry.grid.columns}x${entry.grid.rows}`,
    frames: selectedPlanes.length,
    sm1CandidateCells: sm1Cells,
    sm2SelectedCells: sm2Cells,
    selectedCellReductionPercent: Number(((1 - sm2Cells / Math.max(1, sm1Cells)) * 100).toFixed(3)),
    meanSelectedCellsPerFrame: Number((sm2Cells / selectedPlanes.length).toFixed(3)),
    ...sequenceMetrics,
    baseMotionBytes: outputs.base.bytes,
    sm2MotionBytes: outputs.sm2.bytes
  };
  laneMetrics.push(metric);
  for (const variant of variants) {
    keyRows.push({
      code: outputs[variant.name].code,
      group: `${entry.review.group}-sm2`,
      entryId: entry.id,
      paletteAsset: entry.paletteAsset,
      variant: variant.name,
      source: entry.source.path,
      metrics: variant.name === "sm2" ? metric : null
    });
  }
}

const baseReport = benchmarkEntropyFixtures({
  id: `${manifest.id}-SUBTITLES`,
  title: `${manifest.title} subtitle subset`,
  scope: "Identical base V64 subtitle lanes used for total-byte accounting against SM2."
}, analyzedFixtures, {
  groupDurationsSeconds: [2],
  measurePerformance: false
});

const aggregate = laneMetrics.reduce((result, metric) => {
  result.frames += metric.frames;
  result.sm1CandidateCells += metric.sm1CandidateCells;
  result.sm2SelectedCells += metric.sm2SelectedCells;
  result.sm2Bytes += metric.bytes;
  result.sm2DeflateBytes += metric.deflateBytes;
  return result;
}, {
  lanes: laneMetrics.length,
  frames: 0,
  sm1CandidateCells: 0,
  sm2SelectedCells: 0,
  sm2Bytes: 0,
  sm2DeflateBytes: 0
});
aggregate.selectedCellReductionPercent = Number(((1 - aggregate.sm2SelectedCells /
  Math.max(1, aggregate.sm1CandidateCells)) * 100).toFixed(3));
aggregate.baseV64SelectedDeflateBytes = baseReport.totals.selectedDeflateBytes;
aggregate.totalV64PlusSm2DeflateBytes = aggregate.baseV64SelectedDeflateBytes + aggregate.sm2DeflateBytes;
aggregate.sm2OverheadPercentOfBase = Number((aggregate.sm2DeflateBytes /
  Math.max(1, aggregate.baseV64SelectedDeflateBytes) * 100).toFixed(3));
aggregate.sm2KilobitsPerSecond = Number((aggregate.sm2DeflateBytes * 8 /
  (aggregate.lanes * 2) / 1000).toFixed(3));

publicRows.sort((a, b) => a.group.localeCompare(b.group) || a.code.localeCompare(b.code));
const worksheet = [[
  "group", "code", "grid", "subtitle_transcription", "edge_clarity_1_to_5",
  "temporal_stability_1_to_5", "scene_preservation_1_to_5", "notes"
].join(",")];
for (const row of publicRows) {
  worksheet.push([
    row.group, row.code, `${row.columns}x${row.rows}`, "", "", "", "", ""
  ].map(csv).join(","));
}

writeFileSync(resolve(outputDirectory, "worksheet.csv"), `${worksheet.join("\n")}\n`);
writeFileSync(resolve(outputDirectory, "public-manifest.json"), `${JSON.stringify({
  format: "V64-SUBTITLE-MASK-REVIEW-PUBLIC-2",
  sourceManifest: manifest.id,
  rows: publicRows
}, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "summary.json"), `${JSON.stringify({
  format: "V64-SUBTITLE-MASK-TRANCHE-2",
  sourceManifest: manifest.id,
  extraction: {
    source: "SM1 lower-band candidates",
    selection: "wide, shallow, high-contrast connected subtitle-like regions",
    temporalCoding: ["full-plane", "repeat-plane-span", "cell-removal-and-upsert-delta"],
    note: "SM2 remains experimental and outside the V64 container."
  },
  aggregate,
  baseV64: baseReport.totals,
  laneMetrics,
  reviewClips: publicRows.length
}, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "key.json"), `${JSON.stringify({
  format: "V64-SUBTITLE-MASK-REVIEW-KEY-2",
  warning: "Keep hidden until subtitle transcription and motion scoring are complete.",
  sourceManifest: manifest.id,
  rows: keyRows
}, null, 2)}\n`);

console.log(JSON.stringify({
  format: "V64-SUBTITLE-MASK-TRANCHE-BUILD-2",
  sourceManifest: manifest.id,
  outputDirectory,
  aggregate,
  reviewClips: publicRows.length
}, null, 2));
