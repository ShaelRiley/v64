import assert from "node:assert/strict";
import test from "node:test";
import { PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import {
  decodeAudioTimeline,
  demuxV64,
  encodeCellTimeline,
  makeChunk,
  muxV64,
  verifyV64
} from "../prototype/js/container.mjs";
import {
  detectSilenceSpans,
  silenceSpansToChunks,
  synthesizeAm1Fixture
} from "../prototype/js/audio-am1.mjs";
import { encodeSegmentedAm1Runs } from "../prototype/js/audio-opus.mjs";
import {
  decodeAurnPayload,
  encodeAurnPayload,
  validateAurnChunk
} from "../prototype/js/audio-run.mjs";

function fixtureParts() {
  const fixture = synthesizeAm1Fixture(48000);
  const { spans } = detectSilenceSpans(fixture.samples, {
    sampleRate: 48000,
    minimumSilenceMs: 120,
    hangoverMs: 40
  });
  const runs = encodeSegmentedAm1Runs(fixture.samples, 48000, spans, {
    bitrateKbps: 8,
    frameDurationMs: 20
  });
  const audioChunks = [
    ...runs.map((run) => makeChunk(
      "AURN",
      run.timestamp,
      run.duration,
      encodeAurnPayload(run),
      { compress: false }
    )),
    ...silenceSpansToChunks(spans, 48000)
  ].sort((a, b) => a.timestamp - b.timestamp);
  return { fixture, spans, runs, audioChunks };
}

function videoChunks() {
  const columns = 4;
  const rows = 3;
  const frames = Array.from({ length: 48 }, () => Buffer.alloc(columns * rows * 3));
  return {
    columns,
    rows,
    paletteDepthId: PALETTE_DEPTHS.indexOf(16),
    chunks: encodeCellTimeline(frames, {
      columns,
      rows,
      cadenceId: 7,
      paletteDepthId: PALETTE_DEPTHS.indexOf(16),
      keyframeInterval: 24
    })
  };
}

function buildFile(audioChunks) {
  const video = videoChunks();
  return muxV64({
    columns: video.columns,
    rows: video.rows,
    cadenceId: 7,
    paletteDepthId: video.paletteDepthId
  }, [...video.chunks, ...audioChunks]);
}

test("AURN payloads round-trip standard Opus packets and trim accounting", () => {
  const { runs } = fixtureParts();
  for (const run of runs) {
    const payload = encodeAurnPayload(run);
    const decoded = decodeAurnPayload(payload);
    assert.equal(decoded.keptSamples, run.keptSamples);
    assert.equal(decoded.preSkip, run.preSkip);
    assert.equal(decoded.endTrim, run.endTrim);
    assert.deepEqual(decoded.packetSamples, run.packetSamples);
    assert.deepEqual(decoded.packets, run.packets);
    assert.deepEqual(encodeAurnPayload(decoded), payload);
    const chunk = makeChunk("AURN", run.timestamp, run.duration, payload, {
      compress: false
    });
    assert.equal(validateAurnChunk(chunk).keptSamples, run.keptSamples);
  }
});

test("AURN and SILN form one exact two-second container timeline", () => {
  const { audioChunks } = fixtureParts();
  const file = buildFile(audioChunks);
  const demuxed = demuxV64(file);
  assert.equal(Boolean(demuxed.header.featureFlags & 64), true);
  const audio = decodeAudioTimeline(demuxed);
  assert.equal(audio.runs.length, 2);
  assert.equal(audio.silenceSpans.length, 2);
  assert.equal(audio.keptSamples, 50400);
  assert.equal(audio.durationTicks, 120000);
  assert.deepEqual(audio.timeline.map((item) => ({
    type: item.type,
    timestamp: item.timestamp,
    duration: item.duration
  })), [
    { type: "AURN", timestamp: 0, duration: 15000 },
    { type: "SILN", timestamp: 15000, duration: 24000 },
    { type: "AURN", timestamp: 39000, duration: 48000 },
    { type: "SILN", timestamp: 87000, duration: 33000 }
  ]);
  assert.deepEqual(verifyV64(file), {
    valid: true,
    frames: 48,
    keyframes: 2,
    repeatSpans: 2,
    audioRuns: 2,
    audioSilenceSpans: 2,
    audioKeptSamples: 50400,
    chunks: demuxed.chunks.length,
    durationTicks: 120000
  });
});

test("AURN rejects packet, trim, duration, feature, and continuity corruption", () => {
  const { runs, audioChunks } = fixtureParts();
  const payload = encodeAurnPayload(runs[0]);
  const badPacketDuration = Buffer.from(payload);
  badPacketDuration.writeUInt16LE(480, 34);
  assert.throws(() => decodeAurnPayload(badPacketDuration), /Opus TOC/);

  const badTrim = Buffer.from(payload);
  badTrim.writeUInt32LE(badTrim.readUInt32LE(12) + 1, 12);
  assert.throws(() => decodeAurnPayload(badTrim), /accounting mismatch/);

  const wrongDurationChunks = audioChunks.map((chunk, index) => index === 0
    ? makeChunk("AURN", chunk.timestamp, chunk.duration - 1, chunk.payload, {
        compress: false
      })
    : chunk);
  assert.throws(() => verifyV64(buildFile(wrongDurationChunks)), /duration disagrees/);

  const gapChunks = audioChunks.map((chunk, index) => index === 1
    ? makeChunk(chunk.type, chunk.timestamp + 1, chunk.duration, chunk.payload, {
        compress: false
      })
    : chunk);
  assert.throws(() => verifyV64(buildFile(gapChunks)), /Discontinuous audio timeline/);

  const featureMismatch = Buffer.from(buildFile(audioChunks));
  featureMismatch.writeUInt32LE(featureMismatch.readUInt32LE(12) & ~64, 12);
  assert.throws(() => verifyV64(featureMismatch), /feature flag/);
});
