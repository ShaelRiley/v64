const MAGIC = [0x56, 0x36, 0x34, 0x00, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_SIZE = 128;
const CHUNK_HEADER_SIZE = 32;
const PALETTE_DEPTHS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 256];
const FRAME_TICKS = [600000, 120000, 60000, 20000, 10000, 5000, 4000, 2500, 2000, 1250, 1000];
const OPCODE = Object.freeze({
  END: 0,
  SKIP: 1,
  LITERAL: 2,
  REPEAT_TOKEN: 3,
  FILL_RECT: 4,
  DEFINE_TOKEN_DICTIONARY: 5,
  DICTIONARY_LITERAL: 6
});

function fail(message) {
  throw new Error(message);
}

function u16(view, offset) {
  return view.getUint16(offset, true);
}

function u32(view, offset) {
  return view.getUint32(offset, true);
}

function u64(view, offset) {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("64-bit value exceeds browser safe integer range");
  }
  return Number(value);
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function clonePlane(plane) {
  return plane.map((entry) => ({ ...entry, mask: new Uint8Array(entry.mask) }));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readVarUint(bytes, state, label = "varuint") {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 5; count += 1) {
    if (state.offset >= bytes.length) fail(`Truncated ${label}`);
    const byte = bytes[state.offset++];
    value += (byte & 0x7f) * multiplier;
    if (!(byte & 0x80)) {
      if (!Number.isSafeInteger(value) || value > 0xffffffff) {
        fail(`Oversized ${label}`);
      }
      return value;
    }
    multiplier *= 128;
  }
  fail(`${label} exceeds five bytes`);
}

export function parseBrowserV64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < HEADER_SIZE ||
      !MAGIC.every((value, index) => bytes[index] === value)) {
    fail("V64 magic mismatch");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[8] !== 0 || bytes[9] !== 1 || u16(view, 10) !== HEADER_SIZE) {
    fail("Unsupported V64 proof header");
  }
  const featureFlags = u32(view, 12);
  if (featureFlags & ~0xff) fail("Unknown mandatory header feature bits");
  const columns = u16(view, 16);
  const rows = u16(view, 18);
  const cadenceId = bytes[20];
  const paletteDepthId = bytes[21];
  const frameTicks = FRAME_TICKS[cadenceId];
  const paletteDepth = PALETTE_DEPTHS[paletteDepthId];
  if (!columns || !rows || !frameTicks || !paletteDepth) {
    fail("Invalid browser V64 profile");
  }
  const duration = u64(view, 28);
  const indexOffset = u64(view, 100);
  const indexLength = u32(view, 108);
  const chunkCount = u32(view, 112);
  const chunks = [];
  let offset = HEADER_SIZE;
  for (let count = 0; count < chunkCount; count += 1) {
    if (offset + CHUNK_HEADER_SIZE > bytes.length) fail("Truncated chunk header");
    const type = ascii(bytes, offset, 4);
    const flags = u32(view, offset + 4);
    if (flags & ~3) fail(`Unknown mandatory flags on ${type}`);
    if (flags & 2) fail("Browser seek fixture must use uncompressed chunks");
    const timestamp = u64(view, offset + 8);
    const chunkDuration = u64(view, offset + 16);
    const storedLength = u32(view, offset + 24);
    const expectedCrc = u32(view, offset + 28);
    const start = offset + CHUNK_HEADER_SIZE;
    const end = start + storedLength;
    if (end > bytes.length) fail(`Truncated ${type} payload`);
    const payload = bytes.slice(start, end);
    if ((flags & 1) && crc32(payload) !== expectedCrc) fail(`${type} CRC mismatch`);
    chunks.push({
      type,
      flags,
      timestamp,
      duration: chunkDuration,
      payload,
      offset,
      storedLength
    });
    offset = end;
  }
  if (offset !== bytes.length) fail("Trailing bytes after declared chunks");
  const indexChunk = chunks.find((chunk) => chunk.type === "INDX");
  if (!indexChunk || indexChunk.offset !== indexOffset ||
      CHUNK_HEADER_SIZE + indexChunk.storedLength !== indexLength) {
    fail("Header/index disagreement");
  }
  const indexView = new DataView(
    indexChunk.payload.buffer,
    indexChunk.payload.byteOffset,
    indexChunk.payload.byteLength
  );
  const indexCount = u32(indexView, 0);
  if (indexChunk.payload.length !== 4 + indexCount * 20) {
    fail("Index payload length mismatch");
  }
  const index = [];
  for (let item = 0, at = 4; item < indexCount; item += 1, at += 20) {
    index.push({
      timestamp: u64(indexView, at),
      offset: u64(indexView, at + 8),
      flags: u32(indexView, at + 16)
    });
  }
  return {
    bytes,
    header: {
      featureFlags,
      columns,
      rows,
      cadenceId,
      frameTicks,
      paletteDepthId,
      paletteDepth,
      duration
    },
    chunks,
    index
  };
}

