import { LIMITS } from "./constants.mjs";
import { decodeVarUint, encodeVarUint } from "./varint.mjs";

export const OPCODE = Object.freeze({
  END: 0,
  SKIP: 1,
  LITERAL: 2,
  REPEAT_TOKEN: 3,
  FILL_RECT: 4,
  DEFINE_TOKEN_DICTIONARY: 5,
  DICTIONARY_LITERAL: 6
});

function tokenKey(cells, offset) {
  return `${cells[offset]},${cells[offset + 1]},${cells[offset + 2]}`;
}

function equalToken(a, aOffset, b, bOffset) {
  return a[aOffset] === b[bOffset] && a[aOffset + 1] === b[bOffset + 1] && a[aOffset + 2] === b[bOffset + 2];
}

function validateTokenBytes(glyph, foreground, background, paletteDepth) {
  if (glyph >= 64) throw new Error(`Glyph index ${glyph} exceeds canonical set`);
  if (foreground >= paletteDepth || background >= paletteDepth) throw new Error("Palette index exceeds declared depth");
}

function pushVar(parts, value) {
  parts.push(encodeVarUint(value));
}

export function encodeFrameCommands(current, previous, options) {
  const { columns, rows, paletteDepth, keyframe = !previous, useDictionary = true } = options;
  const cellCount = columns * rows;
  if (current.length !== cellCount * 3) throw new RangeError("Current cell-state length mismatch");
  if (!keyframe && (!previous || previous.length !== current.length)) throw new RangeError("Delta frame requires a matching previous state");
  for (let offset = 0; offset < current.length; offset += 3) {
    validateTokenBytes(current[offset], current[offset + 1], current[offset + 2], paletteDepth);
  }

  let uniform = keyframe;
  for (let offset = 3; uniform && offset < current.length; offset += 3) uniform = equalToken(current, 0, current, offset);
  if (uniform) {
    const parts = [Buffer.from([OPCODE.FILL_RECT])];
    for (const value of [0, 0, columns, rows]) pushVar(parts, value);
    parts.push(Buffer.from(current.subarray(0, 3)), Buffer.from([OPCODE.END]));
    return Buffer.concat(parts);
  }

  const frequencies = new Map();
  for (let cell = 0; cell < cellCount; cell += 1) {
    const offset = cell * 3;
    if (!keyframe && equalToken(current, offset, previous, offset)) continue;
    const key = tokenKey(current, offset);
    frequencies.set(key, (frequencies.get(key) || 0) + 1);
  }
  const dictionaryEntries = [...frequencies.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, LIMITS.maxDictionaryEntries);
  const dictionarySavings = dictionaryEntries.reduce((sum, [, count]) => sum + count * 2, 0) - dictionaryEntries.length * 3 - 3;
  const dictionary = useDictionary && dictionarySavings > 0
    ? dictionaryEntries.map(([key]) => key.split(",").map(Number))
    : [];
  const dictionaryIndex = new Map(dictionary.map((token, index) => [token.join(","), index]));
  const parts = [];
  if (dictionary.length) {
    parts.push(Buffer.from([OPCODE.DEFINE_TOKEN_DICTIONARY]));
    pushVar(parts, dictionary.length);
    parts.push(Buffer.from(dictionary.flat()));
  }

  let cell = 0;
  while (cell < cellCount) {
    const offset = cell * 3;
    if (!keyframe && equalToken(current, offset, previous, offset)) {
      let count = 1;
      while (cell + count < cellCount &&
          equalToken(current, (cell + count) * 3, previous, (cell + count) * 3)) count += 1;
      parts.push(Buffer.from([OPCODE.SKIP]));
      pushVar(parts, count);
      cell += count;
      continue;
    }

    let repeat = 1;
    while (cell + repeat < cellCount && equalToken(current, offset, current, (cell + repeat) * 3) &&
        (keyframe || !equalToken(current, (cell + repeat) * 3, previous, (cell + repeat) * 3))) repeat += 1;
    if (repeat >= 4) {
      parts.push(Buffer.from([OPCODE.REPEAT_TOKEN]));
      pushVar(parts, repeat);
      parts.push(Buffer.from(current.subarray(offset, offset + 3)));
      cell += repeat;
      continue;
    }

    const dict = dictionaryIndex.get(tokenKey(current, offset));
    if (dict !== undefined) {
      const indices = [];
      while (cell < cellCount) {
        const at = cell * 3;
        if (!keyframe && equalToken(current, at, previous, at)) break;
        let run = 1;
        while (cell + run < cellCount && equalToken(current, at, current, (cell + run) * 3) &&
            (keyframe || !equalToken(current, (cell + run) * 3, previous, (cell + run) * 3))) run += 1;
        if (run >= 4) break;
        const index = dictionaryIndex.get(tokenKey(current, at));
        if (index === undefined) break;
        indices.push(index);
        cell += 1;
      }
      if (!indices.length) throw new Error("Internal encoder error: dictionary run made no progress");
      parts.push(Buffer.from([OPCODE.DICTIONARY_LITERAL]));
      pushVar(parts, indices.length);
      parts.push(Buffer.from(indices));
      continue;
    }

    const start = cell;
    cell += 1;
    while (cell < cellCount) {
      const at = cell * 3;
      if (!keyframe && equalToken(current, at, previous, at)) break;
      let run = 1;
      while (cell + run < cellCount && equalToken(current, at, current, (cell + run) * 3)) run += 1;
      if (run >= 4 || dictionaryIndex.has(tokenKey(current, at))) break;
      cell += 1;
    }
    const count = cell - start;
    parts.push(Buffer.from([OPCODE.LITERAL]));
    pushVar(parts, count);
    parts.push(Buffer.from(current.subarray(start * 3, cell * 3)));
  }
  parts.push(Buffer.from([OPCODE.END]));
  return Buffer.concat(parts);
}

