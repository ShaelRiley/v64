import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  decodePcm16Wav,
  encodePcm16Wav,
  sampleIndexToTicks
} from "./audio-am1.mjs";
import { opusPacketSamples } from "./opus-packet.mjs";

export { opusPacketSamples } from "./opus-packet.mjs";

function assertInteger(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
}

function packetStreamBytes(packets) {
  const parts = [];
  for (const packet of packets) {
    if (packet.length > 1275) throw new Error("Opus packet exceeds standard maximum");
    const length = Buffer.alloc(2);
    length.writeUInt16LE(packet.length);
    parts.push(length, packet);
  }
  return Buffer.concat(parts);
}

export function parseOggOpus(input) {
  const bytes = Buffer.from(input);
  let offset = 0;
  let serial = null;
  let sequence = -1;
  let pending = [];
  const packets = [];
  let finalGranule = null;
  let sawBeginning = false;
  let sawEnd = false;

  while (offset < bytes.length) {
    if (bytes.length - offset < 27 ||
        bytes.toString("ascii", offset, offset + 4) !== "OggS") {
      throw new Error("Invalid Ogg page header");
    }
    if (bytes[offset + 4] !== 0) throw new Error("Unsupported Ogg bitstream version");
    const headerType = bytes[offset + 5];
    const granule = bytes.readBigInt64LE(offset + 6);
    const pageSerial = bytes.readUInt32LE(offset + 14);
    const pageSequence = bytes.readUInt32LE(offset + 18);
    const segmentCount = bytes[offset + 26];
    const segmentStart = offset + 27;
    const bodyStart = segmentStart + segmentCount;
    if (bodyStart > bytes.length) throw new Error("Truncated Ogg segment table");
    let bodyBytes = 0;
    for (let index = 0; index < segmentCount; index += 1) {
      bodyBytes += bytes[segmentStart + index];
    }
    if (bodyStart + bodyBytes > bytes.length) throw new Error("Truncated Ogg page body");

    if (serial === null) serial = pageSerial;
    else if (pageSerial !== serial) {
      throw new Error("Multiple Ogg logical streams are unsupported");
    }
    if (pageSequence !== sequence + 1) throw new Error("Discontinuous Ogg page sequence");
    sequence = pageSequence;
    const continued = Boolean(headerType & 0x01);
    if (continued !== Boolean(pending.length)) {
      throw new Error("Invalid Ogg packet continuation state");
    }
    if (headerType & 0x02) {
      if (sawBeginning || pageSequence !== 0) {
        throw new Error("Invalid Ogg beginning-of-stream page");
      }
      sawBeginning = true;
    }
    if (headerType & 0x04) {
      if (sawEnd) throw new Error("Duplicate Ogg end-of-stream page");
      sawEnd = true;
      if (granule < 0n) throw new Error("Missing final Opus granule position");
      finalGranule = granule;
    }

    let bodyOffset = bodyStart;
    for (let index = 0; index < segmentCount; index += 1) {
      const length = bytes[segmentStart + index];
      pending.push(bytes.subarray(bodyOffset, bodyOffset + length));
      bodyOffset += length;
      if (length < 255) {
        packets.push(Buffer.concat(pending));
        pending = [];
      }
    }
    offset = bodyStart + bodyBytes;
  }

  if (offset !== bytes.length || pending.length || !sawBeginning || !sawEnd ||
      finalGranule === null) {
    throw new Error("Incomplete Ogg Opus stream");
  }
  if (packets.length < 3 || packets[0].toString("ascii", 0, 8) !== "OpusHead" ||
      packets[1].toString("ascii", 0, 8) !== "OpusTags") {
    throw new Error("Ogg stream is missing Opus headers");
  }
  const head = packets[0];
  if (head.length < 19 || head[8] !== 1 || head[9] !== 1 || head[18] !== 0) {
    throw new Error("Unsupported OpusHead profile");
  }
  const preSkip = head.readUInt16LE(10);
  const inputSampleRate = head.readUInt32LE(12);
  const outputGain = head.readInt16LE(16);
  const audioPackets = packets.slice(2).map((packet) => Buffer.from(packet));
  const packetSamples = audioPackets.map(opusPacketSamples);
  const decodedSamples = packetSamples.reduce((sum, count) => sum + count, 0);
  const granuleSamples = Number(finalGranule);
  if (!Number.isSafeInteger(granuleSamples) || granuleSamples < preSkip ||
      granuleSamples > decodedSamples) {
    throw new Error("Invalid Opus granule accounting");
  }
  const endTrim = decodedSamples - granuleSamples;
  const keptSamples = granuleSamples - preSkip;
  const streamBytes = packetStreamBytes(audioPackets);
  return {
    channels: 1,
    preSkip,
    inputSampleRate,
    outputGain,
    packets: audioPackets,
    packetSamples,
    decodedSamples,
    endTrim,
    keptSamples,
    finalGranule: granuleSamples,
    packetStreamBytes: streamBytes,
    packetStreamSha256: createHash("sha256").update(streamBytes).digest("hex")
  };
}

