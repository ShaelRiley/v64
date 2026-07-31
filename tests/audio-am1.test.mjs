import assert from "node:assert/strict";
import test from "node:test";
import { PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import { encodeCellTimeline, muxV64, verifyV64 } from "../prototype/js/container.mjs";
import {
  decodePcm16Wav,
  detectSilenceSpans,
  encodePcm16Wav,
  silenceSpansToChunks,
  synthesizeAm1Fixture
} from "../prototype/js/audio-am1.mjs";

function blankFrame(columns, rows) {
  return Buffer.alloc(columns * rows * 3);
}

test("AM1 PCM16 WAV fixture round-trips byte-exact samples", () => {
  const fixture = synthesizeAm1Fixture(48000);
  const wav = encodePcm16Wav(fixture.samples, fixture.sampleRate, fixture.channels);
  const decoded = decodePcm16Wav(wav);
  assert.equal(decoded.sampleRate, 48000);
  assert.equal(decoded.channels, 1);
  assert.deepEqual(decoded.samples, fixture.samples);
  assert.deepEqual(
    encodePcm16Wav(decoded.samples, decoded.sampleRate, decoded.channels),
    wav
  );
});

test("AM1 hysteresis finds long silence and rejects an 80 ms pause", () => {
  const fixture = synthesizeAm1Fixture(48000);
  const detected = detectSilenceSpans(fixture.samples, {
    sampleRate: fixture.sampleRate,
    windowMs: 10,
    enterDb: -48,
    exitDb: -42,
    minimumSilenceMs: 120,
    hangoverMs: 40
  });
  assert.deepEqual(detected.spans, [
    { startSample: 12000, endSample: 31200 },
    { startSample: 69600, endSample: 96000 }
  ]);
});

test("AM1 silence spans become exact SILN timeline chunks", () => {
  const fixture = synthesizeAm1Fixture(48000);
  const { spans } = detectSilenceSpans(fixture.samples, {
    sampleRate: 48000,
    minimumSilenceMs: 120,
    hangoverMs: 40
  });
  const silence = silenceSpansToChunks(spans, 48000);
  assert.deepEqual(silence.map(({ type, timestamp, duration, payload }) => ({
    type,
    timestamp,
    duration,
    payloadLength: payload.length
  })), [
    { type: "SILN", timestamp: 15000, duration: 24000, payloadLength: 0 },
    { type: "SILN", timestamp: 87000, duration: 33000, payloadLength: 0 }
  ]);

  const columns = 4;
  const rows = 3;
  const paletteDepthId = PALETTE_DEPTHS.indexOf(16);
  const frames = Array.from({ length: 48 }, () => blankFrame(columns, rows));
  const video = encodeCellTimeline(frames, {
    columns,
    rows,
    cadenceId: 7,
    paletteDepthId,
    keyframeInterval: 24
  });
  const file = muxV64(
    { columns, rows, cadenceId: 7, paletteDepthId },
    [...video, ...silence]
  );
  assert.equal(verifyV64(file).valid, true);
});

test("AM1 rejects malformed WAV and inexact sample boundaries", () => {
  assert.throws(() => decodePcm16Wav(Buffer.from("not a wave")), /Invalid WAV/);
  assert.throws(
    () => silenceSpansToChunks([{ startSample: 1, endSample: 4 }], 48000),
    /not exactly representable/
  );
});
