import { spawnSync } from "node:child_process";
import { decodePcm16Wav, encodePcm16Wav } from "./audio-am1.mjs";

const FILTER = [
  "highpass=f=200:p=2",
  "lowpass=f=4500:p=2",
  "acompressor=threshold=0.1258925:ratio=3:attack=10:release=120:makeup=1.4125375:knee=2.828427",
  "alimiter=limit=0.891251:attack=5:release=50:level=false"
].join(",");

function assertInteger(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
}

function decodeRawPcm16(input) {
  const bytes = Buffer.from(input);
  if (!bytes.length || bytes.length % 2) {
    throw new Error("AM1 preprocessing produced malformed raw PCM16");
  }
  const samples = new Int16Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2);
  }
  return samples;
}

export const AM1_PREPROCESS_PROFILE = Object.freeze({
  outputChannels: 1,
  outputSampleRate: 48000,
  highPassHz: 200,
  lowPassHz: 4500,
  compressor: Object.freeze({
    thresholdDb: -18,
    ratio: 3,
    attackMs: 10,
    releaseMs: 120,
    makeupDb: 3
  }),
  limiter: Object.freeze({
    ceilingDbfs: -1,
    linearLimit: 0.891251,
    attackMs: 5,
    releaseMs: 50
  }),
  ffmpegFilter: FILTER
});

export function preprocessAm1Wav(input, options = {}) {
  const source = decodePcm16Wav(input);
  if (!source.samples.length) throw new Error("AM1 preprocessing requires audio samples");
  const result = spawnSync(options.ffmpegPath || "ffmpeg", [
    "-v", "error", "-f", "wav", "-i", "pipe:0",
    "-map_metadata", "-1", "-vn", "-af", FILTER,
    "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le",
    "-fflags", "+bitexact", "-flags:a", "+bitexact",
    "-f", "s16le", "pipe:1"
  ], {
    input: Buffer.from(input),
    encoding: null,
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.error) throw new Error(`ffmpeg could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg AM1 preprocessing failed (${result.status}): ${result.stderr.toString("utf8").trim()}`
    );
  }
  const samples = decodeRawPcm16(result.stdout);
  const expectedSamples = Math.round(source.samples.length / source.channels *
    48000 / source.sampleRate);
  if (Math.abs(samples.length - expectedSamples) > 1) {
    throw new Error(
      `AM1 preprocessing sample count ${samples.length} disagrees with expected ${expectedSamples}`
    );
  }
  const canonicalWav = encodePcm16Wav(samples, 48000, 1);
  return {
    wav: canonicalWav,
    samples,
    sampleRate: 48000,
    channels: 1,
    inputSampleRate: source.sampleRate,
    inputChannels: source.channels,
    filter: FILTER
  };
}

export function synthesizeAm1PreprocessFixture(sampleRate = 44100) {
  assertInteger(sampleRate, "AM1 preprocess fixture rate", 8000, 192000);
  const definitions = [
    { id: "low-80hz", frequency: 80, amplitude: 0.35 },
    { id: "mid-1khz", frequency: 1000, amplitude: 0.35 },
    { id: "high-8khz", frequency: 8000, amplitude: 0.35 },
    { id: "quiet-1khz", frequency: 1000, amplitude: 0.05 },
    { id: "loud-1khz", frequency: 1000, amplitude: 0.95 }
  ];
  const segmentFrames = Math.round(sampleRate * 0.4);
  const samples = new Int16Array(segmentFrames * definitions.length * 2);
  const segments = [];
  let frameCursor = 0;
  for (const definition of definitions) {
    const startFrame = frameCursor;
    for (let index = 0; index < segmentFrames; index += 1) {
      const phase = 2 * Math.PI * definition.frequency * index / sampleRate;
      const left = Math.sin(phase) * definition.amplitude;
      const right = Math.sin(phase + Math.PI / 7) * definition.amplitude * 0.8;
      const output = (frameCursor + index) * 2;
      samples[output] = Math.round(Math.max(-1, Math.min(1, left)) * 32767);
      samples[output + 1] = Math.round(Math.max(-1, Math.min(1, right)) * 32767);
    }
    frameCursor += segmentFrames;
    segments.push({
      ...definition,
      startFrame,
      endFrame: frameCursor,
      startSeconds: startFrame / sampleRate,
      endSeconds: frameCursor / sampleRate
    });
  }
  return {
    sampleRate,
    channels: 2,
    samples,
    segments,
    wav: encodePcm16Wav(samples, sampleRate, 2)
  };
}

export function analyzePcmSegments(samplesInput, sampleRate, segments, options = {}) {
  const samples = samplesInput instanceof Int16Array
    ? samplesInput
    : Int16Array.from(samplesInput || []);
  assertInteger(sampleRate, "PCM analysis sample rate", 1, 384000);
  if (!Array.isArray(segments) || !segments.length) {
    throw new TypeError("PCM analysis requires segment definitions");
  }
  const trimMs = Number(options.trimMs ?? 80);
  if (!Number.isFinite(trimMs) || trimMs < 0) throw new RangeError("Invalid PCM analysis trim");
  const trimSamples = Math.round(sampleRate * trimMs / 1000);
  return segments.map((segment) => {
    const start = Math.round(segment.startSeconds * sampleRate) + trimSamples;
    const end = Math.round(segment.endSeconds * sampleRate) - trimSamples;
    if (start < 0 || end > samples.length || end <= start) {
      throw new RangeError(`Invalid analysis range for ${segment.id}`);
    }
    let sumSquares = 0;
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = samples[index] / 32768;
      sumSquares += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    const rms = Math.sqrt(sumSquares / (end - start));
    return {
      id: segment.id,
      startSample: start,
      endSample: end,
      rms,
      rmsDbfs: rms ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY,
      peak,
      peakDbfs: peak ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY
    };
  });
}

export function comparePcm(referenceInput, decodedInput) {
  const reference = referenceInput instanceof Int16Array
    ? referenceInput
    : Int16Array.from(referenceInput || []);
  const decoded = decodedInput instanceof Int16Array
    ? decodedInput
    : Int16Array.from(decodedInput || []);
  if (reference.length !== decoded.length || !reference.length) {
    throw new RangeError("PCM comparison requires equal nonempty sample arrays");
  }
  let signal = 0;
  let error = 0;
  let absoluteError = 0;
  let peakError = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const expected = reference[index] / 32768;
    const actual = decoded[index] / 32768;
    const delta = expected - actual;
    signal += expected * expected;
    error += delta * delta;
    absoluteError += Math.abs(delta);
    peakError = Math.max(peakError, Math.abs(delta));
  }
  const mse = error / reference.length;
  return {
    samples: reference.length,
    mse,
    rmse: Math.sqrt(mse),
    meanAbsoluteError: absoluteError / reference.length,
    peakAbsoluteError: peakError,
    snrDb: error === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10(signal / error)
  };
}
