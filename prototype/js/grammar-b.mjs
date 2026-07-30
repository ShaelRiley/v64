import { LIMITS } from "./constants.mjs";
import { decodeVarUint, encodeVarUint } from "./varint.mjs";

export const GRAMMAR_B_VERSION = 2;

export const PACKED_OPCODE = Object.freeze({
  END: 0,
  SKIP: 1,
  LITERAL: 2,
  REPEAT_TOKEN: 3,
  SET_GLYPH: 4,
  SET_FOREGROUND: 5,
  SET_BACKGROUND: 6,
  SET_COLOR_PAIR: 7,
  REPEAT_GLYPH: 8,
  REPEAT_FOREGROUND: 9,
  REPEAT_BACKGROUND: 10,
  REPEAT_COLOR_PAIR: 11
});

const OPCODE_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(PACKED_OPCODE).map(([name, value]) => [value, name]))
);

function checkedGrid(columns, rows) {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 ||
      columns > LIMITS.maxColumns || rows > LIMITS.maxRows) {
    throw new RangeError("Grid exceeds V64 proof profile");
  }
  const cellCount = columns * rows;
  if (!Number.isSafeInteger(cellCount) || cellCount > LIMITS.maxCells) {
    throw new RangeError("Cell count exceeds V64 proof profile");
  }
  return cellCount;
}

export function paletteIndexBits(paletteDepth) {
  if (!Number.isInteger(paletteDepth) || paletteDepth < 2 || paletteDepth > 256) {
    throw new RangeError("Palette depth must be an integer from 2 through 256");
  }
  return Math.ceil(Math.log2(paletteDepth));
}

function equalToken(a, aOffset, b, bOffset) {
  return a[aOffset] === b[bOffset] &&
    a[aOffset + 1] === b[bOffset + 1] &&
    a[aOffset + 2] === b[bOffset + 2];
}

function isVoidToken(cells, offset) {
  return cells[offset] === 0 && cells[offset + 1] === 0 && cells[offset + 2] === 0;
}

function tokenAt(cells, cell) {
  const offset = cell * 3;
  return [cells[offset], cells[offset + 1], cells[offset + 2]];
}

function validateToken(token, paletteDepth) {
  if (!Array.isArray(token) || token.length !== 3) throw new Error("Malformed cell token");
  const [glyph, foreground, background] = token;
  if (!Number.isInteger(glyph) || glyph < 0 || glyph >= 64) throw new RangeError("Glyph index exceeds canonical set");
  if (!Number.isInteger(foreground) || !Number.isInteger(background) ||
      foreground < 0 || background < 0 ||
      foreground >= paletteDepth || background >= paletteDepth) {
    throw new RangeError("Palette index exceeds declared depth");
  }
}

function changeKind(current, previous, cell) {
  const offset = cell * 3;
  const glyph = current[offset] !== previous[offset];
  const foreground = current[offset + 1] !== previous[offset + 1];
  const background = current[offset + 2] !== previous[offset + 2];
  if (glyph && !foreground && !background) return "SET_GLYPH";
  if (!glyph && foreground && !background) return "SET_FOREGROUND";
  if (!glyph && !foreground && background) return "SET_BACKGROUND";
  if (!glyph && foreground && background) return "SET_COLOR_PAIR";
  return glyph || foreground || background ? "LITERAL" : "SKIP";
}

function countEqualTokens(current, start, cellCount) {
  const offset = start * 3;
  let count = 1;
  while (start + count < cellCount &&
      equalToken(current, offset, current, (start + count) * 3)) count += 1;
  return count;
}

function varUintLength(value) {
  if (value < 0x80) return 1;
  if (value < 0x4000) return 2;
  if (value < 0x20_0000) return 3;
  if (value < 0x1000_0000) return 4;
  return 5;
}

function componentCommand(current, previous, cell) {
  const offset = cell * 3;
  const op = changeKind(current, previous, cell);
  if (op === "SET_GLYPH") return { op, value: current[offset] };
  if (op === "SET_FOREGROUND") return { op, value: current[offset + 1] };
  if (op === "SET_BACKGROUND") return { op, value: current[offset + 2] };
  if (op === "SET_COLOR_PAIR") {
    return { op, foreground: current[offset + 1], background: current[offset + 2] };
  }
  return null;
}

function equalComponentCommand(a, b) {
  return a?.op === b?.op &&
    a?.value === b?.value &&
    a?.foreground === b?.foreground &&
    a?.background === b?.background;
}