function decodeFrameCommands(commandBytes, prior, profile, keyframe) {
  const { columns, rows, paletteDepth } = profile;
  const cellCount = columns * rows;
  const state = keyframe
    ? new Uint8Array(cellCount * 3)
    : new Uint8Array(prior || []);
  if (!keyframe && state.length !== cellCount * 3) {
    fail("Delta frame has no valid group-local prior state");
  }
  const touched = keyframe ? new Uint8Array(cellCount) : null;
  const cursorState = { offset: 0 };
  let cursor = 0;
  let dictionary = null;
  const readVar = () => readVarUint(commandBytes, cursorState, "frame varuint");
  const readToken = () => {
    if (cursorState.offset + 3 > commandBytes.length) fail("Truncated cell token");
    const token = commandBytes.slice(cursorState.offset, cursorState.offset + 3);
    cursorState.offset += 3;
    if (token[0] >= 64 || token[1] >= paletteDepth || token[2] >= paletteDepth) {
      fail("Invalid cell token");
    }
    return token;
  };
  const write = (token) => {
    if (cursor >= cellCount) fail("Frame command advances beyond grid");
    state.set(token, cursor * 3);
    if (touched) touched[cursor] = 1;
    cursor += 1;
  };
  let ended = false;
  while (cursorState.offset < commandBytes.length) {
    const opcode = commandBytes[cursorState.offset++];
    if (opcode === OPCODE.END) {
      ended = true;
      break;
    }
    if (opcode === OPCODE.SKIP) {
      const count = readVar();
      if (!count || cursor + count > cellCount) fail("Invalid skip run");
      cursor += count;
    } else if (opcode === OPCODE.LITERAL) {
      const count = readVar();
      if (!count || cursor + count > cellCount) fail("Invalid literal run");
      for (let index = 0; index < count; index += 1) write(readToken());
    } else if (opcode === OPCODE.REPEAT_TOKEN) {
      const count = readVar();
      if (!count || cursor + count > cellCount) fail("Invalid repeated-token run");
      const token = readToken();
      for (let index = 0; index < count; index += 1) write(token);
    } else if (opcode === OPCODE.FILL_RECT) {
      const x = readVar();
      const y = readVar();
      const width = readVar();
      const height = readVar();
      if (!width || !height || x + width > columns || y + height > rows) {
        fail("Rectangle lies outside frame");
      }
      const token = readToken();
      for (let py = y; py < y + height; py += 1) {
        for (let px = x; px < x + width; px += 1) {
          const cell = py * columns + px;
          state.set(token, cell * 3);
          if (touched) touched[cell] = 1;
        }
      }
    } else if (opcode === OPCODE.DEFINE_TOKEN_DICTIONARY) {
      const count = readVar();
      if (!count || count > 64) fail("Invalid token dictionary length");
      dictionary = [];
      for (let index = 0; index < count; index += 1) dictionary.push(readToken());
    } else if (opcode === OPCODE.DICTIONARY_LITERAL) {
      if (!dictionary) fail("Dictionary literal precedes definition");
      const count = readVar();
      if (!count || cursor + count > cellCount ||
          cursorState.offset + count > commandBytes.length) {
        fail("Invalid dictionary literal");
      }
      for (let index = 0; index < count; index += 1) {
        const id = commandBytes[cursorState.offset++];
        if (id >= dictionary.length) fail("Dictionary index out of range");
        write(dictionary[id]);
      }
    } else {
      fail(`Unknown frame opcode ${opcode}`);
    }
  }
  if (!ended || cursorState.offset !== commandBytes.length) {
    fail("Noncanonical frame command stream");
  }
  if (keyframe && touched.some((value) => value === 0)) {
    fail("Keyframe does not define every cell");
  }
  return state;
}

