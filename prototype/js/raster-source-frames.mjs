import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { CADENCES } from "./constants.mjs";
import { generatedRasterSourceFromId } from "./generated-raster-sources.mjs";
import { paletteAssetFromId } from "./palette-registry.mjs";

function runFfmpeg(args, input = null) {
  const result = spawnSync("ffmpeg", args, {
    input,
    encoding: null,
    maxBuffer: 1024 * 1024 * 1024
  });
  if (result.error) throw new Error(`ffmpeg could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${result.status}): ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}

function sourceMaterial(source, baseDirectory) {
  if (source.kind === "generated-plate") {
    const generated = generatedRasterSourceFromId(source.generatorId);
    return {
      path: null,
      identity: `generated:${generated.id}`,
      bytes: generated.bytes,
      sha256: generated.sha256
    };
  }
  const path = resolve(baseDirectory, source.path);
  const bytes = readFileSync(path);
  return {
    path,
    identity: source.path,
    bytes: null,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

function sourceInputArguments(source, sourcePath) {
  if (source.kind === "generated-plate") {
    return [
      "-loop", "1",
      "-framerate", String(source.framerate),
      "-f", "image2pipe",
      "-vcodec", "ppm",
      "-i", "pipe:0"
    ];
  }
  if (source.kind === "local-still") {
    return ["-loop", "1", "-framerate", String(source.framerate), "-i", sourcePath];
  }
  return ["-i", sourcePath];
}

function sourceFilters(source) {
  return source.kind === "local-still" || source.kind === "generated-plate"
    ? [source.videoFilter]
    : [];
}

export function decodeRasterEntryProxyFrames(entry, options = {}) {
  const started = performance.now();
  const baseDirectory = resolve(options.baseDirectory || process.cwd());
  const material = sourceMaterial(entry.source, baseDirectory);
  if (material.sha256 !== entry.source.sha256) {
    throw new Error(`Raster source hash mismatch for ${entry.id}`);
  }
  const cadence = CADENCES.find((item) => item.label === entry.cadence);
  if (!cadence) throw new RangeError(`Unknown cadence ${entry.cadence}`);
  const paletteAsset = paletteAssetFromId(entry.paletteAsset || "V64-P256-1");
  const width = entry.grid.columns * 4;
  const height = entry.grid.rows * 8;
  const filters = [
    ...sourceFilters(entry.source),
    `fps=${cadence.numerator}/${cadence.denominator}`,
    `scale=${width}:${height}:flags=area`
  ];
  const raw = runFfmpeg([
    "-v", "error",
    ...sourceInputArguments(entry.source, material.path),
    "-t", String(entry.maximumSeconds),
    "-vf", filters.join(","),
    "-an",
    "-pix_fmt", "rgba",
    "-f", "rawvideo",
    "pipe:1"
  ], material.bytes);
  const frameBytes = width * height * 4;
  if (!raw.length || raw.length % frameBytes) {
    throw new Error(`FFmpeg returned a truncated raster stream for ${entry.id}`);
  }
  const frames = Array.from({ length: raw.length / frameBytes }, (_, index) =>
    Buffer.from(raw.subarray(index * frameBytes, (index + 1) * frameBytes))
  );
  return Object.freeze({
    entry: structuredClone(entry),
    frames: Object.freeze(frames),
    width,
    height,
    cadence,
    paletteAsset,
    sourceIdentity: material.identity,
    sourceSha256: material.sha256,
    metrics: Object.freeze({
      frames: frames.length,
      decodedBytes: raw.length,
      milliseconds: Number((performance.now() - started).toFixed(3)),
      processMaxRssKiB: process.resourceUsage().maxRSS
    })
  });
}
