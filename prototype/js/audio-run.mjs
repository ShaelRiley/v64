import { TICK_RATE } from "./constants.mjs";
import { opusPacketSamples } from "./opus-packet.mjs";

const AURN_VERSION = 1;
const AURN_HEADER_BYTES = 32;
const AURN_DESCRIPTOR_BYTES = 4;
const AURN_SAMPLE_RATE = 48_000;
const AURN_CHANNELS = 1;
const MAX_PACKET_COUNT = 65_535;
const MAX_PACKET_BYTES = 1_275;

function assertInteger(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
}

function samplesToTicks(samples) {
  assertInteger(samples, "AURN sample count", 0, 0xffffffff);
  const numerator = samples * TICK_RATE;
  if (!Number.isSafeInteger(numerator) || numerator % AURN_SAMPLE_RATE) {
    throw new RangeError("AURN sample count is not exactly representable on the V64 timeline");
  }
  return numerator / AURN_SAMPLE_RATE;
}

export function ticksToAudioSamples(ticks) {
  assertInteger(ticks, "AURN timeline ticks", 0);
  const numerator = ticks * AURN_SAMPLE_RATE;
  if (!Number.isSafeInteger(numerator) || numerator % TICK_RATE) {
    throw new RangeError("AURN timestamp is not aligned to a 48 kHz sample boundary");
  }
  return numerator / TICK_RATE;
}

function normalizeRun(run) {
  if (!run || typeof run !== "object") throw new TypeError("AURN run must be an object");
  const packets = Array.isArray(run.packets)
    ? run.packets.map((packet) => Buffer.from(packet))
    : null;
  if (!packets || !packets.length || packets.length > MAX_PACKET_COUNT) {
    throw new RangeError("AURN packet count is out of range");
  }
  const packetSamples = packets.map((packet, index) => {
    if (!packet.length || packet.length > MAX_PACKET_BYTES) {
      throw new RangeError("AURN Opus packet length is out of range");
    }
    const inferred = opusPacketSamples(packet);
    if (run.packetSamples && run.packetSamples[index] !== inferred) {
      throw new Error("AURN packet duration disagrees with the Opus TOC");
    }
    return inferred;
  });
  if (run.packetSamples && run.packetSamples.length !== packets.length) {
    throw new Error("AURN packet-duration count mismatch");
  }
  const decodedSamples = packetSamples.reduce((sum, count) => sum + count, 0);
  const preSkip = Number(run.preSkip);
  const endTrim = Number(run.endTrim);
  const keptSamples = Number(run.keptSamples);
  assertInteger(preSkip, "AURN pre-skip", 0, 0xffffffff);
  assertInteger(endTrim, "AURN end trim", 0, 0xffffffff);
  assertInteger(keptSamples, "AURN kept samples", 1, 0xffffffff);
  if (run.decodedSamples !== undefined && Number(run.decodedSamples) !== decodedSamples) {
    throw new Error("AURN decoded-sample declaration mismatch");
  }
  if (preSkip + keptSamples + endTrim !== decodedSamples) {
    throw new Error("AURN trim and kept-sample accounting mismatch");
  }
  const packetDataBytes = packets.reduce((sum, packet) => sum + packet.length, 0);
  assertInteger(packetDataBytes, "AURN packet data bytes", 1, 0xffffffff);
  return {
    packets,
    packetSamples,
    preSkip,
    endTrim,
    keptSamples,
    decodedSamples,
    packetDataBytes
  };
}

export function encodeAurnPayload(run) {
  const normalized = normalizeRun(run);
  const descriptorBytes = normalized.packets.length * AURN_DESCRIPTOR_BYTES;
  const output = Buffer.alloc(
    AURN_HEADER_BYTES + descriptorBytes + normalized.packetDataBytes
  );
  output[0] = AURN_VERSION;
  output[1] = AURN_CHANNELS;
  output.writeUInt16LE(0, 2);
  output.writeUInt32LE(AURN_SAMPLE_RATE, 4);
  output.writeUInt32LE(normalized.preSkip, 8);
  output.writeUInt32LE(normalized.endTrim, 12);
  output.writeUInt32LE(normalized.keptSamples, 16);
  output.writeUInt32LE(normalized.decodedSamples, 20);
  output.writeUInt32LE(normalized.packets.length, 24);
  output.writeUInt32LE(normalized.packetDataBytes, 28);

  let descriptorOffset = AURN_HEADER_BYTES;
  let packetOffset = AURN_HEADER_BYTES + descriptorBytes;
  for (let index = 0; index < normalized.packets.length; index += 1) {
    const packet = normalized.packets[index];
    output.writeUInt16LE(packet.length, descriptorOffset);
    output.writeUInt16LE(normalized.packetSamples[index], descriptorOffset + 2);
    packet.copy(output, packetOffset);
    descriptorOffset += AURN_DESCRIPTOR_BYTES;
    packetOffset += packet.length;
  }
  return output;
}