export function encodeAm1OpusOgg(wavInput, options = {}) {
  const wav = Buffer.from(wavInput);
  const decoded = decodePcm16Wav(wav);
  if (decoded.channels !== 1 || decoded.sampleRate !== 48000) {
    throw new Error("AM1 Opus input must be mono 48 kHz PCM16 WAV");
  }
  const bitrateKbps = Number(options.bitrateKbps ?? 8);
  const frameDurationMs = Number(options.frameDurationMs ?? 20);
  if (!Number.isInteger(bitrateKbps) || bitrateKbps < 4 || bitrateKbps > 16 ||
      ![20, 40].includes(frameDurationMs)) {
    throw new RangeError("Invalid AM1 Opus options");
  }
  const result = spawnSync(options.ffmpegPath || "ffmpeg", [
    "-v", "error",
    "-f", "wav", "-i", "pipe:0",
    "-map_metadata", "-1", "-vn", "-ac", "1", "-ar", "48000",
    "-c:a", "libopus", "-application", "voip",
    "-b:a", `${bitrateKbps}k`, "-vbr", "constrained",
    "-frame_duration", String(frameDurationMs),
    "-compression_level", "10", "-packet_loss", "0", "-fec", "0",
    "-serial_offset", "0", "-f", "ogg", "pipe:1"
  ], {
    input: wav,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw new Error(`ffmpeg could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg libopus failed (${result.status}): ${result.stderr.toString("utf8").trim()}`
    );
  }
  const ogg = Buffer.from(result.stdout);
  const parsed = parseOggOpus(ogg);
  if (parsed.keptSamples !== decoded.samples.length) {
    throw new Error("Opus run does not preserve the exact input sample count");
  }
  return { ogg, ...parsed, bitrateKbps, frameDurationMs };
}

export function nonSilenceSpans(totalSamples, silenceSpans) {
  assertInteger(totalSamples, "Audio sample count", 0);
  if (!Array.isArray(silenceSpans)) throw new TypeError("Silence spans must be an array");
  const output = [];
  let cursor = 0;
  for (const span of silenceSpans) {
    assertInteger(span?.startSample, "Silence start sample", cursor, totalSamples);
    assertInteger(span?.endSample, "Silence end sample", span.startSample + 1, totalSamples);
    if (span.startSample > cursor) {
      output.push({ startSample: cursor, endSample: span.startSample });
    }
    cursor = span.endSample;
  }
  if (cursor < totalSamples) output.push({ startSample: cursor, endSample: totalSamples });
  return output;
}

export function encodeSegmentedAm1Runs(samplesInput, sampleRate, silenceSpans, options = {}) {
  if (sampleRate !== 48000) throw new Error("Segmented AM1 currently requires 48 kHz PCM");
  const samples = samplesInput instanceof Int16Array
    ? samplesInput
    : Int16Array.from(samplesInput || []);
  const spans = nonSilenceSpans(samples.length, silenceSpans);
  return spans.map((span) => {
    const wav = encodePcm16Wav(
      samples.slice(span.startSample, span.endSample),
      sampleRate,
      1
    );
    const encoded = encodeAm1OpusOgg(wav, options);
    return {
      startSample: span.startSample,
      endSample: span.endSample,
      timestamp: sampleIndexToTicks(span.startSample, sampleRate),
      duration: sampleIndexToTicks(span.endSample, sampleRate) -
        sampleIndexToTicks(span.startSample, sampleRate),
      preSkip: encoded.preSkip,
      endTrim: encoded.endTrim,
      keptSamples: encoded.keptSamples,
      decodedSamples: encoded.decodedSamples,
      packets: encoded.packets,
      packetSamples: encoded.packetSamples,
      packetStreamBytes: encoded.packetStreamBytes,
      packetStreamSha256: encoded.packetStreamSha256,
      ogg: encoded.ogg
    };
  });
}
