import { spawnSync } from "node:child_process";

import {
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
  maximumPcmBytes: 256 * 1024 * 1024,
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
  maximumPcmBytes = DROP_AM1_PROFILE.maximumPcmBytes,
  spawnSyncImpl = spawnSync
} = {}) {
  assertInteger(maximumPcmBytes, "Maximum source PCM bytes", 2);
  const targetSamples = ticksToAudioSamples(durationTicks);
  const targetPcmBytes = targetSamples * 2;
  if (!Number.isSafeInteger(targetPcmBytes) || targetPcmBytes > maximumPcmBytes) {
    throw new RangeError(
      `Source audio requires ${targetPcmBytes} PCM bytes, exceeding the ` +
      `${maximumPcmBytes}-byte Video64 Drop ceiling; streaming long-form ` +
      "audio encoding is not yet implemented"
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

function encodeBoundedRuns(samples, silenceSpans, options) {
  const sampleRate = DROP_AM1_PROFILE.sampleRate;
  const maximumRunSamples = Number(
    options.maximumRunSamples ??
      sampleRate * DROP_AM1_PROFILE.maximumRunSeconds
  );
  return boundedAudibleSpans(samples.length, silenceSpans, maximumRunSamples)
    .map((span) => {
      const wav = encodePcm16Wav(
        samples.slice(span.startSample, span.endSample),
        sampleRate,
        1
      );
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
    });
}

export function encodeDropAudioTimeline(samplesInput, durationTicks, options = {}) {
  const targetSamples = ticksToAudioSamples(durationTicks);
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
  const aurnChunks = runs.map((run) => makeChunk(
    "AURN",
    run.timestamp,
    run.duration,
    encodeAurnPayload(run),
    { compress: false }
  ));
  const silenceChunks = silenceSpansToChunks(
    detected.spans,
    DROP_AM1_PROFILE.sampleRate
  );
  const chunks = [...aurnChunks, ...silenceChunks]
    .sort((left, right) => left.timestamp - right.timestamp);

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

  const silenceSamples = detected.spans.reduce(
    (sum, span) => sum + span.endSample - span.startSample,
    0
  );
  const keptSamples = runs.reduce((sum, run) => sum + run.keptSamples, 0);
  if (silenceSamples + keptSamples !== targetSamples) {
    throw new Error("AM1 source sample accounting is incomplete");
  }
  return {
    chunks,
    summary: {
      format: "VIDEO64-DROP-AM1-SOURCE-1",
      profile: DROP_AM1_PROFILE.id,
      normative: false,
      sourcePresent: true,
      sampleRate: DROP_AM1_PROFILE.sampleRate,
      channels: DROP_AM1_PROFILE.channels,
      bitrateKbps,
      frameDurationMs,
      maximumRunSeconds: DROP_AM1_PROFILE.maximumRunSeconds,
      maximumPcmBytes: DROP_AM1_PROFILE.maximumPcmBytes,
      durationTicks,
      targetSamples,
      pcmBytes: targetSamples * 2,
      sourceSamples: fitted.sourceSamples,
      paddedSamples: fitted.paddedSamples,
      trimmedSamples: fitted.trimmedSamples,
      audibleRuns: runs.length,
      opusPackets: runs.reduce((sum, run) => sum + run.packets.length, 0),
      keptSamples,
      silenceSpans: detected.spans.length,
      silenceSamples,
      timelineChunks: chunks.length,
      payloadBytes: chunks.reduce((sum, chunk) => sum + chunk.payload.length, 0),
      detector: detected.diagnostics
    }
  };
}

export function encodeDropSourceAudio(inputPath, durationTicks, options = {}) {
  const extraction = extractDropAudioPcm(inputPath, durationTicks, options);
  const encoded = encodeDropAudioTimeline(extraction.samples, durationTicks, options);
  return {
    chunks: encoded.chunks,
    summary: {
      ...encoded.summary,
      maximumPcmBytes: extraction.maximumPcmBytes,
      pcmBytes: extraction.targetPcmBytes,
      sourceSamples: extraction.sourceSamples,
      paddedSamples: extraction.paddedSamples,
      trimmedSamples: extraction.trimmedSamples
    }
  };
}
