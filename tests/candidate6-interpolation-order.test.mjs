import assert from "node:assert/strict";
import test from "node:test";
import {
  CANDIDATE_6_DARK_CHROMA,
  HYPERREAL_CANDIDATE_6A_PREFIX,
  HYPERREAL_CANDIDATE_6B_PREFIX,
  HYPERREAL_CANDIDATE_6C_PREFIX
} from "../tools/hyperreal-candidate-6-generator.mjs";

const TEAL = [0, 92, 96];
const NAVY = [16, 32, 72];

function interpolate(fraction) {
  return TEAL.map((channel, index) =>
    Math.round(channel + (NAVY[index] - channel) * fraction));
}

test("Candidate-6 dark chroma utilities are exact ordered quarter points", () => {
  assert.deepEqual(CANDIDATE_6_DARK_CHROMA.A, interpolate(0.25));
  assert.deepEqual(CANDIDATE_6_DARK_CHROMA.B, interpolate(0.50));
  assert.deepEqual(CANDIDATE_6_DARK_CHROMA.C, interpolate(0.75));
  assert.ok(CANDIDATE_6_DARK_CHROMA.A[1] > CANDIDATE_6_DARK_CHROMA.B[1]);
  assert.ok(CANDIDATE_6_DARK_CHROMA.B[1] > CANDIDATE_6_DARK_CHROMA.C[1]);
  assert.ok(CANDIDATE_6_DARK_CHROMA.A[0] < CANDIDATE_6_DARK_CHROMA.B[0]);
  assert.ok(CANDIDATE_6_DARK_CHROMA.B[0] < CANDIDATE_6_DARK_CHROMA.C[0]);
});

test("Candidate-6 prefixes vary only the constrained dark-chroma slot", () => {
  const prefixes = [
    HYPERREAL_CANDIDATE_6A_PREFIX,
    HYPERREAL_CANDIDATE_6B_PREFIX,
    HYPERREAL_CANDIDATE_6C_PREFIX
  ];
  for (let index = 0; index < 16; index += 1) {
    if (index === 12) continue;
    assert.deepEqual(prefixes[0][index], prefixes[1][index]);
    assert.deepEqual(prefixes[1][index], prefixes[2][index]);
  }
  assert.deepEqual(prefixes[0].slice(13), [[32,32,32],[224,224,224],[112,112,112]]);
});
