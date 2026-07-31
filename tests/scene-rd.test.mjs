import assert from "node:assert/strict";
import test from "node:test";
import { GLYPH_MASKS } from "../prototype/js/assets.mjs";
import { cadenceFromId, PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import { muxV64, verifyV64 } from "../prototype/js/container.mjs";
import {
  VIDEO64_DEFAULT_GLYPH_COUNT,
  VIDEO64_PRIMARY_GLYPH_COUNTS,
  glyphSubsetMap,
  primaryGlyphCountFromValue,
  remapCellsToGlyphCount
} from "../prototype/js/glyph-subset.mjs";
import {
  analyzeRateDistortionTimeline,
  encodeSceneAwareCellTimeline,
  measureProxyDistortion,
  rateDistortionModeFromValue,
  selectRateDistortionCandidate
} from "../prototype/js/rate-distortion.mjs";
import {
  planIndependentGroups,
  scoreSceneCut
} from "../prototype/js/scene-cut.mjs";

function solid(width, height, value) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

test("scene-cut score is bounded and separates identity from a hard cut", () => {
  const black = solid(4, 4, 0);
  const nearBlack = solid(4, 4, 2);
  const white = solid(4, 4, 255);
  assert.equal(scoreSceneCut(black, black, 4, 4).score, 0);
  assert.ok(scoreSceneCut(black, nearBlack, 4, 4).score < 0.02);
  assert.equal(scoreSceneCut(black, white, 4, 4).score, 1);
});

test("scene cuts can shorten but never exceed the frozen group maximum", () => {
  const frames = [
    solid(2, 2, 0),
    solid(2, 2, 0),
    solid(2, 2, 255),
    solid(2, 2, 255),
    solid(2, 2, 255),
    solid(2, 2, 255)
  ];
  const plan = planIndependentGroups(frames, 2, 2, {
    threshold: 0.4,
    minimumGroupFrames: 2,
    maximumGroupFrames: 3
  });
  assert.deepEqual(plan.starts, [0, 2, 5]);
  assert.deepEqual(plan.groups.map((group) => group.frames), [2, 3, 1]);
  assert.equal(plan.sceneCuts, 1);
  assert.equal(plan.maximumBoundaries, 1);
});

test("32 glyphs is the primary default and 64 is the optional primary path", () => {
  assert.equal(VIDEO64_DEFAULT_GLYPH_COUNT, 32);
  assert.deepEqual(VIDEO64_PRIMARY_GLYPH_COUNTS, [32, 64]);
  assert.equal(primaryGlyphCountFromValue(), 32);
  assert.equal(primaryGlyphCountFromValue("64"), 64);
  assert.throws(() => primaryGlyphCountFromValue(16), /must be 32 or 64/);
});

test("glyph subset maps are deterministic and keep all emitted glyphs in range", () => {
  const map = glyphSubsetMap(32);
  assert.equal(map.length, 64);
  for (let glyph = 0; glyph < 32; glyph += 1) assert.equal(map[glyph], glyph);
  for (let glyph = 32; glyph < 64; glyph += 1) assert.ok(map[glyph] < 32);
  const cells = Buffer.from([63, 1, 0, 31, 2, 0, 15, 3, 0]);
  const remapped = remapCellsToGlyphCount(cells, 32);
  assert.ok(remapped[0] < 32);
  assert.equal(remapped[3], 31);
  assert.equal(remapped[6], 15);
  assert.equal(GLYPH_MASKS.length, 64);
});

test("target modes make explicit 32-primary rate-versus-distortion choices", () => {
  const candidates = [
    { glyphCount: 32, rateBytes: 10, distortion: 0.2, cellCount: 10 },
    { glyphCount: 64, rateBytes: 14, distortion: 0.01, cellCount: 10 }
  ];
  assert.equal(selectRateDistortionCandidate(candidates, "compact").glyphCount, 32);
  assert.equal(selectRateDistortionCandidate(candidates, "quality").glyphCount, 64);
  assert.deepEqual(rateDistortionModeFromValue("compact").glyphCounts, [32]);
  assert.deepEqual(rateDistortionModeFromValue("balanced").glyphCounts, [32]);
  assert.deepEqual(rateDistortionModeFromValue("quality").glyphCounts, [32, 64]);
  assert.throws(() => rateDistortionModeFromValue("unbounded"), /Unknown rate-distortion mode/);
});

test("proxy distortion is exact for a matching 2x raster", () => {
  const source = Buffer.from([20, 40, 60, 255]);
  const rgba = Buffer.alloc(2 * 2 * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) source.copy(rgba, offset);
  const measured = measureProxyDistortion(source, 1, 1, { width: 2, height: 2, rgba });
  assert.equal(measured.mse, 0);
  assert.equal(measured.normalized, 0);
  assert.equal(measured.psnr, null);
});

test("scene-aware rate-distortion analysis emits independently verifiable groups", () => {
  const width = 4;
  const height = 8;
  const cadenceId = 7;
  const paletteDepthId = PALETTE_DEPTHS.indexOf(2);
  const rawFrames = [
    solid(width, height, 0),
    solid(width, height, 0),
    solid(width, height, 255),
    solid(width, height, 255)
  ];
  const analysis = analyzeRateDistortionTimeline(rawFrames, {
    mode: "quality",
    width,
    height,
    columns: 1,
    rows: 1,
    paletteDepth: 2,
    paletteDepthId,
    cadenceId,
    maximumGroupFrames: 48,
    minimumGroupFrames: 2,
    sceneCutThreshold: 0.4
  });
  assert.equal(analysis.defaultGlyphCount, 32);
  assert.ok(analysis.selections.every((item) => item.glyphCount === 32 || item.glyphCount === 64));
  assert.deepEqual(analysis.plan.starts, [0, 2]);
  assert.equal(analysis.frameTicks, cadenceFromId(cadenceId).frameTicks);
  const chunks = encodeSceneAwareCellTimeline(analysis);
  const file = muxV64({ columns: 1, rows: 1, cadenceId, paletteDepthId }, chunks);
  const verified = verifyV64(file);
  assert.equal(verified.frames, 4);
  assert.equal(verified.keyframes, 2);
});

test("scene and rate-distortion options reject malformed bounds", () => {
  const frame = solid(1, 1, 0);
  assert.throws(
    () => planIndependentGroups([frame], 1, 1, {
      minimumGroupFrames: 5,
      maximumGroupFrames: 4
    }),
    /minimum group exceeds maximum/
  );
  assert.throws(() => glyphSubsetMap(0), /Glyph subset size/);
  assert.throws(
    () => selectRateDistortionCandidate([
      { glyphCount: 32, rateBytes: -1, distortion: 0, cellCount: 1 }
    ]),
    /must be nonnegative/
  );
});
