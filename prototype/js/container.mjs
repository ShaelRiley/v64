import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  CADENCES, CHUNK_HEADER_SIZE, HEADER_SIZE, LIMITS, MAGIC, TICK_RATE,
  cadenceFromId, paletteDepthFromId
} from "./constants.mjs";
import { GLYPH_HASH, PALETTE_HASH } from "./assets.mjs";
import { applyFrameCommands, encodeFrameCommands } from "./commands.mjs";
import { crc32 } from "./crc32.mjs";

const KNOWN_CHUNKS = new Set(["VFRM", "RPTF", "SILN", "PLIT", "META", "INDX"]);
const FLAG_CRC = 1;
const FLAG_DEFLATE = 2;

function checkedNumber(value, label) {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} exceeds JavaScript safe integer range`);
    return Number(value);
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
  return value;
}

function validateType(type) {
  if (!/^[\x21-\x7e]{4}$/.test(type)) throw new Error(`Invalid chunk type "${type}"`);
}

export function makeChunk(type, timestamp, duration, payload = Buffer.alloc(0), options = {}) {
  validateType(type);
  const body = Buffer.from(payload);
  if (body.length > LIMITS.maxInflatedChunk) throw new RangeError("Chunk payload exceeds inflated limit");
  return {
    type,
    timestamp: checkedNumber(timestamp, "Chunk timestamp"),
    duration: checkedNumber(duration, "Chunk duration"),
    payload: body,
    compress: options.compress ?? true,
    keyframe: Boolean(options.keyframe)
  };
}

function serializeChunk(chunk) {
  let stored = chunk.payload;
  let flags = FLAG_CRC;
  if (chunk.compress && chunk.payload.length >= 32) {
    const compressed = deflateRawSync(chunk.payload, { level: 9 });
    if (compressed.length + 8 < chunk.payload.length) {
      stored = compressed;
      flags |= FLAG_DEFLATE;
    }
  }
  if (stored.length > LIMITS.maxStoredChunk) throw new RangeError("Stored chunk exceeds limit");
  const header = Buffer.alloc(CHUNK_HEADER_SIZE);
  header.write(chunk.type, 0, 4, "ascii");
  header.writeUInt32LE(flags, 4);
  header.writeBigUInt64LE(BigInt(chunk.timestamp), 8);
  header.writeBigUInt64LE(BigInt(chunk.duration), 16);
  header.writeUInt32LE(stored.length, 24);
  header.writeUInt32LE(crc32(stored), 28);
  return { buffer: Buffer.concat([header, stored]), storedLength: stored.length, flags };
}

function buildIndexPayload(entries) {
  const payload = Buffer.alloc(4 + entries.length * 20);
  payload.writeUInt32LE(entries.length, 0);
  let offset = 4;
  for (const entry of entries) {
    payload.writeBigUInt64LE(BigInt(entry.timestamp), offset);
    payload.writeBigUInt64LE(BigInt(entry.offset), offset + 8);
    payload.writeUInt32LE(entry.keyframe ? 1 : 0, offset + 16);
    offset += 20;
  }
  return payload;
}

export function muxV64(config, mediaChunks) {
  const { columns, rows, cadenceId, paletteDepthId } = config;
  const cadence = cadenceFromId(cadenceId);
  const { depth } = paletteDepthFromId(paletteDepthId);
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 ||
      columns > LIMITS.maxColumns || rows > LIMITS.maxRows || columns * rows > LIMITS.maxCells) {
    throw new RangeError("Grid exceeds V64 proof profile");
  }
  if (mediaChunks.length + 1 > LIMITS.maxChunks) throw new RangeError("Too many chunks");

  const serialized = mediaChunks.map(serializeChunk);
  let fileOffset = HEADER_SIZE;
  const indexEntries = [];
  for (let index = 0; index < mediaChunks.length; index += 1) {
    const chunk = mediaChunks[index];
    if (chunk.type === "VFRM" && chunk.keyframe) {
      indexEntries.push({ timestamp: chunk.timestamp, offset: fileOffset, keyframe: true });
    }
    fileOffset += serialized[index].buffer.length;
  }
  const indexOffset = fileOffset;
  const indexChunk = makeChunk("INDX", 0, 0, buildIndexPayload(indexEntries), { compress: false });
  const serializedIndex = serializeChunk(indexChunk);
  const allSerialized = [...serialized, serializedIndex];
  const duration = mediaChunks.reduce((maximum, chunk) => Math.max(maximum, chunk.timestamp + chunk.duration), 0);
  const maximumStored = allSerialized.reduce((maximum, chunk) => Math.max(maximum, chunk.storedLength), 0);

  let featureFlags = 1 | 8 | 16;
  if (mediaChunks.some((chunk) => chunk.type === "SILN")) featureFlags |= 2;
  if (mediaChunks.some((chunk) => chunk.type === "PLIT")) featureFlags |= 4;
  if (allSerialized.some((chunk) => chunk.flags & FLAG_DEFLATE)) featureFlags |= 32;

  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header[8] = 0;
  header[9] = 1;
  header.writeUInt16LE(HEADER_SIZE, 10);
  header.writeUInt32LE(featureFlags, 12);
  header.writeUInt16LE(columns, 16);
  header.writeUInt16LE(rows, 18);
  header[20] = cadence.id;
  header[21] = paletteDepthId;
  header[22] = 0;
  header[23] = 0;
  header.writeUInt32LE(TICK_RATE, 24);
  header.writeBigUInt64LE(BigInt(duration), 28);
  GLYPH_HASH.copy(header, 36);
  PALETTE_HASH.copy(header, 68);
  header.writeBigUInt64LE(BigInt(indexOffset), 100);
  header.writeUInt32LE(serializedIndex.buffer.length, 108);
  header.writeUInt32LE(allSerialized.length, 112);
  header.writeUInt32LE(maximumStored, 116);
  header.writeUInt32LE(1, 120);
  header.writeUInt32LE(1, 124);

  return Buffer.concat([header, ...allSerialized.map((entry) => entry.buffer)]);
}

function parseHeader(file, options) {
  if (file.length < HEADER_SIZE) throw new Error("Truncated V64 header");
  if (!file.subarray(0, 8).equals(MAGIC)) throw new Error("V64 magic mismatch");
  if (file[8] !== 0 || file[9] !== 1) throw new Error(`Unsupported V64 version ${file[8]}.${file[9]}`);
  if (file.readUInt16LE(10) !== HEADER_SIZE) throw new Error("Unsupported V64 header size");
  const featureFlags = file.readUInt32LE(12);
  if (featureFlags & ~0x3f) throw new Error("Unknown mandatory header feature bits");
  const columns = file.readUInt16LE(16);
  const rows = file.readUInt16LE(18);
  if (!columns || !rows || columns > LIMITS.maxColumns || rows > LIMITS.maxRows || columns * rows > LIMITS.maxCells) {
    throw new Error("Invalid or oversized V64 grid");
  }
  const cadence = cadenceFromId(file[20]);
  const palette = paletteDepthFromId(file[21]);
  if (file[22] !== 0) throw new Error("Unsupported mandatory glyph coding mode");
  if (file[23] !== 0) throw new Error("Nonzero reserved header byte");
  if (file.readUInt32LE(24) !== TICK_RATE) throw new Error("Unsupported timeline tick rate");
  const duration = checkedNumber(file.readBigUInt64LE(28), "Duration");
  const glyphHash = file.subarray(36, 68);
  const paletteHash = file.subarray(68, 100);
  if (!options?.allowUnknownAssets && !glyphHash.equals(GLYPH_HASH)) throw new Error("Canonical glyph asset hash mismatch");
  if (!options?.allowUnknownAssets && !paletteHash.equals(PALETTE_HASH)) throw new Error("Master palette asset hash mismatch");
  const indexOffset = checkedNumber(file.readBigUInt64LE(100), "Index offset");
  const indexLength = file.readUInt32LE(108);
  const chunkCount = file.readUInt32LE(112);
  const maximumStored = file.readUInt32LE(116);
  if (!chunkCount || chunkCount > LIMITS.maxChunks) throw new Error("Invalid chunk count");
  if (maximumStored > LIMITS.maxStoredChunk) throw new Error("Declared maximum chunk exceeds decoder limit");
  if (file.readUInt32LE(120) !== 1 || file.readUInt32LE(124) !== 1) throw new Error("Unsupported mandatory asset identifier");
  if (indexOffset < HEADER_SIZE || indexOffset + indexLength > file.length) throw new Error("Index range lies outside file");
  return {
    version: "0.1", featureFlags, columns, rows, cadence, paletteDepth: palette.depth,
    paletteDepthId: palette.id, duration, glyphHash: glyphHash.toString("hex"),
    paletteHash: paletteHash.toString("hex"), indexOffset, indexLength, chunkCount, maximumStored
  };
}

function parseIndex(payload) {
  if (payload.length < 4) throw new Error("Truncated index");
  const count = payload.readUInt32LE(0);
  if (payload.length !== 4 + count * 20) throw new Error("Index payload length mismatch");
  const entries = [];
  let offset = 4;
  for (let index = 0; index < count; index += 1) {
    const timestamp = checkedNumber(payload.readBigUInt64LE(offset), "Index timestamp");
    const fileOffset = checkedNumber(payload.readBigUInt64LE(offset + 8), "Indexed file offset");
    const flags = payload.readUInt32LE(offset + 16);
    if (flags & ~1) throw new Error("Unknown index flags");
    entries.push({ timestamp, offset: fileOffset, keyframe: Boolean(flags & 1) });
    offset += 20;
  }
  return entries;
}

export function demuxV64(input, options = {}) {
  const file = Buffer.from(input);
  const header = parseHeader(file, options);
  const chunks = [];
  let offset = HEADER_SIZE;
  for (let count = 0; count < header.chunkCount; count += 1) {
    if (offset + CHUNK_HEADER_SIZE > file.length) throw new Error("Truncated chunk header");
    const startOffset = offset;
    const type = file.toString("ascii", offset, offset + 4);
    validateType(type);
    const flags = file.readUInt32LE(offset + 4);
    if (flags & ~(FLAG_CRC | FLAG_DEFLATE)) throw new Error(`Unknown mandatory flags on ${type}`);
    const timestamp = checkedNumber(file.readBigUInt64LE(offset + 8), "Chunk timestamp");
    const duration = checkedNumber(file.readBigUInt64LE(offset + 16), "Chunk duration");
    const storedLength = file.readUInt32LE(offset + 24);
    const expectedCrc = file.readUInt32LE(offset + 28);
    if (storedLength > LIMITS.maxStoredChunk || offset + CHUNK_HEADER_SIZE + storedLength > file.length) {
      throw new Error(`Truncated or oversized ${type} payload`);
    }
    const stored = file.subarray(offset + CHUNK_HEADER_SIZE, offset + CHUNK_HEADER_SIZE + storedLength);
    if ((flags & FLAG_CRC) && crc32(stored) !== expectedCrc) throw new Error(`${type} CRC mismatch`);
    let payload = stored;
    if (flags & FLAG_DEFLATE) {
      try {
        payload = inflateRawSync(stored, { maxOutputLength: LIMITS.maxInflatedChunk });
      } catch (error) {
        throw new Error(`Invalid or excessive compressed ${type} payload: ${error.message}`);
      }
    }
    if (!KNOWN_CHUNKS.has(type)) {
      if (type === type.toUpperCase()) throw new Error(`Unknown mandatory chunk ${type}`);
    } else {
      chunks.push({ type, flags, timestamp, duration, payload: Buffer.from(payload), offset: startOffset, storedLength });
    }
    offset += CHUNK_HEADER_SIZE + storedLength;
  }
  if (offset !== file.length) throw new Error("Trailing bytes after declared chunks");
  const indexChunks = chunks.filter((chunk) => chunk.type === "INDX");
  if (indexChunks.length !== 1 || indexChunks[0].offset !== header.indexOffset ||
      CHUNK_HEADER_SIZE + indexChunks[0].storedLength !== header.indexLength) throw new Error("Header/index disagreement");
  const index = parseIndex(indexChunks[0].payload);
  for (const entry of index) {
    const target = chunks.find((chunk) => chunk.offset === entry.offset);
    if (!target || target.type !== "VFRM" || target.payload[0] !== 0 || !entry.keyframe) throw new Error("Index entry does not reference a keyframe");
    if (target.timestamp !== entry.timestamp) throw new Error("Index timestamp disagreement");
  }
  return { header, chunks, index };
}

function statesEqual(a, b) {
  return a?.length === b?.length && a.equals ? a.equals(b) : a?.every((value, index) => value === b[index]);
}

export function encodeCellTimeline(frames, config) {
  if (!frames.length) throw new Error("Cannot encode an empty frame sequence");
  const cadence = cadenceFromId(config.cadenceId);
  const paletteDepth = paletteDepthFromId(config.paletteDepthId).depth;
  const keyframeInterval = Math.max(1, Number(config.keyframeInterval || 120));
  const chunks = [];
  let prior = null;
  let timestamp = 0;
  let framesSinceKey = keyframeInterval;
  let pendingRepeat = null;
  const flushRepeat = () => {
    if (pendingRepeat) {
      chunks.push(makeChunk("RPTF", pendingRepeat.timestamp, pendingRepeat.duration, Buffer.alloc(0), { compress: false }));
      pendingRepeat = null;
    }
  };
  for (let index = 0; index < frames.length; index += 1) {
    const frame = Buffer.from(frames[index]);
    const keyframe = !prior || framesSinceKey >= keyframeInterval;
    if (!keyframe && statesEqual(frame, prior)) {
      if (pendingRepeat && pendingRepeat.timestamp + pendingRepeat.duration === timestamp) pendingRepeat.duration += cadence.frameTicks;
      else {
        flushRepeat();
        pendingRepeat = { timestamp, duration: cadence.frameTicks };
      }
      timestamp += cadence.frameTicks;
      framesSinceKey += 1;
      continue;
    }
    flushRepeat();
    const commands = encodeFrameCommands(frame, prior, {
      columns: config.columns,
      rows: config.rows,
      paletteDepth,
      keyframe,
      useDictionary: config.useDictionary !== false
    });
    const payload = Buffer.concat([Buffer.from([keyframe ? 0 : 1]), commands]);
    chunks.push(makeChunk("VFRM", timestamp, cadence.frameTicks, payload, { keyframe }));
    prior = frame;
    timestamp += cadence.frameTicks;
    framesSinceKey = keyframe ? 1 : framesSinceKey + 1;
  }
  flushRepeat();
  return chunks;
}

export function decodeVideoTimeline(demuxed) {
  const { columns, rows, paletteDepth, cadence } = demuxed.header;
  const timeline = [];
  let state = null;
  let expectedTimestamp = 0;
  for (const chunk of demuxed.chunks) {
    if (chunk.type !== "VFRM" && chunk.type !== "RPTF") continue;
    if (chunk.timestamp !== expectedTimestamp) throw new Error(`Discontinuous video timeline at ${chunk.timestamp}; expected ${expectedTimestamp}`);
    if (!chunk.duration || chunk.duration % cadence.frameTicks) throw new Error(`${chunk.type} duration is not a whole nominal frame span`);
    if (chunk.type === "VFRM") {
      if (!chunk.payload.length || (chunk.payload[0] !== 0 && chunk.payload[0] !== 1)) throw new Error("Invalid VFRM kind");
      const keyframe = chunk.payload[0] === 0;
      state = applyFrameCommands(chunk.payload.subarray(1), state, { columns, rows, paletteDepth, keyframe });
      timeline.push({ timestamp: chunk.timestamp, duration: chunk.duration, keyframe, repeat: false, state: Buffer.from(state) });
    } else {
      if (chunk.payload.length) throw new Error("RPTF payload must be empty");
      if (!state) throw new Error("Repeat frame precedes first video frame");
      timeline.push({ timestamp: chunk.timestamp, duration: chunk.duration, keyframe: false, repeat: true, state: Buffer.from(state) });
    }
    expectedTimestamp += chunk.duration;
  }
  if (!timeline.length) throw new Error("File contains no video timeline");
  return timeline;
}

export function encodeParticleEvents(events) {
  if (!Array.isArray(events) || events.length > LIMITS.maxParticleEvents) throw new RangeError("Particle event count exceeds bound");
  const payload = Buffer.alloc(1 + events.length * 20);
  payload[0] = events.length;
  let offset = 1;
  for (const event of events) {
    if (!Number.isInteger(event.classId) || event.classId < 0 || event.classId > 5) throw new RangeError("Unknown particle class");
    payload[offset] = event.classId;
    payload[offset + 1] = event.color;
    payload.writeUInt16LE(event.x, offset + 2);
    payload.writeUInt16LE(event.y, offset + 4);
    payload[offset + 6] = event.intensity;
    payload[offset + 7] = event.radius;
    payload.writeUInt32LE(event.lifetimeTicks, offset + 8);
    payload.writeInt16LE(event.direction, offset + 12);
    payload.writeUInt16LE(event.spread, offset + 14);
    payload.writeUInt32LE(event.seed, offset + 16);
    offset += 20;
  }
  return payload;
}

export function decodeParticleEvents(payload, paletteDepth) {
  if (!payload.length) throw new Error("Truncated PLIT payload");
  const count = payload[0];
  if (count > LIMITS.maxParticleEvents || payload.length !== 1 + count * 20) throw new Error("Malformed PLIT event count");
  const events = [];
  for (let offset = 1; offset < payload.length; offset += 20) {
    const event = {
      classId: payload[offset], color: payload[offset + 1],
      x: payload.readUInt16LE(offset + 2), y: payload.readUInt16LE(offset + 4),
      intensity: payload[offset + 6], radius: payload[offset + 7],
      lifetimeTicks: payload.readUInt32LE(offset + 8), direction: payload.readInt16LE(offset + 12),
      spread: payload.readUInt16LE(offset + 14), seed: payload.readUInt32LE(offset + 16)
    };
    if (event.classId > 5 || event.color >= paletteDepth) throw new Error("Invalid particle event reference");
    events.push(event);
  }
  return events;
}

export function verifyV64(input) {
  const demuxed = demuxV64(input);
  const timeline = decodeVideoTimeline(demuxed);
  for (const chunk of demuxed.chunks) {
    if (chunk.type === "SILN" && (chunk.payload.length || !chunk.duration)) throw new Error("Malformed explicit-silence chunk");
    if (chunk.type === "PLIT") decodeParticleEvents(chunk.payload, demuxed.header.paletteDepth);
  }
  const last = timeline[timeline.length - 1];
  const videoDuration = last.timestamp + last.duration;
  if (videoDuration > demuxed.header.duration) throw new Error("Video timeline exceeds declared duration");
  return {
    valid: true,
    frames: timeline.reduce((count, item) => count + item.duration / demuxed.header.cadence.frameTicks, 0),
    keyframes: timeline.filter((item) => item.keyframe).length,
    repeatSpans: timeline.filter((item) => item.repeat).length,
    chunks: demuxed.chunks.length,
    durationTicks: demuxed.header.duration
  };
}

export function cadenceRational(cadence) {
  return `${cadence.numerator}/${cadence.denominator}`;
}

export { CADENCES };
