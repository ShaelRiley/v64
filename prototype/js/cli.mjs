#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  cadenceFromValue, deriveRows, paletteDepthFromValue, PALETTE_DEPTHS
} from "./constants.mjs";
import {
  cadenceRational, decodeVideoTimeline, demuxV64, makeChunk, muxV64, verifyV64
} from "./container.mjs";
import { makeGlyphAtlas, renderCells } from "./video64.mjs";
import { GLYPH_META, PALETTE_META } from "./assets.mjs";
import { measureFrameCommands } from "./commands.mjs";
import {
  benchmarkCommandBackends, createCommandTraceDocument
} from "./command-benchmark.mjs";
import { benchmarkEntropyCorpus } from "./entropy-benchmark.mjs";
import { benchmarkRasterCorpus } from "./raster-corpus.mjs";
import {
  analyzeRateDistortionTimeline,
  encodeSceneAwareCellTimeline,
  rateDistortionModeFromValue
} from "./rate-distortion.mjs";
import {
  VIDEO64_DEFAULT_GLYPH_COUNT,
  primaryGlyphCountFromValue
} from "./glyph-subset.mjs";
import {
  encodeEncoderProfilePayload,
  encoderProfileFromDemuxed
} from "./encoder-profile.mjs";

const PROFILES = Object.freeze({
  smallest: { target: "compact", dictionary: true },
  balanced: { target: "balanced", dictionary: true },
  clearest: { target: "quality", dictionary: true }
});

