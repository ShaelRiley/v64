import { LIMITS } from "./constants.mjs";
import { PACKED_OPCODE, paletteIndexBits } from "./grammar-b.mjs";
import { decodeVarUint } from "./varint.mjs";

const OPCODE_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(PACKED_OPCODE).map(([name, value]) => [value, name]))
);

function checkedGrid(columns, rows) {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) ||
      columns < 1 || rows < 1 ||
      columns > LIMITS.maxColumns || rows > LIMITS.maxRows) {
    throw new RangeError("Grid exceeds V64 proof profile");
  }
  const cellCount = columns * rows;
  if (!Number.isSafeInteger(cellCount) || cellCount > LIMITS.maxCells) {
    throw new RangeError("Cell count exceeds V64 proof profile");
  }
  return cellCount;
}

function readPackedValue(bytes, byteStart, bitStart, width) {
  let value = 0;
  for (let bit = 0; bit < width; bit += 1) {
    const absoluteBit = bitStart + bit;
    if (bytes[byteStart + (absoluteBit >> 3)] & (1 << (absoluteBit & 7))) {
      value += 2 ** bit;
    }
  }
  return value;
}

function requireZeroPadding(bytes, byteStart, usedBits, byteLength) {
  for (let bit = usedBits; bit < byteLength * 8; bit += 1) {
    if (bytes[byteStart + (bit >> 3)] & (1 << (bit & 7))) {
      throw new Error("Nonzero packed padding bits");
    }
  }
}

function validateToken(glyph, foreground, background, paletteDepth) {
  if (glyph >= 64) throw new RangeError("Glyph index exceeds canonical set");
  if (foreground >= paletteDepth || background >= paletteDepth) {
    throw new RangeError("Palette index exceeds declared depth");
  }
}

/**
 * Decode and apply Grammar B in one bounded pass.
 *
 * Unlike applyPackedCommands(), this path does not materialize a parsed command
 * trace or per-command token arrays. The destination state remains
 * transactional because it is always a new allocation, never the prior frame.
 */
