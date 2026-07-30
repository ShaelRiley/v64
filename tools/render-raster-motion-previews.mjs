#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  analyzeRasterEntry,
  validateRasterCorpusManifest
} from "../prototype/js/raster-corpus.mjs";
import { paletteAssetFromId } from "../prototype/js/palette-registry.mjs";
import { renderCells } from "../prototype/js/video64.mjs";

const [manifestArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument || !outputArgument) {
  throw new Error("Usage: render-raster-motion-previews MANIFEST.json OUTPUT_DIRECTORY");
}

const manifestPath = resolve(manifestArgument);
const outputDirectory = resolve(outputArgument);
const manifest = validateRasterCorpusManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
mkdirSync(outputDirectory, { recursive: true });

function writeMotion(path, width, height, cadence, frames) {
  const result = spawnSync("ffmpeg", [
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
  ], {
    input: Buffer.concat(frames),
    encoding: null,
    maxBuffer: 1024 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffmpeg motion render failed: ${result.stderr.toString("utf8").trim()}`);
  }
}

const previews = manifest.entries.map((entry) => {
  const analyzed = analyzeRasterEntry(entry);
  const palette = paletteAssetFromId(entry.paletteAsset);
  const rendered = analyzed.frames.map((frame) =>
    renderCells(
      frame,
      entry.grid.columns,
      entry.grid.rows,
      entry.paletteDepth,
      palette.colors
    )
  );
  const [{ width, height }] = rendered;
  if (rendered.some((image) => image.width !== width || image.height !== height)) {
    throw new Error(`Inconsistent rendered dimensions for ${entry.id}`);
  }
  const output = resolve(outputDirectory, `${entry.id}.mp4`);
  writeMotion(
    output,
    width,
    height,
    Number(entry.cadence),
    rendered.map((image) => image.rgba)
  );
  const bytes = readFileSync(output);
  return {
    id: entry.id,
    source: entry.source.path
      ? basename(entry.source.path)
      : `generated:${entry.source.generatorId}`,
    paletteAsset: palette.id,
    width,
    height,
    frames: rendered.length,
    cadence: Number(entry.cadence),
    seconds: rendered.length / Number(entry.cadence),
    bytes: statSync(output).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    output
  };
});

console.log(JSON.stringify({
  format: "V64-RASTER-MOTION-PREVIEWS-1",
  manifest: manifest.id,
  previews
}, null, 2));