function repeatComponentOp(op) {
  if (op === "SET_GLYPH") return "REPEAT_GLYPH";
  if (op === "SET_FOREGROUND") return "REPEAT_FOREGROUND";
  if (op === "SET_BACKGROUND") return "REPEAT_BACKGROUND";
  if (op === "SET_COLOR_PAIR") return "REPEAT_COLOR_PAIR";
  throw new Error(`No repeat form for ${op}`);
}

function componentRunLength(current, previous, start, cellCount, command) {
  let count = 1;
  while (start + count < cellCount &&
      equalComponentCommand(componentCommand(current, previous, start + count), command)) count += 1;
  return count;
}

function componentPayloadBytes(op, paletteBits) {
  if (op === "SET_GLYPH" || op === "REPEAT_GLYPH") return 1;
  if (op === "SET_COLOR_PAIR" || op === "REPEAT_COLOR_PAIR") return Math.ceil(2 * paletteBits / 8);
  return Math.ceil(paletteBits / 8);
}

const COMMAND_PRIORITY = Object.freeze({
  SKIP: 0,
  REPEAT_GLYPH: 1,
  REPEAT_FOREGROUND: 1,
  REPEAT_BACKGROUND: 1,
  REPEAT_COLOR_PAIR: 1,
  REPEAT_TOKEN: 2,
  SET_GLYPH: 3,
  SET_FOREGROUND: 3,
  SET_BACKGROUND: 3,
  SET_COLOR_PAIR: 3,
  LITERAL: 4
});

export function buildCommandTrace(currentInput, previousInput, options) {
  const {
    columns, rows, paletteDepth, keyframe = !previousInput, maxLiteralRun = 64
  } = options;
  const cellCount = checkedGrid(columns, rows);
  if (!Number.isInteger(maxLiteralRun) || maxLiteralRun < 1 || maxLiteralRun > 1024) {
    throw new RangeError("maxLiteralRun must be an integer from 1 through 1024");
  }
  const current = Uint8Array.from(currentInput);
  if (current.length !== cellCount * 3) throw new RangeError("Current cell-state length mismatch");
  const previous = keyframe ? new Uint8Array(current.length) : Uint8Array.from(previousInput || []);
  if (!keyframe && previous.length !== current.length) {
    throw new RangeError("Delta frame requires a matching previous state");
  }
  for (let cell = 0; cell < cellCount; cell += 1) validateToken(tokenAt(current, cell), paletteDepth);

  const paletteBits = paletteIndexBits(paletteDepth);
  const tokenBits = 6 + 2 * paletteBits;
  const bestCost = new Float64Array(cellCount + 1);
  bestCost.fill(Number.POSITIVE_INFINITY);
  bestCost[cellCount] = 1;
  const choices = new Array(cellCount);
  const consider = (cell, candidate) => {
    const total = candidate.byteCost + bestCost[cell + candidate.count];
    const selected = choices[cell];
    const selectedTotal = selected
      ? selected.byteCost + bestCost[cell + selected.count]
      : Number.POSITIVE_INFINITY;
    const better = total < selectedTotal ||
      (total === selectedTotal && candidate.count > (selected?.count || 0)) ||
      (total === selectedTotal && candidate.count === selected?.count &&
        COMMAND_PRIORITY[candidate.op] < COMMAND_PRIORITY[selected.op]);
    if (better) {
      choices[cell] = candidate;
      bestCost[cell] = total;
    }
  };

  for (let cell = cellCount - 1; cell >= 0; cell -= 1) {
    const offset = cell * 3;
    const unchanged = keyframe ? isVoidToken(current, offset) : equalToken(current, offset, previous, offset);
    if (unchanged) {
      let count = 1;
      while (cell + count < cellCount) {
        const at = (cell + count) * 3;
        const same = keyframe ? isVoidToken(current, at) : equalToken(current, at, previous, at);
        if (!same) break;
        count += 1;
      }
      consider(cell, { op: "SKIP", count, byteCost: 1 + varUintLength(count) });
    }

    const maximumLiteral = Math.min(maxLiteralRun, cellCount - cell);
    for (let count = 1; count <= maximumLiteral; count += 1) {
      consider(cell, {
        op: "LITERAL",
        count,
        byteCost: 1 + varUintLength(count) + Math.ceil(count * tokenBits / 8)
      });
    }

    const tokenRepeat = countEqualTokens(current, cell, cellCount);
    if (tokenRepeat >= 2) {
      consider(cell, {
        op: "REPEAT_TOKEN",
        count: tokenRepeat,
        token: tokenAt(current, cell),
        byteCost: 1 + varUintLength(tokenRepeat) + Math.ceil(tokenBits / 8)
      });
    }

    if (!keyframe) {
      const component = componentCommand(current, previous, cell);
      if (component) {
        consider(cell, {
          ...component,
          count: 1,
          byteCost: 1 + componentPayloadBytes(component.op, paletteBits)
        });
        const count = componentRunLength(current, previous, cell, cellCount, component);
        if (count >= 2) {
          const op = repeatComponentOp(component.op);
          consider(cell, {
            ...component,
            op,
            count,
            byteCost: 1 + varUintLength(count) + componentPayloadBytes(op, paletteBits)
          });
        }
      }
    }
    if (!choices[cell]) throw new Error("Command optimizer failed to make progress");
  }

  const commands = [];
  for (let cell = 0; cell < cellCount;) {
    const selected = choices[cell];
    const command = { ...selected, startCell: cell };
    delete command.byteCost;
    if (command.op === "LITERAL") {
      command.tokens = Array.from({ length: command.count }, (_, index) => tokenAt(current, cell + index));
    }
    commands.push(command);
    cell += command.count;
  }
  commands.push({ op: "END", startCell: cellCount, count: 0 });
  return {
    grammar: "V64-GRAMMAR-B",
    version: GRAMMAR_B_VERSION,
    columns,
    rows,
    cellCount,
    paletteDepth,
    paletteBits,
    keyframe: Boolean(keyframe),
    parser: "bounded-dynamic-programming",
    maxLiteralRun,
    packedByteCost: bestCost[0],
    commands
  };
}