export function applyPackedCommandsDirect(commandInput, priorInput, options) {
  const commandBytes = Buffer.from(commandInput);
  const { columns, rows, paletteDepth, keyframe } = options;
  const cellCount = checkedGrid(columns, rows);
  if (!keyframe && (!priorInput || priorInput.length !== cellCount * 3)) {
    throw new Error("Delta frame has no valid prior state");
  }

  const paletteBits = paletteIndexBits(paletteDepth);
  const tokenBits = 6 + 2 * paletteBits;
  const state = keyframe
    ? new Uint8Array(cellCount * 3)
    : new Uint8Array(priorInput);
  const commandLimit = 2 * cellCount + 1;
  let commandCount = 0;
  let offset = 0;
  let cursor = 0;
  let ended = false;

  const readVar = () => {
    const result = decodeVarUint(commandBytes, offset);
    offset = result.next;
    if (!result.value) throw new Error("Zero-progress command");
    return result.value;
  };

  const requirePayload = (usedBits) => {
    const byteLength = Math.ceil(usedBits / 8);
    if (offset + byteLength > commandBytes.length) {
      throw new Error("Truncated packed command payload");
    }
    const byteStart = offset;
    offset += byteLength;
    return { byteStart, byteLength };
  };

  const writeToken = (cell, glyph, foreground, background) => {
    validateToken(glyph, foreground, background, paletteDepth);
    const target = cell * 3;
    state[target] = glyph;
    state[target + 1] = foreground;
    state[target + 2] = background;
  };

  while (offset < commandBytes.length) {
    commandCount += 1;
    if (commandCount > commandLimit) {
      throw new Error("Frame command count exceeds bound");
    }

    const opcode = commandBytes[offset++];
    const op = OPCODE_NAMES[opcode];
    if (!op) {
      throw new Error(
        `Unknown mandatory packed opcode 0x${opcode.toString(16).padStart(2, "0")}`
      );
    }
    if (op === "END") {
      ended = true;
      break;
    }

    if (op === "SKIP") {
      const count = readVar();
      if (cursor + count > cellCount) {
        throw new Error("Packed skip advances beyond grid");
      }
      cursor += count;
      continue;
    }

    if (op === "LITERAL") {
      const count = readVar();
      if (cursor + count > cellCount) {
        throw new Error("Packed token command advances beyond grid");
      }
      const usedBits = count * tokenBits;
      if (!Number.isSafeInteger(usedBits)) throw new RangeError("Packed literal is too large");
      const payload = requirePayload(usedBits);
      let bit = 0;
      for (let index = 0; index < count; index += 1) {
        const glyph = readPackedValue(commandBytes, payload.byteStart, bit, 6);
        bit += 6;
        const foreground = readPackedValue(
          commandBytes,
          payload.byteStart,
          bit,
          paletteBits
        );
        bit += paletteBits;
        const background = readPackedValue(
          commandBytes,
          payload.byteStart,
          bit,
          paletteBits
        );
        bit += paletteBits;
        writeToken(cursor + index, glyph, foreground, background);
      }
      requireZeroPadding(
        commandBytes,
        payload.byteStart,
        usedBits,
        payload.byteLength
      );
      cursor += count;
      continue;
    }

    if (op === "REPEAT_TOKEN") {
      const count = readVar();
      if (cursor + count > cellCount) {
        throw new Error("Packed token command advances beyond grid");
      }
      const payload = requirePayload(tokenBits);
      let bit = 0;
      const glyph = readPackedValue(commandBytes, payload.byteStart, bit, 6);
      bit += 6;
      const foreground = readPackedValue(
        commandBytes,
        payload.byteStart,
        bit,
        paletteBits
      );
      bit += paletteBits;
      const background = readPackedValue(
        commandBytes,
        payload.byteStart,
        bit,
        paletteBits
      );
      validateToken(glyph, foreground, background, paletteDepth);
      requireZeroPadding(
        commandBytes,
        payload.byteStart,
        tokenBits,
        payload.byteLength
      );
      for (let index = 0; index < count; index += 1) {
        writeToken(cursor + index, glyph, foreground, background);
      }
      cursor += count;
      continue;
    }

    const repeating = op === "REPEAT_GLYPH" ||
      op === "REPEAT_FOREGROUND" ||
      op === "REPEAT_BACKGROUND" ||
      op === "REPEAT_COLOR_PAIR";
    const count = repeating ? readVar() : 1;
    if (cursor + count > cellCount) {
      throw new Error("Packed component command advances beyond grid");
    }

    const glyphComponent = op === "SET_GLYPH" || op === "REPEAT_GLYPH";
    const pairComponent = op === "SET_COLOR_PAIR" || op === "REPEAT_COLOR_PAIR";
    const usedBits = glyphComponent ? 6 : (pairComponent ? 2 * paletteBits : paletteBits);
    const payload = requirePayload(usedBits);
    const first = readPackedValue(commandBytes, payload.byteStart, 0, glyphComponent ? 6 : paletteBits);
    const second = pairComponent
      ? readPackedValue(commandBytes, payload.byteStart, paletteBits, paletteBits)
      : null;
    requireZeroPadding(
      commandBytes,
      payload.byteStart,
      usedBits,
      payload.byteLength
    );

    if (!glyphComponent && (first >= paletteDepth || (pairComponent && second >= paletteDepth))) {
      throw new Error("Palette index exceeds declared depth");
    }

    for (let index = 0; index < count; index += 1) {
      const target = (cursor + index) * 3;
      if (op === "SET_GLYPH" || op === "REPEAT_GLYPH") {
        state[target] = first;
      } else if (op === "SET_FOREGROUND" || op === "REPEAT_FOREGROUND") {
        state[target + 1] = first;
      } else if (op === "SET_BACKGROUND" || op === "REPEAT_BACKGROUND") {
        state[target + 2] = first;
      } else if (pairComponent) {
        state[target + 1] = first;
        state[target + 2] = second;
      }
    }
    cursor += count;
  }

  if (!ended) throw new Error("Packed command stream has no END");
  if (offset !== commandBytes.length) {
    throw new Error("Trailing bytes after packed frame END");
  }
  return state;
}
