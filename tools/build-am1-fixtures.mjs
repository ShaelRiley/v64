#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import {
  detectSilenceSpans,
  encodePcm16Wav,
  silenceSpansToChunks,
  synthesizeAm1Fixture
} from "../prototype/js/audio-am1.mjs";
import { encodeSegmentedAm1Runs } from "../prototype/js/audio-opus.mjs";
import { encodeAurnPayload } from "../prototype/js/audio-run.mjs";
import {
  decodeAudioTimelineToPcm,
  decodeAudioWindowToPcm
} from "../prototype/js/audio-decode.mjs";
import {
  demuxV64,
  encodeCellTimeline,
  makeChunk,
  muxV64,
  verifyV64
} from "../prototype/js/container.mjs";

const outputDirectory = resolve(process.argv[2] || "bench/generated/am1");
mkdirSync(outputDirectory, { recursive: true });

const fixture = synthesizeAm1Fixture(48000);
const wav = encodePcm16Wav(fixture.samples, fixture.sampleRate, fixture.channels);
const detected = detectSilenceSpans(fixture.samples, {
  sampleRate: fixture.sampleRate,
  windowMs: 10,
  enterDb: -48,
  exitDb: -42,
  minimumSilenceMs: 120,
  hangoverMs: 40
});
const silenceChunks = silenceSpansToChunks(detected.spans, fixture.sampleRate);
const runs = encodeSegmentedAm1Runs(
  fixture.samples,
  fixture.sampleRate,
  detected.spans,
  { bitrateKbps: 8, frameDurationMs: 20 }
);
const aurnChunks = runs.map((run) => makeChunk(
  "AURN",
  run.timestamp,
  run.duration,
  encodeAurnPayload(run),
  { compress: false }
));
const runManifest = runs.map((run, index) => {
  const filename = `run-${String(index).padStart(2, "0")}.opuspackets`;
  writeFileSync(resolve(outputDirectory, filename), run.packetStreamBytes);
  return {
    filename,
    startSample: run.startSample,
    endSample: run.endSample,
    timestamp: run.timestamp,
    duration: run.duration,
    preSkip: run.preSkip,
    endTrim: run.endTrim,
    keptSamples: run.keptSamples,
    decodedSamples: run.decodedSamples,
    packets: run.packets.length,
    packetSamples: run.packetSamples,
    packetStreamBytes: run.packetStreamBytes.length,
    packetStreamSha256: run.packetStreamSha256,
    aurnPayloadBytes: encodeAurnPayload(run).length
  };
});
const silenceSamples = detected.spans.reduce(
  (sum, span) => sum + span.endSample - span.startSample,
  0
);
const accountedSamples = silenceSamples + runManifest.reduce(
  (sum, run) => sum + run.keptSamples,
  0
);

const columns = 4;
const rows = 3;
const cadenceId = 7;
const paletteDepthId = PALETTE_DEPTHS.indexOf(16);
const videoFrames = Array.from(
  { length: 48 },
  () => Buffer.alloc(columns * rows * 3)
);
const videoChunks = encodeCellTimeline(videoFrames, {
  columns,
  rows,
  cadenceId,
  paletteDepthId,
  keyframeInterval: 24
});
const audioChunks = [...aurnChunks, ...silenceChunks]
  .sort((a, b) => a.timestamp - b.timestamp);
const v64 = muxV64(
  { columns, rows, cadenceId, paletteDepthId },
  [...videoChunks, ...audioChunks]
);
const verification = verifyV64(v64);
const demuxed = demuxV64(v64);
const decoded = decodeAudioTimelineToPcm(demuxed);
const seekRanges = [
  [0, 15000],
  [10000, 50000],
  [15000, 39000],
  [39000, 87000],
  [87000, 120000]
];
const seekWindows = seekRanges.map(([startTick, endTick]) => {
  const window = decodeAudioWindowToPcm(demuxed, startTick, endTick);
  const fullSlice = decoded.pcm.subarray(
    window.startSample * 2,
    window.endSample * 2
  );
  return {
    startTick,
    endTick,
    startSample: window.startSample,
    endSample: window.endSample,
    bytes: window.pcm.length,
    sha256: window.sha256,
    matchesFullDecode: window.pcm.equals(fullSlice)
  };
});
const manifest = {
  format: "V64-AM1-FIXTURE-4",
  sampleRate: fixture.sampleRate,
  channels: fixture.channels,
  samples: fixture.samples.length,
  durationSeconds: fixture.samples.length / fixture.sampleRate,
  wavBytes: wav.length,
  wavSha256: createHash("sha256").update(wav).digest("hex"),
  segments: fixture.segments,
  detector: detected.diagnostics,
  silenceSpans: detected.spans,
  silenceChunks: silenceChunks.map((chunk) => ({
    type: chunk.type,
    timestamp: chunk.timestamp,
    duration: chunk.duration,
    payloadBytes: chunk.payload.length
  })),
  opus: {
    application: "voip",
    bitrateKbps: 8,
    constrainedVbr: true,
    frameDurationMs: 20,
    dtx: false,
    fec: false,
    runs: runManifest,
    silenceSamples,
    accountedSamples
  },
  container: {
    filename: "am1-container.v64",
    bytes: v64.length,
    sha256: createHash("sha256").update(v64).digest("hex"),
    featureFlags: v64.readUInt32LE(12),
    audioFeatureDeclared: Boolean(v64.readUInt32LE(12) & 64),
    verification
  },
  playback: {
    filename: "am1-decoded.pcm",
    samples: decoded.samples,
    bytes: decoded.pcm.length,
    sha256: decoded.sha256,
    runs: decoded.runs,
    silenceSpans: decoded.silenceSpans,
    seekWindows
  }
};

writeFileSync(resolve(outputDirectory, "am1-hysteresis.wav"), wav);
writeFileSync(resolve(outputDirectory, "am1-container.v64"), v64);
writeFileSync(resolve(outputDirectory, "am1-decoded.pcm"), decoded.pcm);
writeFileSync(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
console.log(JSON.stringify(manifest, null, 2));
