import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyPackedCommands, buildCommandTrace, encodePackedCommands, measurePackedCommands,
  PACKED_OPCODE, paletteIndexBits, parsePackedCommands
} from "../prototype/js/grammar-b.mjs";
import {
  benchmarkCommandBackends, createCommandTraceDocument
} from "../prototype/js/command-benchmark.mjs";
import { demuxV64 } from "../prototype/js/container.mjs";
import { PALETTE_DEPTHS } from "../prototype/js/constants.mjs";

function frame(tokens) {
  return Uint8Array.from(tokens.flat());
}

test("Grammar B round-trips keyframes and deltas at every palette depth", () => {
  for (const paletteDepth of PALETTE_DEPTHS) {
    const high = paletteDepth - 1;
    const keyframe = frame([
      [0, 0, 0], [7, high, 0], [7, high, 0], [7, high, 0],
      [3, 0, high], [4, high, high], [5, 0, 0], [6, high, 0]
    ]);
    const keyTrace = buildCommandTrace(keyframe, null, {
      columns: 4, rows: 2, paletteDepth, keyframe: true
    });
    const keyBytes = encodePackedCommands(keyTrace);
    assert.deepEqual(applyPackedCommands(keyBytes, null, {
      columns: 4, rows: 2, paletteDepth, keyframe: true
    }), keyframe);

    const delta = new Uint8Array(keyframe);
    delta.set([8, high, 0], 1 * 3);
    delta.set([3, high, high], 4 * 3);
    delta.set([4, 0, high], 5 * 3);
    const deltaTrace = buildCommandTrace(delta, keyframe, {
      columns: 4, rows: 2, paletteDepth, keyframe: false
    });
    const deltaBytes = encodePackedCommands(deltaTrace);
    assert.deepEqual(applyPackedCommands(deltaBytes, keyframe, {
      columns: 4, rows: 2, paletteDepth, keyframe: false
    }), delta);
    assert.equal(deltaTrace.paletteBits, paletteIndexBits(paletteDepth));
  }
});

test("Grammar B emits separate glyph, foreground, background, and color-pair actions", () => {
  const prior = frame([
    [1, 1, 2], [2, 1, 2], [3, 1, 2], [4, 1, 2], [5, 1, 2], [6, 1, 2]
  ]);
  const current = frame([
    [7, 1, 2], [2, 3, 2], [3, 1, 4], [4, 5, 6], [5, 1, 2], [6, 1, 2]
  ]);
  const trace = buildCommandTrace(current, prior, {
    columns: 6, rows: 1, paletteDepth: 8, keyframe: false
  });
  assert.deepEqual(trace.commands.map((command) => command.op), [
    "SET_GLYPH", "SET_FOREGROUND", "SET_BACKGROUND", "SET_COLOR_PAIR", "SKIP", "END"
  ]);
  const bytes = encodePackedCommands(trace);
  const measured = measurePackedCommands(bytes, {
    columns: 6, rows: 1, paletteDepth: 8, keyframe: false
  });
  assert.equal(measured.opcodes.SET_GLYPH, 1);
  assert.equal(measured.opcodes.SET_FOREGROUND, 1);
  assert.equal(measured.opcodes.SET_BACKGROUND, 1);
  assert.equal(measured.opcodes.SET_COLOR_PAIR, 1);
  assert.equal(measured.opcodeBytes + measured.countBytes + measured.payloadBytes, bytes.length);
  assert.deepEqual(applyPackedCommands(bytes, prior, {
    columns: 6, rows: 1, paletteDepth: 8, keyframe: false
  }), current);
});

test("packed payloads are canonical and reject padding, truncation, and zero progress", () => {
  assert.throws(() => parsePackedCommands(
    Buffer.from([PACKED_OPCODE.SET_GLYPH, 0xc0, PACKED_OPCODE.END]),
    { columns: 1, rows: 1, paletteDepth: 2, keyframe: false }
  ), /padding/);
  assert.throws(() => parsePackedCommands(
    Buffer.from([PACKED_OPCODE.LITERAL, 1]),
    { columns: 1, rows: 1, paletteDepth: 2, keyframe: true }
  ), /Truncated/);
  assert.throws(() => parsePackedCommands(
    Buffer.from([PACKED_OPCODE.SKIP, 0, PACKED_OPCODE.END]),
    { columns: 1, rows: 1, paletteDepth: 2, keyframe: false }
  ), /Zero-progress/);
});

test("damaged Grammar B deltas cannot mutate the prior validated state", () => {
  const prior = frame(Array.from({ length: 8 }, (_, index) => [index, 1, 0]));
  const before = new Uint8Array(prior);
  const next = new Uint8Array(prior);
  next.set([9, 1, 0], 2 * 3);
  const trace = buildCommandTrace(next, prior, {
    columns: 4, rows: 2, paletteDepth: 2, keyframe: false
  });
  const valid = encodePackedCommands(trace);
  const damaged = valid.subarray(0, valid.length - 1);
  assert.throws(() => applyPackedCommands(damaged, prior, {
    columns: 4, rows: 2, paletteDepth: 2, keyframe: false
  }), /END|Truncated/);
  assert.deepEqual(prior, before);
});

test("the golden fixture produces a deterministic backend-neutral command report", () => {
  const file = readFileSync(new URL("./golden/procedural.v64", import.meta.url));
  const demuxed = demuxV64(file);
  const first = benchmarkCommandBackends(demuxed, { sourceFileBytes: file.length });
  const second = benchmarkCommandBackends(demuxed, { sourceFileBytes: file.length });
  assert.deepEqual(first, second);
  assert.equal(first.source.codedFrames, 48);
  assert.equal(first.source.independentGroups, 1);
  assert.equal(first.grammarB.canonicalTraceSha256.length, 64);
  assert.equal(first.grammarB.commandBytes,
    first.grammarB.opcodeBytes + first.grammarB.countBytes + first.grammarB.packedPayloadBytes);
  assert.ok(first.projectedFiles.packedOnlyBytes > 0);
  assert.ok(first.projectedFiles.selectiveDeflateBytes > 0);

  const trace = createCommandTraceDocument(demuxed);
  assert.equal(trace.codedFrames, 48);
  assert.equal(trace.frames[0].trace.keyframe, true);
  assert.equal(trace.frames.at(-1).trace.commands.at(-1).op, "END");
});
