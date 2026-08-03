import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  truncateSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSilenceSpanDetector,
  detectSilenceSpans,
  encodePcm16Wav,
  sampleIndexToTicks,
  silenceSpansToChunks
} from "../../prototype/js/audio-am1.mjs";
import {
  encodeAm1OpusOgg,
  nonSilenceSpans
} from "../../prototype/js/audio-opus.mjs";
import { encodeAurnPayload, ticksToAudioSamples } from "../../prototype/js/audio-run.mjs";
import { makeChunk } from "../../prototype/js/container.mjs";

export const DROP_AM1_PROFILE = Object.freeze({
  id: "AM1-PROVISIONAL-8K",
  normative: false,
  sampleRate: 48_000,
  channels: 1,
  bitrateKbps: 8,
  frameDurationMs: 20,
  maximumRunSeconds: 60,
  scanReadBytes: 1024 * 1024,
  legacyMaximumPcmBytes: 256 * 1024 * 1024,
  silenceDetector: Object.freeze({
    windowMs: 10,
    enterDb: -48,
    exitDb: -42,
    minimumSilenceMs: 120,
    hangoverMs: 40
  })
});

function assertInteger(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
}

function pcm16FromLittleEndian(input) {
  const bytes = Buffer.from(input);
  if (bytes.length % 2) throw new Error("FFmpeg returned a truncated PCM16 stream");
  const samples = new Int16Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2);
  }
  return samples;
}

function targetAudioShape(durationTicks) {
  const targetSamples = ticksToAudioSamples(durationTicks);
  const targetPcmBytes = targetSamples * 2;
  if (!Number.isSafeInteger(targetPcmBytes)) {
    throw new RangeError("Source audio duration exceeds safe PCM accounting");
  }
  return { targetSamples, targetPcmBytes };
}

export function fitDropAudioSamples(samplesInput, targetSamples) {
  assertInteger(targetSamples, "Target audio sample count", 0);
  const source = samplesInput instanceof Int16Array
    ? samplesInput
    : Int16Array.from(samplesInput || []);
  const samples = new Int16Array(targetSamples);
  samples.set(source.subarray(0, targetSamples));
  return {
    samples,
    sourceSamples: source.length,
    targetSamples,
    copiedSamples: Math.min(source.length, targetSamples),
    paddedSamples: Math.max(0, targetSamples - source.length),
    trimmedSamples: Math.max(0, source.length - targetSamples)
  };
}

export function extractDropAudioPcm(inputPath, durationTicks, {
  ffmpegPath = "ffmpeg",
  maximumPcmBytes = DROP_AM1_PROFILE.legacyMaximumPcmBytes,
  spawnSyncImpl = spawnSync
} = {}) {
  assertInteger(maximumPcmBytes, "Maximum source PCM bytes", 2);
  const { targetSamples, targetPcmBytes } = targetAudioShape(durationTicks);
  if (targetPcmBytes > maximumPcmBytes) {
    throw new RangeError(
      `Source audio requires ${targetPcmBytes} PCM bytes, exceeding the ` +
      `${maximumPcmBytes}-byte in-memory helper ceiling`
    );
  }
  const durationSeconds = targetSamples / DROP_AM1_PROFILE.sampleRate;
  const maxBuffer = Math.max(
    64 * 1024 * 1024,
    targetPcmBytes + 8 * 1024 * 1024
  );
  const result = spawnSyncImpl(ffmpegPath, [
    "-v", "error",
    "-i", inputPath,
    "-map", "0:a:0",
    "-vn",
    "-af", "aresample=48000:async=1:first_pts=0",
    "-ac", "1",
    "-ar", "48000",
    "-t", durationSeconds.toFixed(9),
    "-c:a", "pcm_s16le",
    "-f", "s16le",
    "pipe:1"
  ], {
    encoding: null,
    maxBuffer
  });
  if (result.error) throw new Error(`ffmpeg could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg audio extraction failed (${result.status}): ${Buffer.from(result.stderr || []).toString("utf8").trim()}`
    );
  }
  return {
    ...fitDropAudioSamples(pcm16FromLittleEndian(result.stdout), targetSamples),
    targetPcmBytes,
    maximumPcmBytes
  };
}