function packFields(fields) {
  const totalBits = fields.reduce((sum, field) => sum + field.width, 0);
  const output = Buffer.alloc(Math.ceil(totalBits / 8));
  let bitOffset = 0;
  for (const { value, width } of fields) {
    const limit = 2 ** width;
    if (!Number.isInteger(value) || value < 0 || value >= limit) {
      throw new RangeError(`Value ${value} does not fit in ${width} bits`);
    }
    for (let bit = 0; bit < width; bit += 1) {
      if (value & (2 ** bit)) output[bitOffset >> 3] |= 1 << (bitOffset & 7);
      bitOffset += 1;
    }
  }
  return output;
}

function unpackFields(bytes, widths) {
  const totalBits = widths.reduce((sum, width) => sum + width, 0);
  const requiredBytes = Math.ceil(totalBits / 8);
  if (bytes.length !== requiredBytes) throw new Error("Packed field length mismatch");
  const values = [];
  let bitOffset = 0;
  for (const width of widths) {
    let value = 0;
    for (let bit = 0; bit < width; bit += 1) {
      if (bytes[bitOffset >> 3] & (1 << (bitOffset & 7))) value += 2 ** bit;
      bitOffset += 1;
    }
    values.push(value);
  }
  for (let bit = totalBits; bit < requiredBytes * 8; bit += 1) {
    if (bytes[bit >> 3] & (1 << (bit & 7))) throw new Error("Nonzero packed padding bits");
  }
  return values;
}

function packedTokens(tokens, paletteBits, paletteDepth) {
  const fields = [];
  for (const token of tokens) {
    validateToken(token, paletteDepth);
    fields.push(
      { value: token[0], width: 6 },
      { value: token[1], width: paletteBits },
      { value: token[2], width: paletteBits }
    );
  }
  return packFields(fields);
}

function pushVar(parts, value) {
  const encoded = encodeVarUint(value);
  parts.push(encoded);
  return encoded.length;
}