function fail(message) {
  console.error(`v64: ${message}`);
  process.exitCode = 1;
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: options.binary ? null : "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer || 1024 * 1024 * 1024
  });
  if (result.error) throw new Error(`${program} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const diagnostic = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
    throw new Error(`${program} failed (${result.status}): ${diagnostic.trim()}`);
  }
  return result.stdout;
}

function parseOptions(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "no-dictionary") options.dictionary = false;
    else {
      if (index + 1 >= args.length || args[index + 1].startsWith("--")) throw new Error(`Option --${key} requires a value`);
      options[key] = args[++index];
    }
  }
  return { positional, options };
}

function probeVideo(input) {
  const text = run("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height,duration:format=duration", "-of", "json", input
  ]);
  const data = JSON.parse(text);
  const stream = data.streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error("Input has no decodable video stream");
  const duration = Number(stream.duration || data.format?.duration || 0);
  return { width: stream.width, height: stream.height, duration };
}

function changedCellPercentage(frames) {
  if (frames.length < 2) return 100;
  let changed = 0;
  let compared = 0;
  for (let index = 1; index < frames.length; index += 1) {
    for (let offset = 0; offset < frames[index].length; offset += 3) {
      compared += 1;
      if (frames[index][offset] !== frames[index - 1][offset] ||
          frames[index][offset + 1] !== frames[index - 1][offset + 1] ||
          frames[index][offset + 2] !== frames[index - 1][offset + 2]) changed += 1;
    }
  }
  return compared ? changed / compared * 100 : 0;
}

function encodeVideo(inputPath, outputPath, rawOptions = {}) {
  const cadence = cadenceFromValue(rawOptions.fps ?? "24");
  const columns = Number(rawOptions.columns ?? 80);
  const { id: paletteDepthId, depth } = paletteDepthFromValue(rawOptions.palette ?? 32);
  const profileName = String(rawOptions.profile || "balanced").toLowerCase();
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown profile "${profileName}"; use smallest, balanced, or clearest`);
  const targetMode = rateDistortionModeFromValue(rawOptions.target ?? profile.target).id;
  const glyphCount = primaryGlyphCountFromValue(
    rawOptions.glyphs ?? VIDEO64_DEFAULT_GLYPH_COUNT
  );
  const dictionary = rawOptions.dictionary ?? profile.dictionary;
  const source = probeVideo(inputPath);
  const rows = deriveRows(columns, source.width / source.height);
  const proxyWidth = columns * 4;
  const proxyHeight = rows * 8;
  const maximumSeconds = rawOptions["max-seconds"] ? Number(rawOptions["max-seconds"]) : null;
  if (maximumSeconds !== null && (!Number.isFinite(maximumSeconds) || maximumSeconds <= 0)) {
    throw new Error("--max-seconds must be positive");
  }
  const filter = `fps=${cadenceRational(cadence)},scale=${proxyWidth}:${proxyHeight}:flags=area`;
  const ffmpegArgs = ["-v", "error", "-i", inputPath];
  if (maximumSeconds) ffmpegArgs.push("-t", String(maximumSeconds));
  ffmpegArgs.push("-vf", filter, "-an", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1");
  const raw = run("ffmpeg", ffmpegArgs, { binary: true });
  const frameBytes = proxyWidth * proxyHeight * 4;
  if (!raw.length || raw.length % frameBytes) throw new Error("FFmpeg returned a truncated proxy frame stream");
  const frameCount = raw.length / frameBytes;
  const rawFrames = Array.from({ length: frameCount }, (_, index) =>
    raw.subarray(index * frameBytes, (index + 1) * frameBytes)
  );
  const analysis = analyzeRateDistortionTimeline(rawFrames, {
    mode: targetMode,
    glyphCounts: [glyphCount],
    width: proxyWidth,
    height: proxyHeight,
    columns,
    rows,
    paletteDepth: depth,
    paletteDepthId,
    cadenceId: cadence.id,
    minimumGroupFrames: 2,
    useDictionary: dictionary
  });
  const chunks = encodeSceneAwareCellTimeline(analysis);
  const encoderProfilePayload = encodeEncoderProfilePayload({
    glyphCount,
    targetMode,
    cadenceId: cadence.id,
    maximumGroupFrames: analysis.metrics.maximumGroupFrames,
    sceneCutAware: true,
    dictionary
  });
  chunks.push(makeChunk("META", 0, 0, encoderProfilePayload, { compress: true }));
  const file = muxV64({ columns, rows, cadenceId: cadence.id, paletteDepthId }, chunks);
  writeFileSync(outputPath, file);
  const verified = verifyV64(file);
  const demuxed = demuxV64(file);
  const encoderProfile = encoderProfileFromDemuxed(demuxed);
  const duration = verified.durationTicks / 60_000;
  return {
    input: resolve(inputPath), output: resolve(outputPath), columns, rows,
    rasterWidth: columns * 8, rasterHeight: rows * 16,
    cadence: cadence.label, paletteDepth: depth, profile: profileName,
    targetMode, glyphCount, encoderProfile,
    sourceDurationSeconds: source.duration || null, encodedDurationSeconds: duration,
    frames: frameCount,
    changedCellPercentage: Number(changedCellPercentage(analysis.frames).toFixed(3)),
    meanDistortion: analysis.metrics.meanDistortion,
    meanPsnr: analysis.metrics.meanPsnr,
    sceneCuts: analysis.metrics.sceneCuts,
    independentGroups: analysis.metrics.independentGroups,
    bytes: file.length, bitsPerSecond: duration ? Math.round(file.length * 8 / duration) : null,
    bytesPerMinute: duration ? Math.round(file.length * 60 / duration) : null,
    keyframes: verified.keyframes, repeatSpans: verified.repeatSpans
  };
}

function decodeVideo(inputPath, outputPath) {
  const file = readFileSync(inputPath);
  const demuxed = demuxV64(file);
  const timeline = decodeVideoTimeline(demuxed);
  const frameBuffers = [];
  for (const item of timeline) {
    const rendered = renderCells(item.state, demuxed.header.columns, demuxed.header.rows, demuxed.header.paletteDepth);
    const repeats = item.duration / demuxed.header.cadence.frameTicks;
    for (let index = 0; index < repeats; index += 1) frameBuffers.push(rendered.rgba);
  }
  const raw = Buffer.concat(frameBuffers);
  const width = demuxed.header.columns * 8;
  const height = demuxed.header.rows * 16;
  const extension = extname(outputPath).toLowerCase();
  const args = [
    "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba",
    "-s", `${width}x${height}`, "-r", cadenceRational(demuxed.header.cadence),
    "-i", "pipe:0", "-an"
  ];
  if (extension === ".mp4") args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  else args.push("-c:v", "ffv1");
  args.push(outputPath);
  run("ffmpeg", args, { input: raw, binary: true, maxBuffer: 64 * 1024 * 1024 });
  return {
    input: resolve(inputPath), output: resolve(outputPath), frames: frameBuffers.length,
    width, height, bytes: statSync(outputPath).size,
    sha256: createHash("sha256").update(readFileSync(outputPath)).digest("hex")
  };
}

