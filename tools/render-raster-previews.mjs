#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { analyzeRasterEntry, validateRasterCorpusManifest } from "../prototype/js/raster-corpus.mjs";
import { paletteAssetFromId } from "../prototype/js/palette-registry.mjs";
import { renderCells } from "../prototype/js/video64.mjs";

const [manifestArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument || !outputArgument) {
  throw new Error("Usage: render-raster-previews MANIFEST.json OUTPUT_DIRECTORY");
}

const manifestPath = resolve(manifestArgument);
const outputDirectory = resolve(outputArgument);
const manifest = validateRasterCorpusManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
mkdirSync(outputDirectory, { recursive: true });

function writePng(path, image) {
  const result = spawnSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${image.width}x${image.height}`,
    "-i", "pipe:0",
    "-frames:v", "1",
    path
  ], {
    input: image.rgba,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffmpeg preview render failed: ${result.stderr.toString("utf8").trim()}`);
  }
}

const previews = manifest.entries.map((entry) => {
  const analyzed = analyzeRasterEntry(entry);
  const frameIndex = Math.floor(analyzed.frames.length / 2);
  const palette = paletteAssetFromId(entry.paletteAsset);
  const image = renderCells(
    analyzed.frames[frameIndex],
    entry.grid.columns,
    entry.grid.rows,
    entry.paletteDepth,
    palette.colors
  );
  const output = resolve(outputDirectory, `${entry.id}-frame${frameIndex}.png`);
  writePng(output, image);
  const bytes = readFileSync(output);
  return {
    id: entry.id,
    source: basename(entry.source.path),
    frameIndex,
    paletteAsset: palette.id,
    width: image.width,
    height: image.height,
    bytes: statSync(output).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    output
  };
});

console.log(JSON.stringify({
  format: "V64-RASTER-PREVIEWS-1",
  manifest: manifest.id,
  previews
}, null, 2));
