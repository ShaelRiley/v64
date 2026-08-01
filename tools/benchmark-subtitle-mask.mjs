#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  mkdirSync, readFileSync, statSync, writeFileSync
} from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  analyzeRasterEntry,
  validateRasterCorpusManifest
} from "../prototype/js/raster-corpus.mjs";
import { paletteAssetFromId } from "../prototype/js/palette-registry.mjs";
import {
  decodeSubtitleMaskPlane,
  encodeSubtitleMaskPlane,
  extractSubtitleMaskPlane
} from "../prototype/js/subtitle-mask.mjs";
import {
  compositeSubtitleMaskPlane,
  measureSubtitleMaskPlanes
} from "../prototype/js/subtitle-mask-preview.mjs";
import { renderCells } from "../prototype/js/video64.mjs";

const [manifestArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument || !outputArgument) {
  throw new Error("Usage: benchmark-subtitle-mask MANIFEST.json OUTPUT_DIRECTORY");
}

const manifestPath = resolve(manifestArgument);
const outputDirectory = resolve(outputArgument);
const motionDirectory = resolve(outputDirectory, "motion");
const manifest = validateRasterCorpusManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
const subtitleEntries = manifest.entries.filter((entry) => entry.structuralClass === "subtitles");
if (!subtitleEntries.length) throw new Error("Subtitle-mask benchmark requires subtitle entries");
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
    throw new Error(`Subtitle-mask benchmark currently requires local-file sources: ${entry.id}`);
  }
  const path = resolve(entry.source.path);
  const sourceBytes = readFileSync(path);
  const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
  if (actualHash !== entry.source.sha256) {
    throw new Error(`Subtitle source hash mismatch for ${entry.id}`);
  }
  const width = entry.grid.columns * 8;
  const height = entry.grid.rows * 16;
  const cadence = Number(entry.cadence);
  const raw = runFfmpeg([
    "-v", "error",
    "-i", path,
    "-t", String(entry.maximumSeconds),
    "-vf", `fps=${cadence},scale=${width}:${height}:flags=area`,
    "-an",
    "-pix_fmt", "rgba",
    "-f", "rawvideo",
    "pipe:1"
  ]);
  const frameBytes = width * height * 4;
  if (!raw.length || raw.length % frameBytes) {
    throw new Error(`Truncated full-cell subtitle raster for ${entry.id}`);
  }
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
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${width}x${height}`,
    "-r", String(cadence),
    "-i", "pipe:0",
    "-an",
    "-map_metadata", "-1",
    "-metadata", "creation_time=1970-01-01T00:00:00Z",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-threads", "1",
    "-movflags", "+faststart",
    path
  ], Buffer.concat(frames));
}

function blindCode(entryId, variant) {
  return createHash("sha256")
    .update(`V64-SUBTITLE-MASK-TRANCHE-1\0${manifest.id}\0${entryId}\0${variant}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const publicRows = [];
const keyRows = [];
const laneMetrics = [];

