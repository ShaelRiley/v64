import assert from "node:assert/strict";
import test from "node:test";
import { PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import {
  demuxV64,
  encodeCellTimeline,
  makeChunk,
  muxV64
} from "../prototype/js/container.mjs";
import {
  detectSilenceSpans,
  silenceSpansToChunks,
  synthesizeAm1Fixture
} from "../prototype/js/audio-am1.mjs";
import { encodeSegmentedAm1Runs } from "../prototype/js/audio-opus.mjs";
import { encodeAurnPayload } from "../prototype/js/audio-run.mjs";
import {
  OGG_OPUS_WRAPPER,
  buildOggOpusFromAurn,
  decodeAudioTimelineToPcm,
  decodeAudioWindowToPcm
} from "../prototype/js/audio-decode.mjs";

function buildDemuxed() {
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
  const audio = [
    ...runs.map((run) => makeChunk(
      "AURN",
      run.timestamp,
      run.duration,
      encodeAurnPayload(run),
      { compress: false }
    )),
    ...silenceSpansToChunks(spans, 48000)
  ].sort((a, b) => a.timestamp - b.timestamp);
  const columns = 4;
  const rows = 3;
  const paletteDepthId = PALETTE_DEPTHS.indexOf(16);
  const video = encodeCellTimeline(
    Array.from({ length: 48 }, () => Buffer.alloc(columns * rows * 3)),
    { columns, rows, cadenceId: 7, paletteDepthId, keyframeInterval: 24 }
  );
  const file = muxV64(
    { columns, rows, cadenceId: 7, paletteDepthId },
    [...video, ...audio]
  );
  return { demuxed: demuxV64(file), runs };
}

function allZero(buffer) {
  for (const byte of buffer) if (byte !== 0) return false;
  return true;
}

test("AURN reconstructs deterministic Ogg Opus framing", () => {
  const { runs } = buildDemuxed();
  assert.deepEqual(OGG_OPUS_WRAPPER, {
    serial: 0x56363401,
    vendor: "V64",
    sampleRate: 48000,
    channels: 1
  });
  for (const run of runs) {
    const first = buildOggOpusFromAurn(run);
    const second = buildOggOpusFromAurn(run);
    assert.deepEqual(first, second);
    assert.equal(first.toString("ascii", 0, 4), "OggS");
    assert.equal(first.readUInt32LE(14), OGG_OPUS_WRAPPER.serial);
    assert.equal(first[5] & 0x02, 0x02);
    assert.ok(first.includes(Buffer.from("OpusHead")));
    assert.ok(first.includes(Buffer.from("OpusTags")));
    assert.ok(first.length > run.packets.reduce((sum, packet) => sum + packet.length, 0));
  }
});

test("full AURN decode is deterministic and synthesizes exact silence", () => {
  const { demuxed } = buildDemuxed();
  const first = decodeAudioTimelineToPcm(demuxed);
  const second = decodeAudioTimelineToPcm(demuxed);
  assert.equal(first.samples, 96000);
  assert.equal(first.pcm.length, 192000);
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.pcm, second.pcm);
  assert.equal(first.runs.length, 2);
  assert.deepEqual(first.silenceSpans, [
    { timestamp: 15000, duration: 24000, startSample: 12000, endSample: 31200 },
    { timestamp: 87000, duration: 33000, startSample: 69600, endSample: 96000 }
  ]);
  assert.equal(allZero(first.pcm.subarray(12000 * 2, 31200 * 2)), true);
  assert.equal(allZero(first.pcm.subarray(69600 * 2, 96000 * 2)), true);
  assert.equal(allZero(first.pcm.subarray(0, 12000 * 2)), false);
  assert.equal(allZero(first.pcm.subarray(31200 * 2, 69600 * 2)), false);
});

test("repeated audio seeks equal exact slices of a full decode", () => {
  const { demuxed } = buildDemuxed();
  const full = decodeAudioTimelineToPcm(demuxed);
  const windows = [
    [0, 15000],
    [10000, 50000],
    [15000, 39000],
    [39000, 87000],
    [87000, 120000]
  ];
  for (const [startTick, endTick] of windows) {
    const first = decodeAudioWindowToPcm(demuxed, startTick, endTick);
    const second = decodeAudioWindowToPcm(demuxed, startTick, endTick);
    assert.equal(first.sha256, second.sha256);
    assert.deepEqual(first.pcm, second.pcm);
    assert.deepEqual(
      first.pcm,
      full.pcm.subarray(first.startSample * 2, first.endSample * 2)
    );
    if (startTick === 15000 && endTick === 39000) {
      assert.equal(allZero(first.pcm), true);
    }
    if (startTick === 0 && endTick === 15000) {
      assert.equal(allZero(first.pcm), false);
    }
  }
});

test("audio seek windows require exact ordered sample boundaries", () => {
  const { demuxed } = buildDemuxed();
  assert.throws(() => decodeAudioWindowToPcm(demuxed, 1, 1000), /48 kHz sample/);
  assert.throws(() => decodeAudioWindowToPcm(demuxed, 1000, 1000), /out of range/);
  assert.throws(() => decodeAudioWindowToPcm(demuxed, 0, 120001), /out of range/);
});
