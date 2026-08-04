import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DROP_AM1_PROFILE } from "./audio.mjs";
import { createDropJob, encoderOptionsFromDropSettings } from "./model.mjs";
import { encodeDropVideo, probeDropSource } from "./runner.mjs";
import { TICK_RATE, deriveRows } from "../../prototype/js/constants.mjs";
import { decodeVideoTimeline, demuxV64 } from "../../prototype/js/container.mjs";
import { paletteAssetFromHash } from "../../prototype/js/palette-registry.mjs";
import { containAspect } from "../../prototype/js/source-geometry.mjs";
import { renderCells } from "../../prototype/js/video64.mjs";

export const DROP_SIZE_ESTIMATE_FORMAT = "VIDEO64-DROP-SAMPLED-SIZE-1";
export const DROP_PREVIEW_FORMAT = "VIDEO64-DROP-PREVIEW-1";
export const DROP_SAMPLE_SECONDS = 2;
export const DROP_SAMPLE_COUNT = 3;
export const DROP_ESTIMATE_FIXED_OVERHEAD_BYTES = 4096;
export const DROP_PREVIEW_GAP_PIXELS = 8;

function runTextProgram(program, args, spawn = spawnSync) {
  const result = spawn(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw new Error(`${program} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${program} failed (${result.status}): ${String(result.stderr).trim()}`);
  }
  return result.stdout;
}

