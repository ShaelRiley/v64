#!/usr/bin/env node
import "./build-browser-seek-fixture.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyViewportScanlines,
  parseBrowserV64,
  renderComposite,
  seekSubtitlePlane,
  seekVideoFrame
} from "../prototype/browser/seek-conformance.mjs";

const outputDirectory = resolve(
  process.argv[2] || "bench/generated/browser-seek"
);
const manifestPath = resolve(outputDirectory, "manifest.json");
const v64 = readFileSync(resolve(outputDirectory, "browser-seek.v64"));
const pcm = readFileSync(resolve(outputDirectory, "browser-seek.pcm"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const parsed = parseBrowserV64(v64);
const frameIndex = 72;
const bytesPerFrame = manifest.profile.audioSamplesPerFrame * 2;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function serializePlane(plane) {
  const bytes = Buffer.alloc(plane.length * 22);
  let offset = 0;
  for (const entry of plane) {
    bytes.writeUInt32LE(entry.cellIndex, offset);
    offset += 4;
    bytes[offset++] = entry.foreground;
    bytes[offset++] = entry.background;
    Buffer.from(entry.mask).copy(bytes, offset);
    offset += 16;
  }
  return bytes;
}

const cells = seekVideoFrame(parsed, frameIndex);
const plane = seekSubtitlePlane(parsed, frameIndex);
const composite = renderComposite(cells, plane, parsed.header, manifest.assets);
const scanlined = applyViewportScanlines(composite, manifest.scanlines);
const audioStart = frameIndex * bytesPerFrame;
const audio = pcm.subarray(audioStart, audioStart + bytesPerFrame);
assert.equal(audio.length, bytesPerFrame);

manifest.seekOrder = [0, 47, 48, 49, 95, 48, 0, 72, 73, 24, 73, 47, 95];
manifest.expected[String(frameIndex)] = {
  cellsSha256: digest(cells),
  subtitleSha256: digest(serializePlane(plane)),
  compositeSha256: digest(composite.rgba),
  scanlineSha256: digest(scanlined.rgba),
  audioSha256: digest(audio)
};
assert.equal(manifest.seekOrder.length, 13);
assert.equal(new Set(manifest.seekOrder).size, 8);
assert.equal(Object.keys(manifest.expected).length, 8);

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  format: manifest.format,
  seeks: manifest.seekOrder.length,
  uniqueFrames: new Set(manifest.seekOrder).size,
  addedFrame: frameIndex,
  addedExpected: manifest.expected[String(frameIndex)]
}, null, 2));