export function encodePackedCommands(trace) {
  if (trace?.grammar !== "V64-GRAMMAR-B" || trace.version !== GRAMMAR_B_VERSION) {
    throw new Error("Unsupported command trace");
  }
  const paletteBits = paletteIndexBits(trace.paletteDepth);
  const parts = [];
  for (const command of trace.commands) {
    const opcode = PACKED_OPCODE[command.op];
    if (opcode === undefined) throw new Error(`Unknown trace operation ${command.op}`);
    parts.push(Buffer.from([opcode]));
    if (command.op === "END") continue;
    if (command.op === "SKIP") {
      pushVar(parts, command.count);
    } else if (command.op === "LITERAL") {
      if (!command.count || command.tokens?.length !== command.count) throw new Error("Malformed literal trace");
      pushVar(parts, command.count);
      parts.push(packedTokens(command.tokens, paletteBits, trace.paletteDepth));
    } else if (command.op === "REPEAT_TOKEN") {
      if (!command.count) throw new Error("Malformed repeated-token trace");
      pushVar(parts, command.count);
      parts.push(packedTokens([command.token], paletteBits, trace.paletteDepth));
    } else if (command.op === "SET_GLYPH" || command.op === "REPEAT_GLYPH") {
      if (command.op === "REPEAT_GLYPH") pushVar(parts, command.count);
      parts.push(packFields([{ value: command.value, width: 6 }]));
    } else if (command.op === "SET_FOREGROUND" || command.op === "SET_BACKGROUND" ||
        command.op === "REPEAT_FOREGROUND" || command.op === "REPEAT_BACKGROUND") {
      if (command.op.startsWith("REPEAT_")) pushVar(parts, command.count);
      if (command.value >= trace.paletteDepth) throw new RangeError("Palette index exceeds declared depth");
      parts.push(packFields([{ value: command.value, width: paletteBits }]));
    } else if (command.op === "SET_COLOR_PAIR" || command.op === "REPEAT_COLOR_PAIR") {
      if (command.op === "REPEAT_COLOR_PAIR") pushVar(parts, command.count);
      if (command.foreground >= trace.paletteDepth || command.background >= trace.paletteDepth) {
        throw new RangeError("Palette index exceeds declared depth");
      }
      parts.push(packFields([
        { value: command.foreground, width: paletteBits },
        { value: command.background, width: paletteBits }
      ]));
    }
  }
  return Buffer.concat(parts);
}

export function parsePackedCommands(commandInput, options) {
  const commandBytes = Buffer.from(commandInput);
  const { columns, rows, paletteDepth, keyframe = false } = options;
  const cellCount = checkedGrid(columns, rows);
  const paletteBits = paletteIndexBits(paletteDepth);
  const tokenBits = 6 + 2 * paletteBits;
  const commands = [];
  const commandLimit = 2 * cellCount + 1;
  let offset = 0;
  let cursor = 0;
  let ended = false;

  const readVar = () => {
    const start = offset;
    const result = decodeVarUint(commandBytes, offset);
    offset = result.next;
    if (!result.value) throw new Error("Zero-progress command");
    return { value: result.value, bytes: offset - start };
  };
  const readPacked = (widths) => {
    const byteLength = Math.ceil(widths.reduce((sum, width) => sum + width, 0) / 8);
    if (offset + byteLength > commandBytes.length) throw new Error("Truncated packed command payload");
    const bytes = commandBytes.subarray(offset, offset + byteLength);
    offset += byteLength;
    return { values: unpackFields(bytes, widths), bytes: byteLength };
  };
  const push = (command) => {
    commands.push(command);
    if (commands.length > commandLimit) throw new Error("Frame command count exceeds bound");
  };

  while (offset < commandBytes.length) {
    const byteStart = offset;
    const opcode = commandBytes[offset++];
    const op = OPCODE_NAMES[opcode];
    if (!op) throw new Error(`Unknown mandatory packed opcode 0x${opcode.toString(16).padStart(2, "0")}`);
    if (op === "END") {
      push({
        op,
        startCell: cursor,
        count: 0,
        byteStart,
        byteLength: 1,
        opcodeBytes: 1,
        countBytes: 0,
        payloadBytes: 0
      });
      ended = true;
      break;
    }

    if (op === "SKIP") {
      const count = readVar();
      if (cursor + count.value > cellCount) throw new Error("Packed skip advances beyond grid");
      push({
        op,
        startCell: cursor,
        count: count.value,
        byteStart,
        byteLength: offset - byteStart,
        opcodeBytes: 1,
        countBytes: count.bytes,
        payloadBytes: 0
      });
      cursor += count.value;
      continue;
    }

    if (op === "LITERAL" || op === "REPEAT_TOKEN") {
      const count = readVar();
      if (cursor + count.value > cellCount) throw new Error("Packed token command advances beyond grid");
      const tokenCount = op === "LITERAL" ? count.value : 1;
      const widths = Array.from({ length: tokenCount }, () => [6, paletteBits, paletteBits]).flat();
      const packed = readPacked(widths);
      const tokens = [];
      for (let index = 0; index < packed.values.length; index += 3) {
        const token = packed.values.slice(index, index + 3);
        validateToken(token, paletteDepth);
        tokens.push(token);
      }
      push({
        op,
        startCell: cursor,
        count: count.value,
        ...(op === "LITERAL" ? { tokens } : { token: tokens[0] }),
        byteStart,
        byteLength: offset - byteStart,
        opcodeBytes: 1,
        countBytes: count.bytes,
        payloadBytes: Math.ceil(tokenCount * tokenBits / 8)
      });
      cursor += count.value;
      continue;
    }

    const repeatingComponent = op === "REPEAT_GLYPH" ||
      op === "REPEAT_FOREGROUND" ||
      op === "REPEAT_BACKGROUND" ||
      op === "REPEAT_COLOR_PAIR";
    const count = repeatingComponent ? readVar() : { value: 1, bytes: 0 };
    const glyphComponent = op === "SET_GLYPH" || op === "REPEAT_GLYPH";
    const pairComponent = op === "SET_COLOR_PAIR" || op === "REPEAT_COLOR_PAIR";
    const widths = glyphComponent ? [6] : (pairComponent ? [paletteBits, paletteBits] : [paletteBits]);
    const packed = readPacked(widths);
    if (cursor + count.value > cellCount) throw new Error("Packed component command advances beyond grid");
    const values = packed.values;
    if (!glyphComponent && values.some((value) => value >= paletteDepth)) {
      throw new Error("Palette index exceeds declared depth");
    }
    push({
      op,
      startCell: cursor,
      count: count.value,
      ...(pairComponent
        ? { foreground: values[0], background: values[1] }
        : { value: values[0] }),
      byteStart,
      byteLength: offset - byteStart,
      opcodeBytes: 1,
      countBytes: count.bytes,
      payloadBytes: packed.bytes
    });
    cursor += count.value;
  }

  if (!ended) throw new Error("Packed command stream has no END");
  if (offset !== commandBytes.length) throw new Error("Trailing bytes after packed frame END");
  return {
    grammar: "V64-GRAMMAR-B",
    version: GRAMMAR_B_VERSION,
    columns,
    rows,
    cellCount,
    paletteDepth,
    paletteBits,
    keyframe: Boolean(keyframe),
    commands
  };
}