export function seekVideoFrame(parsed, frameIndex) {
  const { frameTicks } = parsed.header;
  const targetTick = frameIndex * frameTicks;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 ||
      targetTick >= parsed.header.duration) {
    fail("Frame seek is out of range");
  }
  const key = parsed.index.filter((entry) => entry.timestamp <= targetTick).at(-1);
  if (!key) fail("No keyframe index precedes seek target");
  const video = parsed.chunks.filter((chunk) =>
    chunk.type === "VFRM" || chunk.type === "RPTF");
  const start = video.findIndex((chunk) => chunk.offset === key.offset);
  if (start < 0 || video[start].type !== "VFRM") {
    fail("Seek index does not reference a browser keyframe");
  }
  let state = null;
  for (let index = start; index < video.length; index += 1) {
    const chunk = video[index];
    if (chunk.timestamp > targetTick) break;
    if (chunk.type === "VFRM") {
      if (!chunk.payload.length ||
          (chunk.payload[0] !== 0 && chunk.payload[0] !== 1)) {
        fail("Invalid VFRM kind");
      }
      const keyframe = chunk.payload[0] === 0;
      if (index === start && !keyframe) {
        fail("Browser seek group must start with a keyframe");
      }
      state = decodeFrameCommands(
        chunk.payload.slice(1),
        state,
        parsed.header,
        keyframe
      );
    } else if (!state || chunk.payload.length) {
      fail("Invalid RPTF state");
    }
    if (targetTick >= chunk.timestamp &&
        targetTick < chunk.timestamp + chunk.duration) {
      return new Uint8Array(state);
    }
  }
  fail("Seek target is not covered by video timeline");
}

function readSm2Entries(bytes, state, count, cellCount, paletteDepth) {
  const entries = [];
  let previousCell = -1;
  for (let index = 0; index < count; index += 1) {
    const delta = readVarUint(bytes, state, "SM2 entry varuint");
    if (delta <= 0) fail("SM2 entry made no progress");
    const cellIndex = previousCell + delta;
    if (cellIndex < 0 || cellIndex >= cellCount || state.offset + 18 > bytes.length) {
      fail("Invalid SM2 entry");
    }
    const foreground = bytes[state.offset++];
    const background = bytes[state.offset++];
    if (foreground >= paletteDepth || background >= paletteDepth) {
      fail("SM2 palette index exceeds depth");
    }
    const mask = bytes.slice(state.offset, state.offset + 16);
    state.offset += 16;
    entries.push({ cellIndex, foreground, background, mask });
    previousCell = cellIndex;
  }
  return entries;
}