export function applyFrameCommands(commandBytes, prior, options) {
  const { columns, rows, paletteDepth, keyframe } = options;
  const cellCount = columns * rows;
  const state = keyframe ? new Uint8Array(cellCount * 3) : new Uint8Array(prior);
  if (!keyframe && (!prior || prior.length !== state.length)) throw new Error("Delta frame has no valid prior state");
  const touched = keyframe ? new Uint8Array(cellCount) : null;
  let cursor = 0;
  let offset = 0;
  let dictionary = null;

  const readVar = () => {
    const result = decodeVarUint(commandBytes, offset);
    offset = result.next;
    return result.value;
  };
  const readToken = () => {
    if (offset + 3 > commandBytes.length) throw new Error("Truncated cell token");
    const token = commandBytes.subarray(offset, offset + 3);
    validateTokenBytes(token[0], token[1], token[2], paletteDepth);
    offset += 3;
    return token;
  };
  const writeSequential = (token) => {
    if (cursor >= cellCount) throw new Error("Frame command advances beyond grid");
    state.set(token, cursor * 3);
    if (touched) touched[cursor] = 1;
    cursor += 1;
  };

  let ended = false;
  while (offset < commandBytes.length) {
    const opcode = commandBytes[offset++];
    if (opcode === OPCODE.END) {
      ended = true;
      break;
    }
    if (opcode === OPCODE.SKIP) {
      const count = readVar();
      if (!count || cursor + count > cellCount) throw new Error("Invalid skip run");
      cursor += count;
    } else if (opcode === OPCODE.LITERAL) {
      const count = readVar();
      if (!count || cursor + count > cellCount) throw new Error("Invalid literal run");
      for (let index = 0; index < count; index += 1) writeSequential(readToken());
    } else if (opcode === OPCODE.REPEAT_TOKEN) {
      const count = readVar();
      if (!count || cursor + count > cellCount) throw new Error("Invalid repeated-token run");
      const token = readToken();
      for (let index = 0; index < count; index += 1) writeSequential(token);
    } else if (opcode === OPCODE.FILL_RECT) {
      const x = readVar();
      const y = readVar();
      const width = readVar();
      const height = readVar();
      if (!width || !height || x + width > columns || y + height > rows) throw new Error("Rectangle lies outside frame");
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
      if (!count || count > LIMITS.maxDictionaryEntries) throw new Error("Invalid token dictionary length");
      dictionary = [];
      for (let index = 0; index < count; index += 1) dictionary.push(Buffer.from(readToken()));
    } else if (opcode === OPCODE.DICTIONARY_LITERAL) {
      if (!dictionary) throw new Error("Dictionary literal precedes dictionary definition");
      const count = readVar();
      if (!count || cursor + count > cellCount || offset + count > commandBytes.length) throw new Error("Invalid dictionary literal");
      for (let index = 0; index < count; index += 1) {
        const dictionaryId = commandBytes[offset++];
        if (dictionaryId >= dictionary.length) throw new Error("Dictionary index out of range");
        writeSequential(dictionary[dictionaryId]);
      }
    } else throw new Error(`Unknown mandatory frame opcode 0x${opcode.toString(16).padStart(2, "0")}`);
  }
  if (!ended) throw new Error("Frame command stream has no END");
  if (offset !== commandBytes.length) throw new Error("Trailing bytes after frame END");
  if (keyframe && touched.some((value) => value === 0)) throw new Error("Keyframe does not define every cell");
  return state;
}

