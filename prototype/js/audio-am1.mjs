import { TICK_RATE } from "./constants.mjs";
import { makeChunk } from "./container.mjs";

function assertInteger(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
}

function dbToAmplitude(db) {
  return 10 ** (db / 20);
}

export function encodePcm16Wav(samples, sampleRate, channels = 1) {
  assertInteger(sampleRate, "WAV sample rate", 1, 384000);
  assertInteger(channels, "WAV channels", 1, 32);
  const pcm = samples instanceof Int16Array ? samples : Int16Array.from(samples || []);
  if (pcm.length % channels) {
    throw new RangeError("PCM sample count is not divisible by channel count");
  }
  const dataBytes = pcm.length * 2;
  const output = Buffer.alloc(44 + dataBytes);
  output.write("RIFF", 0, 4, "ascii");
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write("WAVE", 8, 4, "ascii");
  output.write("fmt ", 12, 4, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * channels * 2, 28);
  output.writeUInt16LE(channels * 2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, 4, "ascii");
  output.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < pcm.length; index += 1) {
    output.writeInt16LE(pcm[index], 44 + index * 2);
  }
  return output;
}

export function decodePcm16Wav(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Invalid WAV header");
  }
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw new Error(`Truncated WAV ${id} chunk`);
    if (id === "fmt ") {
      if (length < 16) throw new Error("Truncated WAV format chunk");
      format = {
        audioFormat: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        byteRate: bytes.readUInt32LE(start + 8),
        blockAlign: bytes.readUInt16LE(start + 12),
        bitsPerSample: bytes.readUInt16LE(start + 14)
      };
    } else if (id === "data") {
      data = bytes.subarray(start, end);
    }
    offset = end + (length & 1);
  }
  if (!format || !data) throw new Error("WAV is missing format or data chunk");
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16 ||
      !format.channels || !format.sampleRate ||
      format.blockAlign !== format.channels * 2 ||
      format.byteRate !== format.sampleRate * format.blockAlign || data.length % 2) {
    throw new Error("Unsupported PCM16 WAV format");
  }
  const samples = new Int16Array(data.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = data.readInt16LE(index * 2);
  }
  return { ...format, samples };
}

export function synthesizeAm1Fixture(sampleRate = 48000) {
  assertInteger(sampleRate, "AM1 fixture sample rate", 8000, 192000);
  const segments = [
    { kind: "tone", seconds: 0.25, frequency: 440, amplitude: 0.35 },
    { kind: "silence", seconds: 0.40 },
    { kind: "tone", seconds: 0.40, frequency: 880, amplitude: 0.25 },
    { kind: "silence", seconds: 0.08 },
    { kind: "tone", seconds: 0.32, frequency: 330, amplitude: 0.30 },
    { kind: "silence", seconds: 0.55 }
  ];
  const output = [];
  const boundaries = [];
  let cursor = 0;
  for (const segment of segments) {
    const count = Math.round(segment.seconds * sampleRate);
    const startSample = cursor;
    for (let index = 0; index < count; index += 1) {
      const value = segment.kind === "tone"
        ? Math.sin(2 * Math.PI * segment.frequency * index / sampleRate) * segment.amplitude
        : 0;
      output.push(Math.max(-32768, Math.min(32767, Math.round(value * 32767))));
    }
    cursor += count;
    boundaries.push({ ...segment, startSample, endSample: cursor });
  }
  return {
    sampleRate,
    channels: 1,
    samples: Int16Array.from(output),
    segments: boundaries
  };
}

function windowRms(samples, start, end) {
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    const value = samples[index] / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}

function silenceDetectorConfig(options = {}) {
  const sampleRate = Number(options.sampleRate);
  assertInteger(sampleRate, "Silence sample rate", 1, 384000);
  const windowMs = Number(options.windowMs ?? 10);
  const enterDb = Number(options.enterDb ?? -48);
  const exitDb = Number(options.exitDb ?? -42);
  const minimumSilenceMs = Number(options.minimumSilenceMs ?? 120);
  const hangoverMs = Number(options.hangoverMs ?? 40);
  if (!Number.isFinite(windowMs) || windowMs <= 0 ||
      !Number.isFinite(enterDb) || !Number.isFinite(exitDb) || enterDb >= exitDb ||
      !Number.isFinite(minimumSilenceMs) || minimumSilenceMs < 0 ||
      !Number.isFinite(hangoverMs) || hangoverMs < 0) {
    throw new RangeError("Invalid silence detector options");
  }
  return {
    sampleRate,
    windowSamples: Math.max(1, Math.round(sampleRate * windowMs / 1000)),
    enterDb,
    exitDb,
    minimumSamples: Math.round(sampleRate * minimumSilenceMs / 1000),
    hangoverSamples: Math.round(sampleRate * hangoverMs / 1000),
    enterAmplitude: dbToAmplitude(enterDb),
    exitAmplitude: dbToAmplitude(exitDb)
  };
}