export function extractDropAudioPcmFile(inputPath, durationTicks, outputPath, {
  ffmpegPath = "ffmpeg",
  spawnSyncImpl = spawnSync
} = {}) {
  const { targetSamples, targetPcmBytes } = targetAudioShape(durationTicks);
  const durationSeconds = targetSamples / DROP_AM1_PROFILE.sampleRate;
  const result = spawnSyncImpl(ffmpegPath, [
    "-y",
    "-v", "error",
    "-i", inputPath,
    "-map", "0:a:0",
    "-vn",
    "-af", "aresample=48000:async=1:first_pts=0",
    "-ac", "1",
    "-ar", "48000",
    "-t", durationSeconds.toFixed(9),
    "-c:a", "pcm_s16le",
    "-f", "s16le",
    outputPath
  ], {
    encoding: null,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw new Error(`ffmpeg could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg audio extraction failed (${result.status}): ${Buffer.from(result.stderr || []).toString("utf8").trim()}`
    );
  }
  const sourcePcmBytes = statSync(outputPath).size;
  if (sourcePcmBytes % 2) throw new Error("FFmpeg returned a truncated PCM16 file");
  truncateSync(outputPath, targetPcmBytes);
  return {
    path: outputPath,
    targetSamples,
    targetPcmBytes,
    sourceSamples: sourcePcmBytes / 2,
    sourcePcmBytes,
    copiedSamples: Math.min(sourcePcmBytes / 2, targetSamples),
    paddedSamples: Math.max(0, targetSamples - sourcePcmBytes / 2),
    trimmedSamples: Math.max(0, sourcePcmBytes / 2 - targetSamples),
    spoolBytes: statSync(outputPath).size
  };
}

function readExact(fd, buffer, length, position) {
  let total = 0;
  while (total < length) {
    const count = readSync(fd, buffer, total, length - total, position + total);
    if (!count) throw new Error("Unexpected end of spooled PCM file");
    total += count;
  }
  return total;
}

function evenReadBytes(value) {
  const bytes = Number(value ?? DROP_AM1_PROFILE.scanReadBytes);
  assertInteger(bytes, "Streaming PCM read size", 2, 64 * 1024 * 1024);
  return bytes - (bytes % 2);
}

export function scanDropAudioPcmFile(inputPath, targetSamples, options = {}) {
  assertInteger(targetSamples, "Streaming PCM sample count", 0);
  const expectedBytes = targetSamples * 2;
  if (statSync(inputPath).size !== expectedBytes) {
    throw new Error("Spooled PCM size does not match the V64 audio duration");
  }
  const detector = createSilenceSpanDetector({
    ...DROP_AM1_PROFILE.silenceDetector,
    ...(options.silenceDetector || {}),
    sampleRate: DROP_AM1_PROFILE.sampleRate
  });
  const scanReadBytes = evenReadBytes(options.scanReadBytes);
  const buffer = Buffer.alloc(scanReadBytes);
  const fd = openSync(inputPath, "r");
  let position = 0;
  try {
    while (position < expectedBytes) {
      const length = Math.min(scanReadBytes, expectedBytes - position);
      readExact(fd, buffer, length, position);
      detector.push(pcm16FromLittleEndian(buffer.subarray(0, length)));
      position += length;
    }
  } finally {
    closeSync(fd);
  }
  const detected = detector.finish();
  if (detected.diagnostics.samples !== targetSamples) {
    throw new Error("Streaming silence detector lost PCM samples");
  }
  return {
    ...detected,
    scanReadBytes,
    scanPasses: Math.ceil(expectedBytes / scanReadBytes)
  };
}

function boundedAudibleSpans(totalSamples, silenceSpans, maximumRunSamples) {
  assertInteger(maximumRunSamples, "Maximum AM1 run samples", 1);
  const output = [];
  for (const span of nonSilenceSpans(totalSamples, silenceSpans)) {
    for (let startSample = span.startSample; startSample < span.endSample;) {
      const endSample = Math.min(span.endSample, startSample + maximumRunSamples);
      output.push({ startSample, endSample });
      startSample = endSample;
    }
  }
  return output;
}

function encodeSamplesRun(samples, span, options) {
  const sampleRate = DROP_AM1_PROFILE.sampleRate;
  const wav = encodePcm16Wav(samples, sampleRate, 1);
  const encoded = encodeAm1OpusOgg(wav, {
    ffmpegPath: options.ffmpegPath,
    bitrateKbps: options.bitrateKbps,
    frameDurationMs: options.frameDurationMs
  });
  const timestamp = sampleIndexToTicks(span.startSample, sampleRate);
  const endTick = sampleIndexToTicks(span.endSample, sampleRate);
  return {
    ...encoded,
    startSample: span.startSample,
    endSample: span.endSample,
    timestamp,
    duration: endTick - timestamp
  };
}

function encodeBoundedRuns(samples, silenceSpans, options) {
  const sampleRate = DROP_AM1_PROFILE.sampleRate;
  const maximumRunSamples = Number(
    options.maximumRunSamples ??
      sampleRate * DROP_AM1_PROFILE.maximumRunSeconds
  );
  return boundedAudibleSpans(samples.length, silenceSpans, maximumRunSamples)
    .map((span) => encodeSamplesRun(
      samples.slice(span.startSample, span.endSample),
      span,
      options
    ));
}

function readPcmSpan(fd, span) {
  const sampleCount = span.endSample - span.startSample;
  const bytes = Buffer.alloc(sampleCount * 2);
  readExact(fd, bytes, bytes.length, span.startSample * 2);
  return pcm16FromLittleEndian(bytes);
}

function encodeBoundedFileRuns(inputPath, totalSamples, silenceSpans, options) {
  const sampleRate = DROP_AM1_PROFILE.sampleRate;
  const maximumRunSamples = Number(
    options.maximumRunSamples ??
      sampleRate * DROP_AM1_PROFILE.maximumRunSeconds
  );
  assertInteger(maximumRunSamples, "Maximum AM1 run samples", 1);
  const spans = boundedAudibleSpans(totalSamples, silenceSpans, maximumRunSamples);
  const fd = openSync(inputPath, "r");
  try {
    return spans.map((span) => encodeSamplesRun(readPcmSpan(fd, span), span, options));
  } finally {
    closeSync(fd);
  }
}

function timelineChunks(runs, silenceSpans) {
  const aurnChunks = runs.map((run) => makeChunk(
    "AURN",
    run.timestamp,
    run.duration,
    encodeAurnPayload(run),
    { compress: false }
  ));
  const silenceChunks = silenceSpansToChunks(
    silenceSpans,
    DROP_AM1_PROFILE.sampleRate
  );
  return [...aurnChunks, ...silenceChunks]
    .sort((left, right) => left.timestamp - right.timestamp);
}

function verifyTimeline(chunks, durationTicks) {
  let expectedTimestamp = 0;
  for (const chunk of chunks) {
    if (chunk.timestamp !== expectedTimestamp) {
      throw new Error(
        `AM1 source timeline is discontinuous at ${chunk.timestamp}; expected ${expectedTimestamp}`
      );
    }
    expectedTimestamp += chunk.duration;
  }
  if (expectedTimestamp !== durationTicks) {
    throw new Error(
      `AM1 source timeline covers ${expectedTimestamp} ticks; expected ${durationTicks}`
    );
  }
}

function summarizeAudio({
  durationTicks,
  targetSamples,
  runs,
  silenceSpans,
  chunks,
  detected,
  bitrateKbps,
  frameDurationMs,
  extras = {}
}) {
  const silenceSamples = silenceSpans.reduce(
    (sum, span) => sum + span.endSample - span.startSample,
    0
  );
  const keptSamples = runs.reduce((sum, run) => sum + run.keptSamples, 0);
  if (silenceSamples + keptSamples !== targetSamples) {
    throw new Error("AM1 source sample accounting is incomplete");
  }
  return {
    format: "VIDEO64-DROP-AM1-SOURCE-1",
    profile: DROP_AM1_PROFILE.id,
    normative: false,
    sourcePresent: true,
    sampleRate: DROP_AM1_PROFILE.sampleRate,
    channels: DROP_AM1_PROFILE.channels,
    bitrateKbps,
    frameDurationMs,
    maximumRunSeconds: DROP_AM1_PROFILE.maximumRunSeconds,
    durationTicks,
    targetSamples,
    pcmBytes: targetSamples * 2,
    audibleRuns: runs.length,
    opusPackets: runs.reduce((sum, run) => sum + run.packets.length, 0),
    keptSamples,
    silenceSpans: silenceSpans.length,
    silenceSamples,
    timelineChunks: chunks.length,
    payloadBytes: chunks.reduce((sum, chunk) => sum + chunk.payload.length, 0),
    detector: detected.diagnostics,
    ...extras
  };
}

export function encodeDropAudioTimeline(samplesInput, durationTicks, options = {}) {
  const { targetSamples } = targetAudioShape(durationTicks);
  const fitted = fitDropAudioSamples(samplesInput, targetSamples);
  const detectorOptions = {
    ...DROP_AM1_PROFILE.silenceDetector,
    ...(options.silenceDetector || {}),
    sampleRate: DROP_AM1_PROFILE.sampleRate
  };
  const detected = detectSilenceSpans(fitted.samples, detectorOptions);
  const bitrateKbps = Number(options.bitrateKbps ?? DROP_AM1_PROFILE.bitrateKbps);
  const frameDurationMs = Number(
    options.frameDurationMs ?? DROP_AM1_PROFILE.frameDurationMs
  );
  const runs = encodeBoundedRuns(fitted.samples, detected.spans, {
    ffmpegPath: options.ffmpegPath,
    bitrateKbps,
    frameDurationMs,
    maximumRunSamples: options.maximumRunSamples
  });
  const chunks = timelineChunks(runs, detected.spans);
  verifyTimeline(chunks, durationTicks);
  return {
    chunks,
    summary: summarizeAudio({
      durationTicks,
      targetSamples,
      runs,
      silenceSpans: detected.spans,
      chunks,
      detected,
      bitrateKbps,
      frameDurationMs,
      extras: {
        strategy: "in-memory",
        wholeFilePcmBuffered: true,
        streaming: false,
        maximumPcmBytes: DROP_AM1_PROFILE.legacyMaximumPcmBytes,
        sourceSamples: fitted.sourceSamples,
        paddedSamples: fitted.paddedSamples,
        trimmedSamples: fitted.trimmedSamples
      }
    })
  };
}

export function encodeDropAudioFileTimeline(inputPath, durationTicks, options = {}) {
  const { targetSamples, targetPcmBytes } = targetAudioShape(durationTicks);
  if (statSync(inputPath).size !== targetPcmBytes) {
    throw new Error("Spooled PCM size does not match the V64 audio duration");
  }
  const detected = scanDropAudioPcmFile(inputPath, targetSamples, options);
  const bitrateKbps = Number(options.bitrateKbps ?? DROP_AM1_PROFILE.bitrateKbps);
  const frameDurationMs = Number(
    options.frameDurationMs ?? DROP_AM1_PROFILE.frameDurationMs
  );
  const maximumRunSamples = Number(
    options.maximumRunSamples ??
      DROP_AM1_PROFILE.sampleRate * DROP_AM1_PROFILE.maximumRunSeconds
  );
  const runs = encodeBoundedFileRuns(inputPath, targetSamples, detected.spans, {
    ffmpegPath: options.ffmpegPath,
    bitrateKbps,
    frameDurationMs,
    maximumRunSamples
  });
  const chunks = timelineChunks(runs, detected.spans);
  verifyTimeline(chunks, durationTicks);
  const maximumRunPcmBytes = maximumRunSamples * 2;
  return {
    chunks,
    summary: summarizeAudio({
      durationTicks,
      targetSamples,
      runs,
      silenceSpans: detected.spans,
      chunks,
      detected,
      bitrateKbps,
      frameDurationMs,
      extras: {
        strategy: "disk-spooled-two-pass",
        wholeFilePcmBuffered: false,
        streaming: true,
        spoolBytes: targetPcmBytes,
        scanReadBytes: detected.scanReadBytes,
        scanPasses: detected.scanPasses,
        maximumRunPcmBytes,
        maximumSourcePcmWorkingSetBytes: Math.max(
          detected.scanReadBytes,
          maximumRunPcmBytes
        )
      }
    })
  };
}

export function encodeDropSourceAudio(inputPath, durationTicks, options = {}) {
  const directory = mkdtempSync(join(
    options.temporaryDirectory || tmpdir(),
    "video64-drop-audio-"
  ));
  const pcmPath = join(directory, "source.pcm");
  try {
    const extraction = extractDropAudioPcmFile(
      inputPath,
      durationTicks,
      pcmPath,
      options
    );
    const encoded = encodeDropAudioFileTimeline(pcmPath, durationTicks, options);
    return {
      chunks: encoded.chunks,
      summary: {
        ...encoded.summary,
        sourceSamples: extraction.sourceSamples,
        sourcePcmBytes: extraction.sourcePcmBytes,
        paddedSamples: extraction.paddedSamples,
        trimmedSamples: extraction.trimmedSamples,
        spoolBytes: extraction.spoolBytes
      }
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
