import assert from "node:assert/strict";
import test from "node:test";
import { applyFrameCommands, encodeFrameCommands, OPCODE } from "../prototype/js/commands.mjs";
import { decodeVarUint } from "../prototype/js/varint.mjs";

function frame(tokens) {
  return Uint8Array.from(tokens.flat());
}

test("uniform keyframe uses a rectangle fill and round-trips", () => {
  const source = frame(Array.from({ length: 12 }, () => [7, 1, 0]));
  const encoded = encodeFrameCommands(source, null, { columns: 4, rows: 3, paletteDepth: 2, keyframe: true });
  assert.equal(encoded[0], OPCODE.FILL_RECT);
  const decoded = applyFrameCommands(encoded, null, { columns: 4, rows: 3, paletteDepth: 2, keyframe: true });
  assert.deepEqual(decoded, source);
});

test("delta commands combine skip, literal, and repeated-token runs", () => {
  const prior = frame(Array.from({ length: 16 }, () => [0, 0, 0]));
  const next = new Uint8Array(prior);
  next.set([3, 1, 0], 2 * 3);
  for (let cell = 8; cell < 14; cell += 1) next.set([7, 1, 0], cell * 3);
  const encoded = encodeFrameCommands(next, prior, {
    columns: 4, rows: 4, paletteDepth: 2, keyframe: false, useDictionary: false
  });
  assert.ok(encoded.includes(OPCODE.SKIP));
  assert.ok(encoded.includes(OPCODE.LITERAL));
  assert.ok(encoded.includes(OPCODE.REPEAT_TOKEN));
  const decoded = applyFrameCommands(encoded, prior, { columns: 4, rows: 4, paletteDepth: 2, keyframe: false });
  assert.deepEqual(decoded, next);
});

test("local token dictionary is emitted when its overhead pays back", () => {
  const tokens = [];
  for (let index = 0; index < 40; index += 1) tokens.push(index % 2 ? [4, 2, 1] : [5, 1, 2]);
  const source = frame(tokens);
  const encoded = encodeFrameCommands(source, null, {
    columns: 8, rows: 5, paletteDepth: 3, keyframe: true, useDictionary: true
  });
  assert.ok(encoded.includes(OPCODE.DEFINE_TOKEN_DICTIONARY));
  assert.ok(encoded.includes(OPCODE.DICTIONARY_LITERAL));
  const decoded = applyFrameCommands(encoded, null, { columns: 8, rows: 5, paletteDepth: 3, keyframe: true });
  assert.deepEqual(decoded, source);
});

test("dictionary encoder always advances across a visually repeated token interrupted by an unchanged delta cell", () => {
  const priorTokens = Array.from({ length: 24 }, (_, index) => index % 2 ? [5, 1, 2] : [4, 2, 1]);
  const nextTokens = priorTokens.map((token) => [...token]);
  nextTokens[0] = [5, 1, 2];
  nextTokens[2] = [5, 1, 2];
  nextTokens[3] = [5, 1, 2];
  const prior = frame(priorTokens);
  const next = frame(nextTokens);
  const encoded = encodeFrameCommands(next, prior, {
    columns: 6, rows: 4, paletteDepth: 3, keyframe: false, useDictionary: true
  });
  const decoded = applyFrameCommands(encoded, prior, { columns: 6, rows: 4, paletteDepth: 3, keyframe: false });
  assert.deepEqual(decoded, next);
});

test("every malformed command class is bounded", () => {
  assert.throws(() => applyFrameCommands(Buffer.from([OPCODE.SKIP, 0x81]), new Uint8Array(3), {
    columns: 1, rows: 1, paletteDepth: 2, keyframe: false
  }), /Truncated varuint/);
  assert.throws(() => applyFrameCommands(Buffer.from([OPCODE.REPEAT_TOKEN, 2, 0, 0, 0, OPCODE.END]), null, {
    columns: 1, rows: 1, paletteDepth: 2, keyframe: true
  }), /beyond grid|Invalid repeated/);
  assert.throws(() => applyFrameCommands(Buffer.from([OPCODE.FILL_RECT, 1, 0, 1, 1, 0, 0, 0, OPCODE.END]), null, {
    columns: 1, rows: 1, paletteDepth: 2, keyframe: true
  }), /outside frame/);
  assert.throws(() => applyFrameCommands(Buffer.from([0x7f, OPCODE.END]), null, {
    columns: 1, rows: 1, paletteDepth: 2, keyframe: true
  }), /Unknown mandatory frame opcode/);
});

test("varuint decoder rejects truncated, noncanonical, and oversized values", () => {
  assert.throws(() => decodeVarUint(Buffer.from([0x80])), /Truncated/);
  assert.throws(() => decodeVarUint(Buffer.from([0x80, 0x00])), /Non-canonical/);
  assert.throws(() => decodeVarUint(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x10])), /exceeds uint32/);
});