export function createSilenceSpanDetector(options = {}) {
  const config = silenceDetectorConfig(options);
  const spans = [];
  let pending = new Int16Array(0);
  let processedSamples = 0;
  let totalSamples = 0;
  let candidateStart = null;
  let silenceStart = null;
  let exitCandidate = null;
  let result = null;

  const processWindow = (samples, localStart, localEnd, absoluteStart) => {
    const absoluteEnd = absoluteStart + localEnd - localStart;
    const rms = windowRms(samples, localStart, localEnd);
    if (silenceStart === null) {
      if (rms <= config.enterAmplitude) {
        if (candidateStart === null) candidateStart = absoluteStart;
        if (absoluteEnd - candidateStart >= config.minimumSamples) {
          silenceStart = candidateStart;
        }
      } else {
        candidateStart = null;
      }
      return;
    }

    if (rms >= config.exitAmplitude) {
      if (exitCandidate === null) exitCandidate = absoluteStart;
      if (absoluteEnd - exitCandidate >= config.hangoverSamples) {
        spans.push({ startSample: silenceStart, endSample: exitCandidate });
        silenceStart = null;
        candidateStart = null;
        exitCandidate = null;
      }
    } else {
      exitCandidate = null;
    }
  };

  const push = (samplesInput) => {
    if (result) throw new Error("Silence detector is already finished");
    const input = samplesInput instanceof Int16Array
      ? samplesInput
      : Int16Array.from(samplesInput || []);
    if (!input.length) return;
    totalSamples += input.length;
    const combined = new Int16Array(pending.length + input.length);
    combined.set(pending, 0);
    combined.set(input, pending.length);
    let localStart = 0;
    while (combined.length - localStart >= config.windowSamples) {
      const localEnd = localStart + config.windowSamples;
      processWindow(combined, localStart, localEnd, processedSamples);
      processedSamples += config.windowSamples;
      localStart = localEnd;
    }
    pending = combined.slice(localStart);
  };

  const finish = () => {
    if (result) return result;
    if (pending.length) {
      processWindow(pending, 0, pending.length, processedSamples);
      processedSamples += pending.length;
      pending = new Int16Array(0);
    }
    if (processedSamples !== totalSamples) {
      throw new Error("Silence detector sample accounting is inconsistent");
    }
    if (silenceStart !== null) {
      spans.push({ startSample: silenceStart, endSample: totalSamples });
    } else if (candidateStart !== null &&
        totalSamples - candidateStart >= config.minimumSamples) {
      spans.push({ startSample: candidateStart, endSample: totalSamples });
    }
    result = {
      spans: spans.map((span) => ({ ...span })),
      diagnostics: {
        sampleRate: config.sampleRate,
        samples: totalSamples,
        windowSamples: config.windowSamples,
        enterDb: config.enterDb,
        exitDb: config.exitDb,
        minimumSamples: config.minimumSamples,
        hangoverSamples: config.hangoverSamples
      }
    };
    return result;
  };

  return Object.freeze({
    push,
    finish,
    get windowSamples() {
      return config.windowSamples;
    }
  });
}

export function detectSilenceSpans(samplesInput, options = {}) {
  const detector = createSilenceSpanDetector(options);
  detector.push(samplesInput);
  return detector.finish();
}

export function sampleIndexToTicks(sampleIndex, sampleRate) {
  assertInteger(sampleIndex, "Audio sample index", 0);
  assertInteger(sampleRate, "Audio sample rate", 1, 384000);
  const numerator = sampleIndex * TICK_RATE;
  if (!Number.isSafeInteger(numerator) || numerator % sampleRate) {
    throw new RangeError(
      "Audio sample boundary is not exactly representable on the V64 timeline"
    );
  }
  return numerator / sampleRate;
}

export function silenceSpansToChunks(spans, sampleRate) {
  if (!Array.isArray(spans)) throw new TypeError("Silence spans must be an array");
  let previousEnd = -1;
  return spans.map((span) => {
    assertInteger(span?.startSample, "Silence start sample", 0);
    assertInteger(span?.endSample, "Silence end sample", span.startSample + 1);
    if (span.startSample < previousEnd) {
      throw new Error("Silence spans overlap or are out of order");
    }
    previousEnd = span.endSample;
    const timestamp = sampleIndexToTicks(span.startSample, sampleRate);
    const end = sampleIndexToTicks(span.endSample, sampleRate);
    return makeChunk("SILN", timestamp, end - timestamp, Buffer.alloc(0), {
      compress: false
    });
  });
}
