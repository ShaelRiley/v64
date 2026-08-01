import test from "node:test";
import assert from "node:assert/strict";

import {
  containAspect,
  displayGeometryFromProbe
} from "../prototype/js/source-geometry.mjs";

test("display geometry honors phone rotation metadata", () => {
  const geometry = displayGeometryFromProbe({
    width: 1920,
    height: 1080,
    sample_aspect_ratio: "1:1",
    display_aspect_ratio: "16:9",
    side_data_list: [{ rotation: 90 }]
  });
  assert.deepEqual(geometry, {
    storedWidth: 1920,
    storedHeight: 1080,
    rotationDegrees: 90,
    displayAspectRatio: 9 / 16
  });
});

test("display geometry uses declared display aspect and normalizes rotation", () => {
  assert.equal(displayGeometryFromProbe({
    width: 720,
    height: 480,
    sample_aspect_ratio: "4:3",
    side_data_list: [{ rotation: -90 }]
  }).displayAspectRatio, 1 / 2);
  assert.equal(displayGeometryFromProbe({
    width: 1920,
    height: 1080,
    display_aspect_ratio: "16:9",
    side_data_list: [{ rotation: 180 }]
  }).displayAspectRatio, 16 / 9);
});

test("aspect containment pads instead of stretching rounded grids", () => {
  assert.deepEqual(containAspect(320, 184, 16 / 9), {
    width: 320,
    height: 180,
    x: 0,
    y: 2
  });
  assert.deepEqual(containAspect(320, 568, 9 / 16), {
    width: 319,
    height: 568,
    x: 0,
    y: 0
  });
});

test("aspect geometry rejects empty and non-finite inputs", () => {
  assert.throws(() => containAspect(0, 10, 1), /positive safe integers/);
  assert.throws(() => containAspect(10, 10, Number.NaN), /must be positive/);
  assert.throws(() => displayGeometryFromProbe({ width: 0, height: 1 }), /valid video dimensions/);
});