export function applyPackedCommands(commandBytes, priorInput, options) {
  const { columns, rows, paletteDepth, keyframe } = options;
  const cellCount = checkedGrid(columns, rows);
  if (!keyframe && (!priorInput || priorInput.length !== cellCount * 3)) {
    throw new Error("Delta frame has no valid prior state");
  }
  const state = keyframe ? new Uint8Array(cellCount * 3) : new Uint8Array(priorInput);
  const trace = parsePackedCommands(commandBytes, { columns, rows, paletteDepth, keyframe });
  for (const command of trace.commands) {
    if (command.op === "END" || command.op === "SKIP") continue;
    if (command.op === "LITERAL") {
      for (let index = 0; index < command.tokens.length; index += 1) {
        state.set(command.tokens[index], (command.startCell + index) * 3);
      }
    } else if (command.op === "REPEAT_TOKEN") {
      for (let index = 0; index < command.count; index += 1) {
        state.set(command.token, (command.startCell + index) * 3);
      }
    } else {
      for (let index = 0; index < command.count; index += 1) {
        const offset = (command.startCell + index) * 3;
        if (command.op === "SET_GLYPH" || command.op === "REPEAT_GLYPH") {
          state[offset] = command.value;
        } else if (command.op === "SET_FOREGROUND" || command.op === "REPEAT_FOREGROUND") {
          state[offset + 1] = command.value;
        } else if (command.op === "SET_BACKGROUND" || command.op === "REPEAT_BACKGROUND") {
          state[offset + 2] = command.value;
        } else if (command.op === "SET_COLOR_PAIR" || command.op === "REPEAT_COLOR_PAIR") {
          state[offset + 1] = command.foreground;
          state[offset + 2] = command.background;
        }
      }
    }
  }
  return state;
}

export function measurePackedCommands(commandBytes, options) {
  const trace = parsePackedCommands(commandBytes, options);
  const result = {
    totalBytes: Buffer.byteLength(commandBytes),
    opcodeBytes: 0,
    countBytes: 0,
    payloadBytes: 0,
    opcodes: {},
    cells: {}
  };
  for (const command of trace.commands) {
    result.opcodeBytes += command.opcodeBytes;
    result.countBytes += command.countBytes;
    result.payloadBytes += command.payloadBytes;
    result.opcodes[command.op] = (result.opcodes[command.op] || 0) + 1;
    if (command.op !== "END") result.cells[command.op] = (result.cells[command.op] || 0) + command.count;
  }
  if (result.opcodeBytes + result.countBytes + result.payloadBytes !== result.totalBytes) {
    throw new Error("Packed command accounting mismatch");
  }
  return result;
}