for (const entry of subtitleEntries) {
  const analyzed = analyzeRasterEntry(entry);
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

  const planes = [];
  const activeCells = [];
  const maskedFrames = source.frames.map((rgba, frameIndex) => {
    const entries = extractSubtitleMaskPlane(
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
    activeCells.push(entries.length);
    const encoded = encodeSubtitleMaskPlane(entries, {
      cellCount: entry.grid.columns * entry.grid.rows,
      paletteDepth: entry.paletteDepth
    });
    const decoded = decodeSubtitleMaskPlane(encoded);
    const reencoded = encodeSubtitleMaskPlane(decoded.entries, {
      cellCount: decoded.cellCount,
      paletteDepth: decoded.paletteDepth
    });
    if (!encoded.equals(reencoded)) {
      throw new Error(`Subtitle-mask canonical round trip failed for ${entry.id} frame ${frameIndex}`);
    }
    planes.push(encoded);
    return compositeSubtitleMaskPlane(
      baseFrames[frameIndex],
      decoded,
      entry.grid.columns,
      entry.grid.rows,
      palette.colors
    );
  });

  const cadence = Number(entry.cadence);
  const variants = [
    { name: "base", frames: baseFrames },
    { name: "sm1", frames: maskedFrames }
  ];
  const variantOutputs = {};
  for (const variant of variants) {
    const code = blindCode(entry.id, variant.name);
    const output = resolve(motionDirectory, `${code}.mp4`);
    writeMotion(
      output,
      variant.frames[0].width,
      variant.frames[0].height,
      cadence,
      variant.frames.map((image) => image.rgba)
    );
    const bytes = readFileSync(output);
    variantOutputs[variant.name] = {
      code,
      bytes: statSync(output).size,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
    publicRows.push({
      code,
      group: `${entry.review.group}-mask-plane`,
      structuralClass: entry.structuralClass,
      columns: entry.grid.columns,
      rows: entry.grid.rows,
      questions: [
        "Transcribe the subtitle exactly",
        "Rate subtitle edge clarity",
        "Rate temporal stability",
        "Rate preservation of faces, gestures, profiles, and staging"
      ],
      recognizabilityTargets: entry.recognizabilityTargets || [],
      motion: `motion/${code}.mp4`,
      bytes: variantOutputs[variant.name].bytes,
      sha256: variantOutputs[variant.name].sha256
    });
  }

  const planeMetrics = measureSubtitleMaskPlanes(planes);
  const metric = {
    entryId: entry.id,
    paletteAsset: entry.paletteAsset,
    source: basename(source.path),
    grid: `${entry.grid.columns}x${entry.grid.rows}`,
    frames: planes.length,
    totalActiveCells: activeCells.reduce((sum, value) => sum + value, 0),
    meanActiveCells: Number((activeCells.reduce((sum, value) => sum + value, 0) /
      Math.max(1, activeCells.length)).toFixed(3)),
    maximumActiveCells: Math.max(...activeCells),
    activeCellPercent: Number((activeCells.reduce((sum, value) => sum + value, 0) /
      (planes.length * entry.grid.columns * entry.grid.rows) * 100).toFixed(3)),
    ...planeMetrics,
    baseMotionBytes: variantOutputs.base.bytes,
    maskedMotionBytes: variantOutputs.sm1.bytes
  };
  laneMetrics.push(metric);
  for (const variant of variants) {
    keyRows.push({
      code: variantOutputs[variant.name].code,
      group: `${entry.review.group}-mask-plane`,
      entryId: entry.id,
      paletteAsset: entry.paletteAsset,
      variant: variant.name,
      source: entry.source.path,
      metrics: variant.name === "sm1" ? metric : null
    });
  }
}

publicRows.sort((a, b) => a.group.localeCompare(b.group) || a.code.localeCompare(b.code));
const worksheetHeader = [
  "group", "code", "grid", "questions", "targets",
  "subtitle_transcription", "edge_clarity_1_to_5",
  "temporal_stability_1_to_5", "scene_preservation_1_to_5", "notes"
];
const worksheetLines = [worksheetHeader.join(",")];
for (const row of publicRows) {
  worksheetLines.push([
    row.group,
    row.code,
    `${row.columns}x${row.rows}`,
    row.questions.join(" | "),
    row.recognizabilityTargets.join(" | "),
    "", "", "", "", ""
  ].map(csv).join(","));
}

const aggregate = laneMetrics.reduce((result, metric) => {
  result.frames += metric.frames;
  result.totalActiveCells += metric.totalActiveCells;
  result.payloadBytes += metric.payloadBytes;
  result.framingBytes += metric.framingBytes;
  result.framedBytes += metric.framedBytes;
  result.deflateBytes += metric.deflateBytes;
  return result;
}, {
  lanes: laneMetrics.length,
  frames: 0,
  totalActiveCells: 0,
  payloadBytes: 0,
  framingBytes: 0,
  framedBytes: 0,
  deflateBytes: 0
});
aggregate.meanActiveCellsPerFrame = Number((aggregate.totalActiveCells /
  Math.max(1, aggregate.frames)).toFixed(3));
aggregate.deflateSavingsPercent = Number(((1 - aggregate.deflateBytes /
  Math.max(1, aggregate.framedBytes)) * 100).toFixed(3));

writeFileSync(resolve(outputDirectory, "worksheet.csv"), `${worksheetLines.join("\n")}\n`);
writeFileSync(resolve(outputDirectory, "public-manifest.json"), `${JSON.stringify({
  format: "V64-SUBTITLE-MASK-REVIEW-PUBLIC-1",
  sourceManifest: manifest.id,
  rows: publicRows
}, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "summary.json"), `${JSON.stringify({
  format: "V64-SUBTITLE-MASK-TRANCHE-1",
  sourceManifest: manifest.id,
  extraction: {
    cellGeometry: "8x16",
    bandStart: 0.68,
    contrastFloor: 48,
    note: "SM1 replaces only selected lower-band cells; no container syntax is frozen."
  },
  aggregate,
  reviewClips: publicRows.length,
  reviewGroups: new Set(publicRows.map((row) => row.group)).size
}, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "key.json"), `${JSON.stringify({
  format: "V64-SUBTITLE-MASK-REVIEW-KEY-1",
  warning: "Keep hidden until subtitle transcription and motion scoring are complete.",
  sourceManifest: manifest.id,
  rows: keyRows,
  laneMetrics
}, null, 2)}\n`);

console.log(JSON.stringify({
  format: "V64-SUBTITLE-MASK-TRANCHE-BUILD-1",
  sourceManifest: manifest.id,
  outputDirectory,
  subtitleLanes: laneMetrics.length,
  reviewClips: publicRows.length,
  aggregate
}, null, 2));