export function decodeSm2Sequence(bytes) {
  if (bytes.length < 16 || ascii(bytes, 0, 4) !== "SM2\0") {
    fail("Invalid SM2 header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cellCount = u32(view, 4);
  const frameCount = u32(view, 8);
  const paletteDepth = u16(view, 12);
  if (!cellCount || !frameCount || paletteDepth < 2 || u16(view, 14) !== 0) {
    fail("Invalid SM2 declarations");
  }
  const state = { offset: 16 };
  const frames = [];
  let current = [];
  while (frames.length < frameCount) {
    if (state.offset >= bytes.length) fail("Truncated SM2 command stream");
    const opcode = bytes[state.offset++];
    if (opcode === 0) {
      if (!frames.length) fail("SM2 repeat precedes first plane");
      const span = readVarUint(bytes, state, "SM2 repeat");
      if (!span || frames.length + span > frameCount) {
        fail("Invalid SM2 repeat span");
      }
      for (let index = 0; index < span; index += 1) {
        frames.push(clonePlane(current));
      }
    } else if (opcode === 1) {
      const count = readVarUint(bytes, state, "SM2 full count");
      if (count > cellCount) fail("SM2 full plane exceeds grid");
      current = readSm2Entries(bytes, state, count, cellCount, paletteDepth);
      frames.push(clonePlane(current));
    } else if (opcode === 2) {
      if (!frames.length) fail("SM2 delta precedes first plane");
      const map = new Map(current.map((entry) => [entry.cellIndex, entry]));
      const removals = readVarUint(bytes, state, "SM2 removal count");
      let previousCell = -1;
      for (let index = 0; index < removals; index += 1) {
        const delta = readVarUint(bytes, state, "SM2 removal");
        if (!delta) fail("SM2 removal made no progress");
        const cellIndex = previousCell + delta;
        if (!map.delete(cellIndex)) fail("Invalid SM2 removal");
        previousCell = cellIndex;
      }
      const upserts = readVarUint(bytes, state, "SM2 upsert count");
      for (const entry of readSm2Entries(
        bytes,
        state,
        upserts,
        cellCount,
        paletteDepth
      )) {
        map.set(entry.cellIndex, entry);
      }
      current = [...map.values()].sort((a, b) => a.cellIndex - b.cellIndex);
      frames.push(clonePlane(current));
    } else {
      fail(`Unknown SM2 opcode ${opcode}`);
    }
  }
  if (state.offset !== bytes.length) fail("Trailing SM2 bytes");
  return { cellCount, frameCount, paletteDepth, frames };
}

export function seekSubtitlePlane(parsed, frameIndex) {
  const tick = frameIndex * parsed.header.frameTicks;
  const chunk = parsed.chunks.find((item) =>
    item.type === "SUBT" &&
    tick >= item.timestamp &&
    tick < item.timestamp + item.duration);
  if (!chunk) return [];
  const sequence = decodeSm2Sequence(chunk.payload);
  if (sequence.cellCount !== parsed.header.columns * parsed.header.rows ||
      sequence.paletteDepth !== parsed.header.paletteDepth) {
    fail("SUBT header disagreement");
  }
  const localFrame = (tick - chunk.timestamp) / parsed.header.frameTicks;
  if (!Number.isInteger(localFrame) || localFrame < 0 ||
      localFrame >= sequence.frameCount ||
      sequence.frameCount * parsed.header.frameTicks !== chunk.duration) {
    fail("SUBT timing disagreement");
  }
  return clonePlane(sequence.frames[localFrame]);
}

export function renderComposite(cells, plane, profile, assets) {
  const { columns, rows, paletteDepth } = profile;
  const width = columns * 8;
  const height = rows * 16;
  if (cells.length !== columns * rows * 3 ||
      assets.palette.length < paletteDepth ||
      assets.glyphMasks.length < 64) {
    fail("Browser render asset disagreement");
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let cell = 0; cell < columns * rows; cell += 1) {
    const glyph = cells[cell * 3];
    const foreground = cells[cell * 3 + 1];
    const background = cells[cell * 3 + 2];
    const mask = assets.glyphMasks[glyph];
    if (!mask || foreground >= paletteDepth || background >= paletteDepth) {
      fail("Invalid rendered token");
    }
    const cx = cell % columns;
    const cy = Math.floor(cell / columns);
    for (let py = 0; py < 16; py += 1) {
      for (let px = 0; px < 8; px += 1) {
        const color = assets.palette[
          (mask[py] & (0x80 >> px)) ? foreground : background
        ];
        const at = ((cy * 16 + py) * width + cx * 8 + px) * 4;
        rgba[at] = color[0];
        rgba[at + 1] = color[1];
        rgba[at + 2] = color[2];
        rgba[at + 3] = 255;
      }
    }
  }
  for (const entry of plane) {
    const cx = entry.cellIndex % columns;
    const cy = Math.floor(entry.cellIndex / columns);
    for (let py = 0; py < 16; py += 1) {
      for (let px = 0; px < 8; px += 1) {
        const color = assets.palette[
          (entry.mask[py] & (0x80 >> px))
            ? entry.foreground
            : entry.background
        ];
        const at = ((cy * 16 + py) * width + cx * 8 + px) * 4;
        rgba[at] = color[0];
        rgba[at + 1] = color[1];
        rgba[at + 2] = color[2];
        rgba[at + 3] = 255;
      }
    }
  }
  return { width, height, rgba };
}

export function applyViewportScanlines(image, options = {}) {
  const {
    viewportY = 0,
    strength = 0.18,
    period = 2,
    phase = 1
  } = options;
  if (!Number.isSafeInteger(viewportY) ||
      !Number.isFinite(strength) || strength < 0 || strength > 0.5 ||
      !Number.isInteger(period) || period < 2 || period > 8 ||
      !Number.isInteger(phase) || phase < 0 || phase >= period) {
    fail("Invalid browser scanline profile");
  }
  const rgba = new Uint8Array(image.rgba);
  const multiplier = 1 - strength;
  for (let y = 0; y < image.height; y += 1) {
    const viewportRow = ((viewportY + y) % period + period) % period;
    if (viewportRow !== phase) continue;
    const end = (y + 1) * image.width * 4;
    for (let at = y * image.width * 4; at < end; at += 4) {
      rgba[at] = Math.round(rgba[at] * multiplier);
      rgba[at + 1] = Math.round(rgba[at + 1] * multiplier);
      rgba[at + 2] = Math.round(rgba[at + 2] * multiplier);
    }
  }
  return { width: image.width, height: image.height, rgba };
}

function serializePlane(plane) {
  const bytes = new Uint8Array(plane.length * 22);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const entry of plane) {
    view.setUint32(offset, entry.cellIndex, true);
    offset += 4;
    bytes[offset++] = entry.foreground;
    bytes[offset++] = entry.background;
    bytes.set(entry.mask, offset);
    offset += 16;
  }
  return bytes;
}

export async function sha256(bytes) {
  const source = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function runSeekConformance(v64Bytes, pcmBytes, manifest) {
  const parsed = parseBrowserV64(v64Bytes);
  if (parsed.header.frameTicks !== manifest.profile.frameTicks ||
      parsed.header.duration !== manifest.profile.durationTicks) {
    fail("Manifest/container timeline disagreement");
  }
  const bytesPerFrame = manifest.profile.audioSamplesPerFrame * 2;
  const observed = [];
  const repeated = new Map();
  for (const frameIndex of manifest.seekOrder) {
    const cells = seekVideoFrame(parsed, frameIndex);
    const plane = seekSubtitlePlane(parsed, frameIndex);
    const composite = renderComposite(cells, plane, parsed.header, manifest.assets);
    const scanlined = applyViewportScanlines(composite, manifest.scanlines);
    const audioStart = frameIndex * bytesPerFrame;
    const audio = pcmBytes.slice(audioStart, audioStart + bytesPerFrame);
    if (audio.length !== bytesPerFrame) fail("Audio seek window is truncated");
    const result = {
      frameIndex,
      cellsSha256: await sha256(cells),
      subtitleSha256: await sha256(serializePlane(plane)),
      compositeSha256: await sha256(composite.rgba),
      scanlineSha256: await sha256(scanlined.rgba),
      audioSha256: await sha256(audio)
    };
    const expected = manifest.expected[String(frameIndex)];
    if (!expected) fail(`Missing expected seek frame ${frameIndex}`);
    for (const key of [
      "cellsSha256",
      "subtitleSha256",
      "compositeSha256",
      "scanlineSha256",
      "audioSha256"
    ]) {
      if (result[key] !== expected[key]) {
        fail(`Browser seek mismatch for frame ${frameIndex}: ${key}`);
      }
    }
    const previous = repeated.get(frameIndex);
    if (previous && JSON.stringify(previous) !== JSON.stringify(result)) {
      fail(`Repeated seek changed frame ${frameIndex}`);
    }
    repeated.set(frameIndex, result);
    observed.push(result);
  }
  return {
    valid: true,
    seeks: observed.length,
    uniqueFrames: repeated.size,
    groupFrames: manifest.profile.groupFrames,
    groupCount: manifest.profile.groupCount,
    viewportY: manifest.scanlines.viewportY,
    repeatedSeekStable: true,
    first: observed[0],
    last: observed.at(-1)
  };
}
