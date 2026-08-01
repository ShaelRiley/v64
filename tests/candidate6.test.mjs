import assert from "node:assert/strict";
import test from "node:test";
import {
  CANDIDATE_6_DARK_CHROMA,
  HYPERREAL_CANDIDATE_6A_PREFIX,
  HYPERREAL_CANDIDATE_6B_PREFIX,
  HYPERREAL_CANDIDATE_6C_PREFIX,
  generateHyperRealCandidate6APalette,
  generateHyperRealCandidate6BPalette,
  generateHyperRealCandidate6CPalette
} from "../tools/hyperreal-candidate-6-generator.mjs";
import { paletteHash } from "../tools/hyperreal-palette-generator.mjs";
import { paletteAssetFromId } from "../prototype/js/palette-registry.mjs";

const CASES = [
  {suffix:"A",fraction:0.25,dark:CANDIDATE_6_DARK_CHROMA.A,prefix:HYPERREAL_CANDIDATE_6A_PREFIX,generate:generateHyperRealCandidate6APalette,prefixHash:"e8d7b7de275b79acb403d17a97c4e7ef72ca16600a8f4f3ebdcba86099ce41cf",hash:"c03d23141eb33b80d79d1a7f3167eeb18ccf1f4f0c0f81572f269abd51317105"},
  {suffix:"B",fraction:0.50,dark:CANDIDATE_6_DARK_CHROMA.B,prefix:HYPERREAL_CANDIDATE_6B_PREFIX,generate:generateHyperRealCandidate6BPalette,prefixHash:"f60c17a1c2b5a318aaf4b29b8b50000c77eb7be02b05e30038bc9bc4ae302458",hash:"149eb1c91fe9481606b43cb375473fead9f133941ff2de2168db6946b10ae71a"},
  {suffix:"C",fraction:0.75,dark:CANDIDATE_6_DARK_CHROMA.C,prefix:HYPERREAL_CANDIDATE_6C_PREFIX,generate:generateHyperRealCandidate6CPalette,prefixHash:"a6801e0be2dbaf5bc33d4712b87650aecee2df77035b982b350025f07825b094",hash:"23ccd0aa1bf49a164bf66b1aaa01afdc0b860fb676276d92d89999d9273cf2bf"}
];

for (const item of CASES) {
  test(`Candidate 6${item.suffix} is a deterministic constrained interpolation`, () => {
    const palette = item.generate();
    assert.deepEqual(item.generate(), palette);
    assert.deepEqual(palette.slice(0, 16), item.prefix);
    assert.deepEqual(item.prefix[12], item.dark);
    assert.deepEqual(item.prefix.slice(13), [[32,32,32],[224,224,224],[112,112,112]]);
    assert.equal(new Set(palette.map((color) => color.join(","))).size, 256);
    assert.equal(paletteHash(palette), item.hash);

    const registered = paletteAssetFromId(`V64-P256-HYPERREAL-CANDIDATE-6${item.suffix}`);
    assert.equal(registered.sha256, item.hash);
    assert.equal(registered.metadata.prefix.sha256, item.prefixHash);
    assert.equal(registered.metadata.interpolation.fractionFromTealToNavy, item.fraction);
    assert.deepEqual(registered.colors.slice(0, 16), item.prefix);
  });
}