function inspect(inputPath) {
  const file = readFileSync(inputPath);
  const demuxed = demuxV64(file);
  const distribution = {};
  for (const chunk of demuxed.chunks) {
    const entry = distribution[chunk.type] ||= { count: 0, storedBytes: 0, decodedBytes: 0 };
    entry.count += 1;
    entry.storedBytes += chunk.storedLength;
    entry.decodedBytes += chunk.payload.length;
  }
  const commandMetrics = {
    opcodes: {}, cells: {}, dictionaryEntries: 0, dictionaryReferences: 0
  };
  for (const chunk of demuxed.chunks.filter((entry) => entry.type === "VFRM")) {
    const measured = measureFrameCommands(chunk.payload.subarray(1));
    for (const [name, count] of Object.entries(measured.opcodes)) {
      commandMetrics.opcodes[name] = (commandMetrics.opcodes[name] || 0) + count;
    }
    for (const [name, count] of Object.entries(measured.cells)) {
      commandMetrics.cells[name] = (commandMetrics.cells[name] || 0) + count;
    }
    commandMetrics.dictionaryEntries += measured.dictionaryEntries;
    commandMetrics.dictionaryReferences += measured.dictionaryReferences;
  }
  return {
    path: resolve(inputPath), fileBytes: file.length,
    header: {
      ...demuxed.header,
      cadence: demuxed.header.cadence.label,
      glyphAsset: GLYPH_META.id,
      paletteAsset: PALETTE_META.id
    },
    encoderProfile: encoderProfileFromDemuxed(demuxed),
    chunkDistribution: distribution,
    seekEntries: demuxed.index.length,
    commandMetrics
  };
}

function benchmarkCommands(inputPath) {
  const file = readFileSync(inputPath);
  const report = benchmarkCommandBackends(demuxV64(file), { sourceFileBytes: file.length });
  return { path: resolve(inputPath), ...report };
}

function benchmarkCorpus(inputPath) {
  const manifest = JSON.parse(readFileSync(inputPath, "utf8"));
  return {
    path: resolve(inputPath),
    ...benchmarkEntropyCorpus(manifest)
  };
}

function benchmarkRaster(inputPath) {
  const manifest = JSON.parse(readFileSync(inputPath, "utf8"));
  return {
    path: resolve(inputPath),
    ...benchmarkRasterCorpus(manifest)
  };
}

function writeCommandTrace(inputPath, outputPath) {
  const file = readFileSync(inputPath);
  const trace = createCommandTraceDocument(demuxV64(file));
  const json = `${JSON.stringify(trace, null, 2)}\n`;
  writeFileSync(outputPath, json);
  return {
    input: resolve(inputPath),
    output: resolve(outputPath),
    bytes: Buffer.byteLength(json),
    codedFrames: trace.codedFrames
  };
}

