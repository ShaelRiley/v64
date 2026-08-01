import assert from "node:assert/strict";
import test from "node:test";
import { PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import { encodeCellTimeline, muxV64 } from "../prototype/js/container.mjs";
import { verifyV1File } from "../prototype/js/v1-registry.mjs";

function fixture() {
  const columns = 4;
  const rows = 3;
  const paletteDepthId = PALETTE_DEPTHS.indexOf(16);
  const chunks = encodeCellTimeline(
    [Buffer.alloc(columns * rows * 3), Buffer.alloc(columns * rows * 3)],
    { columns, rows, cadenceId: 7, paletteDepthId, keyframeInterval: 24 }
  );
  return muxV64({ columns, rows, cadenceId: 7, paletteDepthId }, chunks);
}

test("registry-bound verifier returns codec and declaration evidence", () => {
  const result = verifyV1File(fixture());
  assert.equal(result.valid, true);
  assert.equal(result.frames, 2);
  assert.equal(result.registry.valid, true);
  assert.equal(result.registry.format, "V64-V1-REGISTRY-1");
  assert.equal(result.registry.knownFeatureMask, 0xff);
  assert.equal(result.registry.requiredFeatureMask, 0x19);
});

test("registry-bound verifier rejects declarations accepted by the legacy parser", () => {
  const missingAssetDeclaration = Buffer.from(fixture());
  missingAssetDeclaration.writeUInt32LE(
    missingAssetDeclaration.readUInt32LE(12) & ~0x10,
    12
  );
  assert.throws(
    () => verifyV1File(missingAssetDeclaration),
    /Required V1 feature bits are missing/
  );

  const straySilenceDeclaration = Buffer.from(fixture());
  straySilenceDeclaration.writeUInt32LE(
    straySilenceDeclaration.readUInt32LE(12) | 0x02,
    12
  );
  assert.throws(
    () => verifyV1File(straySilenceDeclaration),
    /explicit-silence declaration and bound presence disagree/
  );
});
