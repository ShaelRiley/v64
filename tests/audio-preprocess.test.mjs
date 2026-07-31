import assert from "node:assert/strict";
import test from "node:test";
import { decodePcm16Wav, encodePcm16Wav } from "../prototype/js/audio-am1.mjs";
import {
  AM1_PREPROCESS_PROFILE,
  analyzePcmSegments,
  comparePcm,
  preprocessAm1Wav,
  synthesizeAm1PreprocessFixture
} from "../prototype/js/audio-preprocess.mjs";

function byId(rows) {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

test("AM1 preprocessing downmixes, resamples, filters, compresses, and limits deterministically", () => {
  const fixture = synthesizeAm1PreprocessFixture(44100);
  const first = preprocessAm1Wav(fixture.wav);
  const second = preprocessAm1Wav(fixture.wav);
  assert.deepEqual(AM1_PREPROCESS_PROFILE, {
    outputChannels: 1,
    outputSampleRate: 48000,
    highPassHz: 200,
    lowPassHz: 4500,
    compressor: {
      thresholdDb: -18,
      ratio: 3,
      attackMs: 10,
      releaseMs: 120,
      makeupDb: 3
    },
    limiter: {
      ceilingDbfs: -1,
      linearLimit: 0.891251,
      attackMs: 5,
      releaseMs: 50
    },
    ffmpegFilter: AM1_PREPROCESS_PROFILE.ffmpegFilter
  });
  assert.equal(first.inputSampleRate, 44100);
  assert.equal(first.inputChannels, 2);
  assert.equal(first.sampleRate, 48000);
  assert.equal(first.channels, 1);
  assert.equal(first.samples.length, 96000);
  assert.equal(first.wav.length, 192044);
  assert.deepEqual(first.wav, second.wav);
  assert.deepEqual(first.samples, second.samples);
  const decoded = decodePcm16Wav(first.wav);
  assert.equal(decoded.sampleRate, 48000);
  assert.equal(decoded.channels, 1);
  assert.deepEqual(decoded.samples, first.samples);

  const metrics = byId(analyzePcmSegments(
    first.samples,
    first.sampleRate,
    fixture.segments
  ));
  assert.ok(metrics["mid-1khz"].rms > 0.12);
  assert.ok(metrics["low-80hz"].rms < metrics["mid-1khz"].rms * 0.40);
  assert.ok(metrics["high-8khz"].rms < metrics["mid-1khz"].rms * 0.60);
  assert.ok(metrics["quiet-1khz"].rms > 0.02);
  assert.ok(metrics["loud-1khz"].rms / metrics["quiet-1khz"].rms < 7);
  assert.ok(Math.max(...Object.values(metrics).map((metric) => metric.peak)) <= 0.90);
});

test("PCM comparison is exact for identity and rejects mismatched arrays", () => {
  const samples = Int16Array.from([0, 100, -100, 1000, -1000]);
  assert.deepEqual(comparePcm(samples, samples), {
    samples: 5,
    mse: 0,
    rmse: 0,
    meanAbsoluteError: 0,
    peakAbsoluteError: 0,
    snrDb: Number.POSITIVE_INFINITY
  });
  assert.throws(() => comparePcm(samples, samples.slice(1)), /equal nonempty/);
  assert.throws(() => comparePcm([], []), /equal nonempty/);
});

test("AM1 preprocessing and analysis reject malformed inputs", () => {
  assert.throws(() => preprocessAm1Wav(Buffer.from("not wav")), /Invalid WAV/);
  assert.throws(
    () => preprocessAm1Wav(encodePcm16Wav(new Int16Array(0), 48000, 1)),
    /requires audio samples/
  );
  assert.throws(
    () => analyzePcmSegments(Int16Array.from([0, 1]), 48000, []),
    /requires segment definitions/
  );
  assert.throws(
    () => analyzePcmSegments(Int16Array.from([0, 1]), 48000, [
      { id: "bad", startSeconds: 0, endSeconds: 1 }
    ]),
    /Invalid analysis range/
  );
});