export function measureFrameCommands(commandBytes) {
  const opcodeNames = Object.fromEntries(Object.entries(OPCODE).map(([name, value]) => [value, name]));
  const opcodes = {};
  const cells = {};
  let dictionaryEntries = 0;
  let dictionaryReferences = 0;
  let offset = 0;
  const readVar = () => {
    const result = decodeVarUint(commandBytes, offset);
    offset = result.next;
    return result.value;
  };
  const requireBytes = (count) => {
    if (offset + count > commandBytes.length) throw new Error("Truncated measured command stream");
    offset += count;
  };
  while (offset < commandBytes.length) {
    const opcode = commandBytes[offset++];
    const name = opcodeNames[opcode];
    if (!name) throw new Error(`Unknown measured opcode ${opcode}`);
    opcodes[name] = (opcodes[name] || 0) + 1;
    if (opcode === OPCODE.END) break;
    if (opcode === OPCODE.SKIP) {
      const count = readVar();
      cells.SKIP = (cells.SKIP || 0) + count;
    } else if (opcode === OPCODE.LITERAL) {
      const count = readVar();
      cells.LITERAL = (cells.LITERAL || 0) + count;
      requireBytes(count * 3);
    } else if (opcode === OPCODE.REPEAT_TOKEN) {
      const count = readVar();
      cells.REPEAT_TOKEN = (cells.REPEAT_TOKEN || 0) + count;
      requireBytes(3);
    } else if (opcode === OPCODE.FILL_RECT) {
      readVar();
      readVar();
      const width = readVar();
      const height = readVar();
      cells.FILL_RECT = (cells.FILL_RECT || 0) + width * height;
      requireBytes(3);
    } else if (opcode === OPCODE.DEFINE_TOKEN_DICTIONARY) {
      const count = readVar();
      dictionaryEntries += count;
      requireBytes(count * 3);
    } else if (opcode === OPCODE.DICTIONARY_LITERAL) {
      const count = readVar();
      dictionaryReferences += count;
      cells.DICTIONARY_LITERAL = (cells.DICTIONARY_LITERAL || 0) + count;
      requireBytes(count);
    }
  }
  if (offset !== commandBytes.length) throw new Error("Trailing bytes in measured command stream");
  return { opcodes, cells, dictionaryEntries, dictionaryReferences };
}
