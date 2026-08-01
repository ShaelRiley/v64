import assert from "node:assert/strict";
import test from "node:test";
import {
  detectSilenceSpans,
  encodePcm16Wav,
  synthesizeAm1Fixture
} from "../prototype/js/audio-am1.mjs";
import {
  encodeAm1OpusOgg,
  encodeSegmentedAm1Runs,
  nonSilenceSpans,
  opusPacketSamples,
  parseOggOpus
} from "../prototype/js/audio-opus.mjs";

test("AM1 libopus packets are standard, deterministic, and sample-exact", () => {
  const fixture = synthesizeAm1Fixture(48000);
  const wav = encodePcm16Wav(fixture.samples, 48000, 1);
  const first = encodeAm1OpusOgg(wav, { bitrateKbps: 8, frameDurationMs: 20 });
  const second = encodeAm1OpusOgg(wav, { bitrateKbps: 8, frameDurationMs: 20 });
  assert.equal(first.preSkip, 312);
  assert.equal(first.keptSamples, 96000);
  assert.equal(first.endTrim, 648);
  assert.equal(first.packets.length, 101);
  assert.ok(first.packetSamples.every((samples) => samples === 960));
  assert.equal(first.packetStreamSha256, second.packetStreamSha256);
  assert.deepEqual(first.packetStreamBytes, second.packetStreamBytes);
  assert.equal(parseOggOpus(first.ogg).keptSamples, 96000);
});

test("AM1 segmented runs exclude qualifying silence without shortening time", () => {
  const fixture = synthesizeAm1Fixture(48000);
  const { spans } = detectSilenceSpans(fixture.samples, {
    sampleRate: 48000,
    minimumSilenceMs: 120,
    hangoverMs: 40
  });
  assert.deepEqual(nonSilenceSpans(fixture.samples.length, spans), [
    { startSample: 0, endSample: 12000 },
    { startSample: 31200, endSample: 69600 }
  ]);
  const runs = encodeSegmentedAm1Runs(fixture.samples, 48000, spans, {
    bitrateKbps: 8,
    frameDurationMs: 20
  });
  assert.deepEqual(runs.map((run) => ({
    startSample: run.startSample,
    endSample: run.endSample,
    timestamp: run.timestamp,
    duration: run.duration,
    keptSamples: run.keptSamples
  })), [
    { startSample: 0, endSample: 12000, timestamp: 0, duration: 15000, keptSamples: 12000 },
    { startSample: 31200, endSample: 69600, timestamp: 39000, duration: 48000, keptSamples: 38400 }
  ]);
  const accounted = runs.reduce((sum, run) => sum + run.keptSamples, 0) +
    spans.reduce((sum, span) => sum + span.endSample - span.startSample, 0);
  assert.equal(accounted, fixture.samples.length);
});

test("Opus duration and Ogg parsing reject malformed input", () => {
  assert.throws(() => opusPacketSamples(Buffer.alloc(0)), /Empty Opus/);
  assert.throws(() => opusPacketSamples(Buffer.from([0x03])), /Truncated/);
  assert.throws(() => parseOggOpus(Buffer.from("not ogg")), /Invalid Ogg/);
  assert.throws(
    () => nonSilenceSpans(100, [{ startSample: 50, endSample: 40 }]),
    /out of range/
  );
});
