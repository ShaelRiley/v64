import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { demuxV64 } from "../prototype/js/container.mjs";
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

test("Phase-1 and Grammar B decode the same golden timeline", () => {
  const prepared = prepareGrammarComparison(demuxV64(fixture));
  const phase1 = decodePreparedGrammar(prepared, "phase1", { verify: true });
  const grammarB = decodePreparedGrammar(prepared, "grammarB", { verify: true });
  assert.equal(phase1.nominalFrames, grammarB.nominalFrames);
  assert.equal(phase1.codedFrames, grammarB.codedFrames);
  assert.equal(phase1.repeatFrames, grammarB.repeatFrames);
  assert.ok(equalBytes(phase1.finalState, grammarB.finalState));
});

test("decoder complexity records the larger Grammar B opcode surface", () => {
  const complexity = grammarDecoderComplexity();
  assert.equal(complexity.phase1.opcodeCount, 7);
  assert.equal(complexity.grammarB.opcodeCount, 12);
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

test("grammar comparison rejects unknown grammar names", () => {
  const prepared = prepareGrammarComparison(demuxV64(fixture));
  assert.throws(
    () => decodePreparedGrammar(prepared, "grammar-c"),
    /Grammar must be phase1 or grammarB/
  );
});
