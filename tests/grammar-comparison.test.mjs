import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { demuxV64 } from "../prototype/js/container.mjs";
import { applyPackedCommandsDirect } from "../prototype/js/grammar-b-direct.mjs";
import {
  benchmarkPreparedGrammar,
  decodePreparedGrammar,
  grammarDecoderComplexity,
  prepareGrammarComparison
} from "../prototype/js/grammar-comparison.mjs";

const fixture = readFileSync(new URL("./golden/procedural.v64", import.meta.url));

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function frameOptions(prepared, frame) {
  return {
    columns: prepared.columns,
    rows: prepared.rows,
    paletteDepth: prepared.paletteDepth,
    keyframe: frame.keyframe
  };
}

test("Phase-1 and direct Grammar B decode the same golden timeline", () => {
  const prepared = prepareGrammarComparison(demuxV64(fixture));
  const phase1 = decodePreparedGrammar(prepared, "phase1", { verify: true });
  const grammarB = decodePreparedGrammar(prepared, "grammarB", { verify: true });
  assert.equal(phase1.nominalFrames, grammarB.nominalFrames);
  assert.equal(phase1.codedFrames, grammarB.codedFrames);
  assert.equal(phase1.repeatFrames, grammarB.repeatFrames);
  assert.ok(equalBytes(phase1.finalState, grammarB.finalState));
});

test("decoder complexity counts the complete direct Grammar B surface", () => {
  const complexity = grammarDecoderComplexity();
  assert.equal(complexity.phase1.opcodeCount, 7);
  assert.equal(complexity.phase1.functionCount, 1);
  assert.equal(complexity.grammarB.opcodeCount, 12);
  assert.equal(complexity.grammarB.functionCount, 5);
  assert.ok(complexity.phase1.sourceBytes > 0);
  assert.ok(complexity.grammarB.sourceBytes > 0);
  assert.ok(complexity.phase1.sourceLines > 0);
  assert.ok(complexity.grammarB.sourceLines > 0);
});

test("decoder resource benchmark validates both grammars", () => {
  const prepared = prepareGrammarComparison(demuxV64(fixture));
  const phase1 = benchmarkPreparedGrammar(prepared, "phase1", 1);
  const grammarB = benchmarkPreparedGrammar(prepared, "grammarB", 1);
  assert.equal(phase1.nominalFrames, grammarB.nominalFrames);
  assert.ok(phase1.medianMilliseconds >= 0);
  assert.ok(grammarB.medianMilliseconds >= 0);
  assert.ok(phase1.peakHeapDeltaBytes >= 0);
  assert.ok(grammarB.peakHeapDeltaBytes >= 0);
});

test("direct Grammar B rejects trailing bytes and unknown mandatory opcodes", () => {
  const prepared = prepareGrammarComparison(demuxV64(fixture));
  const keyframe = prepared.frames.find((frame) => !frame.repeat && frame.keyframe);
  assert.ok(keyframe);
  assert.throws(
    () => applyPackedCommandsDirect(
      Buffer.concat([keyframe.grammarB, Buffer.from([0])]),
      null,
      frameOptions(prepared, keyframe)
    ),
    /Trailing bytes after packed frame END/
  );
  assert.throws(
    () => applyPackedCommandsDirect(
      Buffer.from([0xff]),
      null,
      frameOptions(prepared, keyframe)
    ),
    /Unknown mandatory packed opcode/
  );
});

test("damaged direct Grammar B delta cannot mutate its prior state", () => {
  const prepared = prepareGrammarComparison(demuxV64(fixture));
  let prior = null;
  let delta = null;
  for (const frame of prepared.frames) {
    if (frame.repeat) continue;
    if (!frame.keyframe) {
      delta = frame;
      break;
    }
    prior = applyPackedCommandsDirect(
      frame.grammarB,
      prior,
      frameOptions(prepared, frame)
    );
  }
  assert.ok(delta);
  assert.ok(prior);
  const snapshot = new Uint8Array(prior);
  const damaged = Buffer.from(delta.grammarB.subarray(0, -1));
  assert.throws(
    () => applyPackedCommandsDirect(
      damaged,
      prior,
      frameOptions(prepared, delta)
    ),
    /END|Truncated/
  );
  assert.ok(equalBytes(prior, snapshot));
});

test("grammar comparison rejects unknown grammar names", () => {
  const prepared = prepareGrammarComparison(demuxV64(fixture));
  assert.throws(
    () => decodePreparedGrammar(prepared, "grammar-c"),
    /Grammar must be phase1 or grammarB/
  );
});
