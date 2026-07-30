import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PLAYBACK_EFFECTS,
  PLAYER_SCANLINE_OPTION,
  VLC_SCANLINE_OPTION,
  applyPlaybackEffects,
  normalizePlaybackEffects
} from "../prototype/js/playback-effects.mjs";

function image(width = 2, height = 4, value = 200) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return { width, height, rgba };
}

test("native and VLC playback profiles default CRT scanlines on", () => {
  assert.equal(DEFAULT_PLAYBACK_EFFECTS.crtScanlines, true);
  assert.equal(PLAYER_SCANLINE_OPTION.defaultValue, true);
  assert.equal(VLC_SCANLINE_OPTION.defaultValue, true);
  assert.equal(normalizePlaybackEffects().crtScanlineStrength, 0.18);
});

test("scanlines are a non-mutating viewport-phase presentation effect", () => {
  const source = image();
  const before = Buffer.from(source.rgba);
  const output = applyPlaybackEffects(source);
  assert.deepEqual(source.rgba, before, "decoded raster must remain untouched");
  assert.notDeepEqual(output.rgba, before);

  for (let y = 0; y < source.height; y += 1) {
    const expected = y % 2 === 1 ? 164 : 200;
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      assert.equal(output.rgba[offset], expected);
      assert.equal(output.rgba[offset + 3], 255);
    }
  }
});

test("disabling scanlines reproduces the unfiltered decoded raster", () => {
  const source = image(3, 3, 137);
  const output = applyPlaybackEffects(source, { crtScanlines: false });
  assert.deepEqual(output.rgba, source.rgba);
  assert.notEqual(output.rgba, source.rgba, "presentation output must own its buffer");
});

test("invalid scanline strength, period, and phase are rejected", () => {
  assert.throws(() => normalizePlaybackEffects({ crtScanlineStrength: 0.8 }), /strength/);
  assert.throws(() => normalizePlaybackEffects({ crtScanlinePeriod: 1 }), /period/);
  assert.throws(() => normalizePlaybackEffects({ crtScanlinePeriod: 2, crtScanlinePhase: 2 }), /phase/);
});