function writePpm(path, image) {
  const rgb = Buffer.alloc(image.width * image.height * 3);
  for (let source = 0, target = 0; source < image.rgba.length; source += 4, target += 3) {
    rgb[target] = image.rgba[source];
    rgb[target + 1] = image.rgba[source + 1];
    rgb[target + 2] = image.rgba[source + 2];
  }
  writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${image.width} ${image.height}\n255\n`), rgb]));
}

function makeSample(directory) {
  mkdirSync(directory, { recursive: true });
  const source = resolve(directory, "procedural-source.mp4");
  const encoded = resolve(directory, "procedural.v64");
  const decoded = resolve(directory, "procedural-decoded.mp4");
  run("ffmpeg", [
    "-y", "-v", "error", "-f", "lavfi", "-i",
    "testsrc2=size=320x180:rate=24:duration=2",
    "-vf", "drawbox=x=20+80*t:y=55:w=52:h=70:color=yellow@0.9:t=fill",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", source
  ]);
  const encode = encodeVideo(source, encoded, {
    fps: "24", columns: "40", palette: "16", profile: "balanced", glyphs: "32"
  });
  const decode = decodeVideo(encoded, decoded);
  const atlas = resolve(directory, "video64-atlas.ppm");
  writePpm(atlas, makeGlyphAtlas(2));
  return {
    source: { path: source, bytes: statSync(source).size },
    encode,
    decode,
    atlas: { path: atlas, bytes: statSync(atlas).size }
  };
}

function usage() {
  return `V64 proof codec

Usage:
  v64 encode INPUT OUTPUT.v64 [--fps 24] [--columns 80] [--palette 32]
             [--glyphs 32|64] [--target compact|balanced|quality]
             [--profile smallest|balanced|clearest] [--max-seconds N]
  v64 decode INPUT.v64 OUTPUT.mp4|OUTPUT.mkv
  v64 inspect INPUT.v64
  v64 benchmark-commands INPUT.v64
  v64 benchmark-corpus MANIFEST.json
  v64 benchmark-raster-corpus MANIFEST.json
  v64 trace-commands INPUT.v64 OUTPUT.json
  v64 verify INPUT.v64
  v64 atlas OUTPUT.ppm
  v64 make-sample OUTPUT_DIRECTORY

The primary/default glyph budget is 32. Use --glyphs 64 for the optional
full-alphabet path. Encoded files include deterministic META profile metadata.
The older profile names remain aliases for target modes.

Legal cadences: 0.10, 0.5, 1, 3, 6, 12, 15, 24, 30, 48, 60
Legal palette depths: ${PALETTE_DEPTHS.join(", ")}`;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    console.log(usage());
    return;
  }
  const { positional, options } = parseOptions(rest);
  let result;
  if (command === "encode") {
    if (positional.length !== 2) throw new Error("encode requires INPUT and OUTPUT.v64");
    result = encodeVideo(positional[0], positional[1], options);
  } else if (command === "decode") {
    if (positional.length !== 2) throw new Error("decode requires INPUT.v64 and OUTPUT.mp4|OUTPUT.mkv");
    result = decodeVideo(positional[0], positional[1]);
  } else if (command === "inspect") {
    if (positional.length !== 1) throw new Error("inspect requires INPUT.v64");
    result = inspect(positional[0]);
  } else if (command === "benchmark-commands") {
    if (positional.length !== 1) throw new Error("benchmark-commands requires INPUT.v64");
    result = benchmarkCommands(positional[0]);
  } else if (command === "benchmark-corpus") {
    if (positional.length !== 1) throw new Error("benchmark-corpus requires MANIFEST.json");
    result = benchmarkCorpus(positional[0]);
  } else if (command === "benchmark-raster-corpus") {
    if (positional.length !== 1) throw new Error("benchmark-raster-corpus requires MANIFEST.json");
    result = benchmarkRaster(positional[0]);
  } else if (command === "trace-commands") {
    if (positional.length !== 2) throw new Error("trace-commands requires INPUT.v64 and OUTPUT.json");
    result = writeCommandTrace(positional[0], positional[1]);
  } else if (command === "verify") {
    if (positional.length !== 1) throw new Error("verify requires INPUT.v64");
    const file = readFileSync(positional[0]);
    const demuxed = demuxV64(file);
    result = {
      ...verifyV64(file),
      encoderProfile: encoderProfileFromDemuxed(demuxed)
    };
  } else if (command === "atlas") {
    if (positional.length !== 1) throw new Error("atlas requires OUTPUT.ppm");
    writePpm(positional[0], makeGlyphAtlas(2));
    result = { output: resolve(positional[0]), bytes: statSync(positional[0]).size };
  } else if (command === "make-sample") {
    if (positional.length !== 1) throw new Error("make-sample requires OUTPUT_DIRECTORY");
    result = makeSample(positional[0]);
  } else throw new Error(`Unknown command "${command}"\n\n${usage()}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => fail(error.message));

export {
  benchmarkCommands, benchmarkCorpus, benchmarkRaster, decodeVideo, encodeVideo,
  inspect, makeSample, probeVideo,
  writeCommandTrace, writePpm
};
