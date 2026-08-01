import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { decodeAudioTimeline } from "./container.mjs";
import { ticksToAudioSamples } from "./audio-run.mjs";

const OGG_POLYNOMIAL = 0x04c11db7;
const OGG_SERIAL = 0x56363401;

function assertInteger(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is out of range`);
  }
}

function oggCrc(input) {
  const bytes = Buffer.from(input);
  let crc = 0;
  for (const byte of bytes) {
    crc = (crc ^ (byte << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = ((crc << 1) ^ ((crc & 0x80000000) ? OGG_POLYNOMIAL : 0)) >>> 0;
    }
  }
  return crc >>> 0;
}

function lacingValues(packetLength) {
  assertInteger(packetLength, "Ogg packet length", 0, 65_025);
  const values = [];
  let remaining = packetLength;
  while (remaining >= 255) {
    values.push(255);
    remaining -= 255;
  }
  values.push(remaining);
  if (values.length > 255) throw new RangeError("Ogg packet requires too many segments");
  return values;
}

function buildOggPage(packetInput, options) {
  const packet = Buffer.from(packetInput);
  const lacing = lacingValues(packet.length);
  const header = Buffer.alloc(27 + lacing.length);
  header.write("OggS", 0, 4, "ascii");
  header[4] = 0;
  header[5] = options.headerType;
  header.writeBigInt64LE(BigInt(options.granulePosition), 6);
  header.writeUInt32LE(options.serial, 14);
  header.writeUInt32LE(options.sequence, 18);
  header.writeUInt32LE(0, 22);
  header[26] = lacing.length;
  Buffer.from(lacing).copy(header, 27);
  const page = Buffer.concat([header, packet]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

function opusHead(run) {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, 8, "ascii");
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(run.preSkip, 10);
  head.writeUInt32LE(48_000, 12);
  head.writeInt16LE(0, 16);
  head[18] = 0;
  return head;
}

function opusTags() {
  const vendor = Buffer.from("V64", "utf8");
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
  tags.write("OpusTags", 0, 8, "ascii");
  tags.writeUInt32LE(vendor.length, 8);
  vendor.copy(tags, 12);
  tags.writeUInt32LE(0, 12 + vendor.length);
  return tags;
}

export function buildOggOpusFromAurn(run) {
  if (!run || !Array.isArray(run.packets) || !run.packets.length ||
      !Array.isArray(run.packetSamples) ||
      run.packetSamples.length !== run.packets.length) {
    throw new TypeError("Decoded AURN run is required");
  }
  const pages = [];
  let sequence = 0;
  pages.push(buildOggPage(opusHead(run), {
    headerType: 0x02,
    granulePosition: 0,
    serial: OGG_SERIAL,
    sequence: sequence++
  }));
  pages.push(buildOggPage(opusTags(), {
    headerType: 0,
    granulePosition: 0,
    serial: OGG_SERIAL,
    sequence: sequence++
  }));

  let decodedSamples = 0;
  for (let index = 0; index < run.packets.length; index += 1) {
    decodedSamples += run.packetSamples[index];
    const final = index === run.packets.length - 1;
    const granulePosition = final
      ? run.decodedSamples - run.endTrim
      : decodedSamples;
    pages.push(buildOggPage(run.packets[index], {
      headerType: final ? 0x04 : 0,
      granulePosition,
      serial: OGG_SERIAL,
      sequence: sequence++
    }));
  }
  return Buffer.concat(pages);
}

export function decodeAurnRunToPcm(run, options = {}) {
  const ogg = buildOggOpusFromAurn(run);
  const result = spawnSync(options.ffmpegPath || "ffmpeg", [
    "-v", "error",
    "-c:a", options.opusDecoder || "libopus",
    "-f", "ogg", "-i", "pipe:0",
    "-map_metadata", "-1", "-vn", "-ac", "1", "-ar", "48000",
    "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"
  ], {
    input: ogg,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw new Error(`ffmpeg could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg libopus decode failed (${result.status}): ${result.stderr.toString("utf8").trim()}`
    );
  }
  const pcm = Buffer.from(result.stdout);
  if (pcm.length !== run.keptSamples * 2) {
    throw new Error(
      `Decoded AURN PCM length ${pcm.length} disagrees with ${run.keptSamples} kept samples`
    );
  }
  return {
    pcm,
    samples: run.keptSamples,
    sha256: createHash("sha256").update(pcm).digest("hex"),
    oggBytes: ogg.length
  };
}

export function decodeAudioTimelineToPcm(demuxed, options = {}) {
  const audio = decodeAudioTimeline(demuxed);
  if (!audio) return null;
  const totalSamples = ticksToAudioSamples(demuxed.header.duration);
  const pcm = Buffer.alloc(totalSamples * 2);
  const runs = [];
  for (const item of audio.timeline) {
    if (item.type !== "AURN") continue;
    const decoded = decodeAurnRunToPcm(item, options);
    decoded.pcm.copy(pcm, item.startSample * 2);
    runs.push({
      timestamp: item.timestamp,
      duration: item.duration,
      startSample: item.startSample,
      endSample: item.endSample,
      samples: decoded.samples,
      sha256: decoded.sha256,
      oggBytes: decoded.oggBytes
    });
  }
  return {
    pcm,
    samples: totalSamples,
    sha256: createHash("sha256").update(pcm).digest("hex"),
    runs,
    silenceSpans: audio.silenceSpans.map((span) => ({
      timestamp: span.timestamp,
      duration: span.duration,
      startSample: ticksToAudioSamples(span.timestamp),
      endSample: ticksToAudioSamples(span.timestamp + span.duration)
    }))
  };
}

export function decodeAudioWindowToPcm(demuxed, startTick, endTick, options = {}) {
  assertInteger(startTick, "Audio seek start", 0, demuxed.header.duration);
  assertInteger(endTick, "Audio seek end", startTick + 1, demuxed.header.duration);
  const startSample = ticksToAudioSamples(startTick);
  const endSample = ticksToAudioSamples(endTick);
  const audio = decodeAudioTimeline(demuxed);
  if (!audio) return null;
  const pcm = Buffer.alloc((endSample - startSample) * 2);
  for (const item of audio.runs) {
    const overlapStart = Math.max(startSample, item.startSample);
    const overlapEnd = Math.min(endSample, item.endSample);
    if (overlapStart >= overlapEnd) continue;
    const decoded = decodeAurnRunToPcm(item, options).pcm;
    decoded.copy(
      pcm,
      (overlapStart - startSample) * 2,
      (overlapStart - item.startSample) * 2,
      (overlapEnd - item.startSample) * 2
    );
  }
  return {
    startTick,
    endTick,
    startSample,
    endSample,
    pcm,
    sha256: createHash("sha256").update(pcm).digest("hex")
  };
}

export const OGG_OPUS_WRAPPER = Object.freeze({
  serial: OGG_SERIAL,
  vendor: "V64",
  sampleRate: 48000,
  channels: 1,
  decoder: "libopus"
});
