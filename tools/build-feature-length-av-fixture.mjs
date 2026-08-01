#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import {
  detectSilenceSpans,
  silenceSpansToChunks,
  synthesizeAm1Fixture
} from "../prototype/js/audio-am1.mjs";
import { encodeSegmentedAm1Runs } from "../prototype/js/audio-opus.mjs";
import { encodeAurnPayload } from "../prototype/js/audio-run.mjs";
import {
  encodeCellTimeline,
  makeChunk,
  muxV64,
  verifyV64
} from "../prototype/js/container.mjs";

const OUTPUT_DIRECTORY = resolve(
  process.argv[2] || "bench/generated/av-sync"
);
const SEGMENT_SECONDS = 2;
const SEGMENT_TICKS = 120_000;
const SEGMENT_FRAMES = 48;
const SEGMENT_COUNT = 900;
const DURATION_SECONDS = SEGMENT_SECONDS * SEGMENT_COUNT;
const DURATION_TICKS = SEGMENT_TICKS * SEGMENT_COUNT;
const SAMPLE_RATE = 48_000;
const EXPECTED_SAMPLES = DURATION_SECONDS * SAMPLE_RATE;
const EXPECTED_PCM_BYTES = EXPECTED_SAMPLES * 2;
const COLUMNS = 4;
const ROWS = 3;
const CADENCE_ID = 7;
const PALETTE_DEPTH_ID = PALETTE_DEPTHS.indexOf(16);

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

function shiftChunk(chunk, offset) {
  return makeChunk(
    chunk.type,
    chunk.timestamp + offset,
    chunk.duration,
    chunk.payload,
    {
      compress: chunk.compress,
      keyframe: chunk.keyframe
    }
  );
}

function segmentFrame(segmentIndex) {
  const frame = Buffer.alloc(COLUMNS * ROWS * 3);
  for (let cell = 0; cell < COLUMNS * ROWS; cell += 1) {
    const glyph = (segmentIndex * 7 + cell * 5) % 32;
    const background = (segmentIndex * 5 + cell) % 16;
    let foreground = (segmentIndex + cell * 3 + 1) % 16;
    if (foreground === background) foreground = (foreground + 1) % 16;
    frame[cell * 3] = glyph;
    frame[cell * 3 + 1] = foreground;
    frame[cell * 3 + 2] = background;
  }
  return frame;
}

const am1 = synthesizeAm1Fixture(SAMPLE_RATE);
const detected = detectSilenceSpans(am1.samples, {
  sampleRate: SAMPLE_RATE,
  windowMs: 10,
  enterDb: -48,
  exitDb: -42,
  minimumSilenceMs: 120,
  hangoverMs: 40
});
const baseSilence = silenceSpansToChunks(detected.spans, SAMPLE_RATE);
const baseRuns = encodeSegmentedAm1Runs(
  am1.samples,
  SAMPLE_RATE,
  detected.spans,
  { bitrateKbps: 8, frameDurationMs: 20 }
);
const baseAudio = [
  ...baseRuns.map((run) => makeChunk(
    "AURN",
    run.timestamp,
    run.duration,
    encodeAurnPayload(run),
    { compress: false }
  )),
  ...baseSilence
].sort((left, right) => left.timestamp - right.timestamp);

const basePacketCount = baseRuns.reduce(
  (total, run) => total + run.packets.length,
  0
);
const mediaChunks = [];
const segmentRasterFingerprints = [];
for (let segment = 0; segment < SEGMENT_COUNT; segment += 1) {
  const offset = segment * SEGMENT_TICKS;
  const frame = segmentFrame(segment);
  const video = encodeCellTimeline(
    Array.from({ length: SEGMENT_FRAMES }, () => frame),
    {
      columns: COLUMNS,
      rows: ROWS,
      cadenceId: CADENCE_ID,
      paletteDepthId: PALETTE_DEPTH_ID,
      keyframeInterval: SEGMENT_FRAMES
    }
  );
  mediaChunks.push(...video.map((chunk) => shiftChunk(chunk, offset)));
  mediaChunks.push(...baseAudio.map((chunk) => shiftChunk(chunk, offset)));
  if ([0, 30, 150, 450, 750, 870, 899].includes(segment)) {
    segmentRasterFingerprints.push({
      segment,
      timestamp: offset,
      frameSha256: createHash("sha256").update(frame).digest("hex")
    });
  }
}

mediaChunks.sort((left, right) =>
  left.timestamp - right.timestamp ||
  left.type.localeCompare(right.type)
);

const v64 = muxV64(
  {
    columns: COLUMNS,
    rows: ROWS,
    cadenceId: CADENCE_ID,
    paletteDepthId: PALETTE_DEPTH_ID
  },
  mediaChunks
);
const verification = verifyV64(v64);

if (verification.durationTicks !== DURATION_TICKS) {
  throw new Error("feature-length fixture duration drifted");
}
if (verification.frames !== SEGMENT_COUNT * SEGMENT_FRAMES) {
  throw new Error("feature-length fixture frame count drifted");
}
if (verification.audioRuns !== baseRuns.length * SEGMENT_COUNT) {
  throw new Error("feature-length fixture audio-run count drifted");
}
if (verification.audioSilenceSpans !== baseSilence.length * SEGMENT_COUNT) {
  throw new Error("feature-length fixture silence-run count drifted");
}

const manifest = {
  format: "V64-FEATURE-LENGTH-AV-1",
  filename: "feature-length-av.v64",
  durationSeconds: DURATION_SECONDS,
  durationTicks: DURATION_TICKS,
  segmentSeconds: SEGMENT_SECONDS,
  segments: SEGMENT_COUNT,
  cadenceFramesPerSecond: 24,
  frames: SEGMENT_COUNT * SEGMENT_FRAMES,
  columns: COLUMNS,
  rows: ROWS,
  sampleRate: SAMPLE_RATE,
  channels: 1,
  expectedSamples: EXPECTED_SAMPLES,
  expectedPcmBytes: EXPECTED_PCM_BYTES,
  pcmCeilingBytes: 256 * 1024 * 1024,
  pcmCeilingUtilizationBasisPoints:
    Math.floor(EXPECTED_PCM_BYTES * 10_000 / (256 * 1024 * 1024)),
  basePattern: {
    durationSeconds: SEGMENT_SECONDS,
    audioRuns: baseRuns.length,
    silenceRuns: baseSilence.length,
    opusPackets: basePacketCount,
    repeatedAudioRuns: baseRuns.length * SEGMENT_COUNT,
    repeatedSilenceRuns: baseSilence.length * SEGMENT_COUNT,
    repeatedOpusPackets: basePacketCount * SEGMENT_COUNT
  },
  segmentRasterFingerprints,
  container: {
    bytes: v64.length,
    sha256: createHash("sha256").update(v64).digest("hex"),
    featureFlags: v64.readUInt32LE(12),
    verification
  }
};

writeFileSync(resolve(OUTPUT_DIRECTORY, "feature-length-av.v64"), v64);
writeFileSync(
  resolve(OUTPUT_DIRECTORY, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
console.log(JSON.stringify(manifest, null, 2));