export function decodeAurnPayload(input) {
  const payload = Buffer.from(input);
  if (payload.length < AURN_HEADER_BYTES) throw new Error("Truncated AURN header");
  if (payload[0] !== AURN_VERSION || payload[1] !== AURN_CHANNELS ||
      payload.readUInt16LE(2) !== 0 ||
      payload.readUInt32LE(4) !== AURN_SAMPLE_RATE) {
    throw new Error("Unsupported AURN profile");
  }
  const preSkip = payload.readUInt32LE(8);
  const endTrim = payload.readUInt32LE(12);
  const keptSamples = payload.readUInt32LE(16);
  const decodedSamples = payload.readUInt32LE(20);
  const packetCount = payload.readUInt32LE(24);
  const packetDataBytes = payload.readUInt32LE(28);
  if (!keptSamples || !packetCount || packetCount > MAX_PACKET_COUNT ||
      !packetDataBytes) {
    throw new Error("Invalid AURN counts");
  }
  const descriptorBytes = packetCount * AURN_DESCRIPTOR_BYTES;
  const packetStart = AURN_HEADER_BYTES + descriptorBytes;
  if (!Number.isSafeInteger(packetStart) ||
      packetStart + packetDataBytes !== payload.length) {
    throw new Error("AURN payload-length disagreement");
  }

  const packets = [];
  const packetSamples = [];
  let descriptorOffset = AURN_HEADER_BYTES;
  let packetOffset = packetStart;
  let inferredDecodedSamples = 0;
  for (let index = 0; index < packetCount; index += 1) {
    const length = payload.readUInt16LE(descriptorOffset);
    const declaredSamples = payload.readUInt16LE(descriptorOffset + 2);
    if (!length || length > MAX_PACKET_BYTES || packetOffset + length > payload.length) {
      throw new Error("Invalid AURN packet length");
    }
    const packet = Buffer.from(payload.subarray(packetOffset, packetOffset + length));
    const inferredSamples = opusPacketSamples(packet);
    if (declaredSamples !== inferredSamples) {
      throw new Error("AURN packet duration disagrees with the Opus TOC");
    }
    packets.push(packet);
    packetSamples.push(inferredSamples);
    inferredDecodedSamples += inferredSamples;
    descriptorOffset += AURN_DESCRIPTOR_BYTES;
    packetOffset += length;
  }
  if (packetOffset !== payload.length || inferredDecodedSamples !== decodedSamples) {
    throw new Error("AURN decoded-sample total mismatch");
  }
  if (preSkip + keptSamples + endTrim !== decodedSamples) {
    throw new Error("AURN trim and kept-sample accounting mismatch");
  }
  return {
    version: AURN_VERSION,
    channels: AURN_CHANNELS,
    sampleRate: AURN_SAMPLE_RATE,
    preSkip,
    endTrim,
    keptSamples,
    decodedSamples,
    packets,
    packetSamples,
    packetDataBytes
  };
}

export function validateAurnChunk(chunk) {
  if (!chunk || chunk.type !== "AURN") throw new TypeError("Expected an AURN chunk");
  const run = decodeAurnPayload(chunk.payload);
  const expectedDuration = samplesToTicks(run.keptSamples);
  if (chunk.duration !== expectedDuration) {
    throw new Error("AURN chunk duration disagrees with kept samples");
  }
  const startSample = ticksToAudioSamples(chunk.timestamp);
  return {
    ...run,
    timestamp: chunk.timestamp,
    duration: chunk.duration,
    startSample,
    endSample: startSample + run.keptSamples
  };
}

export const AURN_PROFILE = Object.freeze({
  version: AURN_VERSION,
  sampleRate: AURN_SAMPLE_RATE,
  channels: AURN_CHANNELS,
  headerBytes: AURN_HEADER_BYTES,
  descriptorBytes: AURN_DESCRIPTOR_BYTES,
  maximumPacketBytes: MAX_PACKET_BYTES,
  maximumPacketCount: MAX_PACKET_COUNT
});
