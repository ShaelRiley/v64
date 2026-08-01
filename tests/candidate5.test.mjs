import assert from "node:assert/strict";
import test from "node:test";
import {
  HYPERREAL_CANDIDATE_5A_PREFIX,
  HYPERREAL_CANDIDATE_5B_PREFIX,
  generateHyperRealCandidate5APalette,
  generateHyperRealCandidate5BPalette
} from "../tools/hyperreal-candidate-5-generator.mjs";
import { paletteHash } from "../tools/hyperreal-palette-generator.mjs";
import {
  PALETTE_ASSET_IDS,
  paletteAssetFromId
} from "../prototype/js/palette-registry.mjs";

const CASES = [
  {
    id: "V64-P256-HYPERREAL-CANDIDATE-5A",
    prefix: HYPERREAL_CANDIDATE_5A_PREFIX,
    generate: generateHyperRealCandidate5APalette,
    prefixHash: "441826817e2103b533a89b7162043158911e9d19dc4f745399cd0b5076ef7d71",
    hash: "0882df7996bfa9637273b18ff50bd0f86de95524c6098754a8be3227d64e2301",
    required: [0, 92, 96],
    omitted: [16, 32, 72]
  },
  {
    id: "V64-P256-HYPERREAL-CANDIDATE-5B",
    prefix: HYPERREAL_CANDIDATE_5B_PREFIX,
    generate: generateHyperRealCandidate5BPalette,
    prefixHash: "57b004a2d0038b032596d12d5faf6e69688b176bf9148a5aaad9cfe15ac9f827",
    hash: "dcab57b7098a23674555453a1db3183b00189ee44a7feffe7d40dd212c76b61a",
    required: [16, 32, 72],
    omitted: [0, 92, 96]
  }
];

for (const item of CASES) {
  test(`${item.id} is deterministic and isolates one dark-chroma utility`, () => {
    const first = item.generate();
    const second = item.generate();
    assert.deepEqual(first, second);
    assert.equal(first.length, 256);
    assert.deepEqual(first.slice(0, 16), item.prefix);
    assert.ok(item.prefix.some((color) => color.join() === item.required.join()));
    assert.ok(!item.prefix.some((color) => color.join() === item.omitted.join()));
    assert.ok(item.prefix.some((color) => color.join() === "32,32,32"));
    assert.ok(item.prefix.some((color) => color.join() === "224,224,224"));
    assert.ok(item.prefix.some((color) => color.join() === "112,112,112"));
    assert.equal(new Set(first.map((color) => color.join(","))).size, 256);
    assert.equal(paletteHash(first), item.hash);

    assert.ok(PALETTE_ASSET_IDS.includes(item.id));
    const registered = paletteAssetFromId(item.id);
    assert.equal(registered.sha256, item.hash);
    assert.equal(registered.metadata.prefix.sha256, item.prefixHash);
    assert.deepEqual(registered.colors.slice(0, 16), item.prefix);
  });
}