function runBinaryProgram(program, args, maximumBytes, spawn = spawnSync) {
  const result = spawn(program, args, {
    encoding: null,
    maxBuffer: maximumBytes
  });
  if (result.error) throw new Error(`${program} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${program} failed (${result.status}): ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}

function roundedSeconds(value) {
  return Number(Number(value).toFixed(3));
}

export function planDropSamples(durationSeconds, {
  sampleSeconds = DROP_SAMPLE_SECONDS,
  sampleCount = DROP_SAMPLE_COUNT
} = {}) {
  const duration = Number(durationSeconds);
  const requestedSampleSeconds = Number(sampleSeconds);
  const requestedSampleCount = Number(sampleCount);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError("A positive source duration is required for sampled estimation");
  }
  if (!Number.isFinite(requestedSampleSeconds) || requestedSampleSeconds <= 0) {
    throw new RangeError("Sample duration must be positive");
  }
  if (!Number.isInteger(requestedSampleCount) || requestedSampleCount < 1 || requestedSampleCount > 9) {
    throw new RangeError("Sample count must be an integer from 1 to 9");
  }
  const actualSampleSeconds = Math.min(duration, requestedSampleSeconds);
  const maximumStart = Math.max(0, duration - actualSampleSeconds);
  const rawOffsets = requestedSampleCount === 1
    ? [maximumStart / 2]
    : Array.from(
      { length: requestedSampleCount },
      (_, index) => maximumStart * index / (requestedSampleCount - 1)
    );
  const offsets = [];
  for (const rawOffset of rawOffsets) {
    const offset = roundedSeconds(rawOffset);
    if (!offsets.some((candidate) => Math.abs(candidate - offset) < 0.001)) {
      offsets.push(offset);
    }
  }
  return Object.freeze({
    sourceDurationSeconds: roundedSeconds(duration),
    requestedSampleSeconds: roundedSeconds(requestedSampleSeconds),
    sampleSeconds: roundedSeconds(actualSampleSeconds),
    requestedSampleCount,
    sampleCount: offsets.length,
    offsets: Object.freeze(offsets)
  });
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
}

function bytesForRate(bitsPerSecond, durationSeconds) {
  return Math.round(bitsPerSecond * durationSeconds / 8) + DROP_ESTIMATE_FIXED_OVERHEAD_BYTES;
}

export function estimateDropBytesFromSamples({
  durationSeconds,
  videoBitsPerSecond,
  audioPresent = false,
  sampleSeconds = DROP_SAMPLE_SECONDS
}) {
  const duration = Number(durationSeconds);
  const rates = videoBitsPerSecond.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError("A positive source duration is required for size estimation");
  }
  if (rates.length === 0) throw new RangeError("At least one positive sampled video rate is required");
  const sampledMinimumVideoBitsPerSecond = Math.min(...rates);
  const sampledMedianVideoBitsPerSecond = median(rates);
  const sampledMaximumVideoBitsPerSecond = Math.max(...rates);
  const nominalAudioBitsPerSecond = audioPresent ? DROP_AM1_PROFILE.bitrateKbps * 1000 : 0;
  const estimatedBitsPerSecond = sampledMedianVideoBitsPerSecond + nominalAudioBitsPerSecond;
  const lowerBitsPerSecond = sampledMinimumVideoBitsPerSecond;
  const upperBitsPerSecond = Math.round(
    sampledMaximumVideoBitsPerSecond * 1.25 + nominalAudioBitsPerSecond * 1.5
  );
  const estimatedBytes = bytesForRate(estimatedBitsPerSecond, duration);
  const lowerBytes = Math.min(estimatedBytes, bytesForRate(lowerBitsPerSecond, duration));
  const upperBytes = Math.max(estimatedBytes, bytesForRate(upperBitsPerSecond, duration));
  return Object.freeze({
    format: DROP_SIZE_ESTIMATE_FORMAT,
    advisory: true,
    exactPostEncodeVerificationRequired: true,
    method: "sampled-proof-video-rate-plus-provisional-audio-profile",
    sourceDurationSeconds: roundedSeconds(duration),
    sampledSeconds: roundedSeconds(sampleSeconds * rates.length),
    sampleCount: rates.length,
    sampledVideoBitsPerSecond: Object.freeze([...rates]),
    sampledMinimumVideoBitsPerSecond,
    sampledMedianVideoBitsPerSecond,
    sampledMaximumVideoBitsPerSecond,
    audioPresent: Boolean(audioPresent),
    nominalAudioBitsPerSecond,
    fixedContainerOverheadBytes: DROP_ESTIMATE_FIXED_OVERHEAD_BYTES,
    estimatedBitsPerSecond,
    estimatedBytes,
    lowerBytes,
    upperBytes,
    rangeMeaning: "Observed sampled video-rate envelope with a conservative upper margin; not a statistical confidence interval."
  });
}

function extractDropSampleClip(inputPath, outputPath, offsetSeconds, durationSeconds, {
  spawnSyncImpl = spawnSync
} = {}) {
  runTextProgram("ffmpeg", [
    "-y", "-v", "error",
    "-i", inputPath,
    "-ss", String(offsetSeconds),
    "-t", String(durationSeconds),
    "-map", "0:v:0",
    "-an",
    "-c:v", "ffv1",
    "-pix_fmt", "yuv420p",
    outputPath
  ], spawnSyncImpl);
  return statSync(outputPath).size;
}

function extractDropSourceFrame(inputPath, offsetSeconds, width, height, sourceAspectRatio, {
  spawnSyncImpl = spawnSync
} = {}) {
  const content = containAspect(width, height, sourceAspectRatio);
  const filter = [
    `scale=${content.width}:${content.height}:flags=area`,
    "setsar=1",
    `pad=${width}:${height}:${content.x}:${content.y}:color=black`
  ].join(",");
  const bytes = runBinaryProgram("ffmpeg", [
    "-v", "error",
    "-i", inputPath,
    "-ss", String(offsetSeconds),
    "-frames:v", "1",
    "-vf", filter,
    "-an",
    "-pix_fmt", "rgba",
    "-f", "rawvideo",
    "pipe:1"
  ], width * height * 4 + 1024 * 1024, spawnSyncImpl);
  const expectedBytes = width * height * 4;
  if (bytes.length !== expectedBytes) {
    throw new Error(`FFmpeg returned ${bytes.length} preview bytes; expected ${expectedBytes}`);
  }
  return { width, height, rgba: bytes };
}

export function renderFirstDropDecodedFrame(inputPath) {
  const demuxed = demuxV64(readFileSync(inputPath));
  const first = decodeVideoTimeline(demuxed)[0];
  if (!first) throw new Error("Sampled V64 file contains no decoded video frame");
  const palette = paletteAssetFromHash(demuxed.header.paletteHash).colors;
  return renderCells(
    first.state,
    demuxed.header.columns,
    demuxed.header.rows,
    demuxed.header.paletteDepth,
    palette
  );
}

export function combineDropPreviewFrames(left, right, gapPixels = DROP_PREVIEW_GAP_PIXELS) {
  if (left.height !== right.height) throw new RangeError("Preview frame heights must match");
  const gap = Number(gapPixels);
  if (!Number.isInteger(gap) || gap < 0 || gap > 256) {
    throw new RangeError("Preview gap must be an integer from 0 to 256");
  }
  const width = left.width + gap + right.width;
  const height = left.height;
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) rgba[pixel * 4 + 3] = 255;
  for (let row = 0; row < height; row += 1) {
    left.rgba.copy(
      rgba,
      row * width * 4,
      row * left.width * 4,
      (row + 1) * left.width * 4
    );
    right.rgba.copy(
      rgba,
      (row * width + left.width + gap) * 4,
      row * right.width * 4,
      (row + 1) * right.width * 4
    );
  }
  return { width, height, rgba };
}

export function writeDropPreviewPpm(path, image) {
  const rgb = Buffer.alloc(image.width * image.height * 3);
  for (let source = 0, target = 0; source < image.rgba.length; source += 4, target += 3) {
    rgb[target] = image.rgba[source];
    rgb[target + 1] = image.rgba[source + 1];
    rgb[target + 2] = image.rgba[source + 2];
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from(`P6\n${image.width} ${image.height}\n255\n`),
    rgb
  ]));
  return statSync(path).size;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sampledAssessment(inputPath, settings = {}, {
  outputDirectory = null,
  probe = probeDropSource,
  encode = encodeDropVideo,
  spawnSyncImpl = spawnSync,
  sampleSeconds = DROP_SAMPLE_SECONDS,
  sampleCount = DROP_SAMPLE_COUNT
} = {}) {
  const job = createDropJob({ id: "drop-preview", inputPath, settings });
  const source = probe(job.inputPath);
  if (!source.durationSeconds) {
    throw new Error("Source duration is unavailable; sampled estimation cannot proceed");
  }
  const rows = deriveRows(job.settings.columns, source.displayAspectRatio);
  const samplePlan = planDropSamples(source.durationSeconds, { sampleSeconds, sampleCount });
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "video64-drop-preview-"));
  const samples = [];
  let representativeV64Path = null;
  try {
    for (let index = 0; index < samplePlan.offsets.length; index += 1) {
      const offsetSeconds = samplePlan.offsets[index];
      const clipPath = join(temporaryDirectory, `sample-${index}.mkv`);
      const v64Path = join(temporaryDirectory, `sample-${index}.v64`);
      extractDropSampleClip(job.inputPath, clipPath, offsetSeconds, samplePlan.sampleSeconds, {
        spawnSyncImpl
      });
      const encoded = encode(
        clipPath,
        v64Path,
        encoderOptionsFromDropSettings(job.settings)
      );
      const demuxed = demuxV64(readFileSync(v64Path));
      const durationTicks = demuxed.header.duration;
      const bitsPerSecond = Math.round(encoded.bytes * 8 * TICK_RATE / durationTicks);
      samples.push(Object.freeze({
        index,
        offsetSeconds,
        requestedDurationSeconds: samplePlan.sampleSeconds,
        durationTicks,
        encodedDurationSeconds: roundedSeconds(durationTicks / TICK_RATE),
        frames: encoded.frames,
        bytes: encoded.bytes,
        bitsPerSecond,
        sha256: sha256File(v64Path)
      }));
      if (index === Math.floor(samplePlan.offsets.length / 2)) representativeV64Path = v64Path;
    }
    const estimate = estimateDropBytesFromSamples({
      durationSeconds: source.durationSeconds,
      videoBitsPerSecond: samples.map((sample) => sample.bitsPerSecond),
      audioPresent: source.audioPresent,
      sampleSeconds: samplePlan.sampleSeconds
    });
    let preview = null;
    if (outputDirectory) {
      const directory = resolve(outputDirectory);
      mkdirSync(directory, { recursive: true });
      const width = job.settings.columns * 8;
      const height = rows * 16;
      const representativeIndex = Math.floor(samples.length / 2);
      const representativeOffsetSeconds = samples[representativeIndex].offsetSeconds;
      const sourceFrame = extractDropSourceFrame(
        job.inputPath,
        representativeOffsetSeconds,
        width,
        height,
        source.displayAspectRatio,
        { spawnSyncImpl }
      );
      const decodedFrame = renderFirstDropDecodedFrame(representativeV64Path);
      const comparisonFrame = combineDropPreviewFrames(sourceFrame, decodedFrame);
      const sourcePath = join(directory, "source.ppm");
      const decodedPath = join(directory, "decoded-v64.ppm");
      const comparisonPath = join(directory, "comparison.ppm");
      writeDropPreviewPpm(sourcePath, sourceFrame);
      writeDropPreviewPpm(decodedPath, decodedFrame);
      writeDropPreviewPpm(comparisonPath, comparisonFrame);
      preview = Object.freeze({
        format: DROP_PREVIEW_FORMAT,
        representativeSampleIndex: representativeIndex,
        representativeOffsetSeconds,
        layout: Object.freeze({
          left: "source",
          right: "decoded-v64",
          gapPixels: DROP_PREVIEW_GAP_PIXELS
        }),
        width: comparisonFrame.width,
        height: comparisonFrame.height,
        source: Object.freeze({
          path: sourcePath,
          bytes: statSync(sourcePath).size,
          sha256: sha256File(sourcePath)
        }),
        decodedV64: Object.freeze({
          path: decodedPath,
          bytes: statSync(decodedPath).size,
          sha256: sha256File(decodedPath)
        }),
        comparison: Object.freeze({
          path: comparisonPath,
          bytes: statSync(comparisonPath).size,
          sha256: sha256File(comparisonPath)
        })
      });
    }
    const report = {
      format: preview ? DROP_PREVIEW_FORMAT : DROP_SIZE_ESTIMATE_FORMAT,
      advisory: true,
      inputPath: job.inputPath,
      settings: job.settings,
      source,
      grid: {
        columns: job.settings.columns,
        rows,
        rasterWidth: job.settings.columns * 8,
        rasterHeight: rows * 16
      },
      samplePlan,
      samples,
      estimate,
      preview
    };
    if (outputDirectory) {
      const manifestPath = join(resolve(outputDirectory), "preview.json");
      report.manifestPath = manifestPath;
      writeFileSync(manifestPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    return report;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function estimateDropOutputSize(inputPath, settings = {}, options = {}) {
  return sampledAssessment(inputPath, settings, options);
}

export function createDropPreview(inputPath, outputDirectory, settings = {}, options = {}) {
  if (!outputDirectory) throw new TypeError("A preview output directory is required");
  return sampledAssessment(inputPath, settings, { ...options, outputDirectory });
}
