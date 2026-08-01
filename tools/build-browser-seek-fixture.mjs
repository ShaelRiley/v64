#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GLYPH_MASKS, MASTER_PALETTE } from "../prototype/js/assets.mjs";
import { PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import {
  CADENCES,
  decodeSubtitleTimeline,
  decodeVideoTimeline,
  demuxV64,
  encodeCellTimeline,
  makeChunk,
  muxV64,
  verifyV64
} from "../prototype/js/container.mjs";
import { applyPlaybackEffects } from "../prototype/js/playback-effects.mjs";
import { encodeSubtitleMaskSequence } from "../prototype/js/subtitle-mask-sm2.mjs";
import { compositeSubtitleMaskPlane } from "../prototype/js/subtitle-mask-preview.mjs";
import { renderCells } from "../prototype/js/video64.mjs";

const outputDirectory = resolve(
  process.argv[2] || "bench/generated/browser-seek"
);
mkdirSync(outputDirectory, { recursive: true });

const columns = 4;
const rows = 2;
const cellCount = columns * rows;
const cadenceId = 7;
const cadence = CADENCES[cadenceId];
const paletteDepthId = PALETTE_DEPTHS.indexOf(16);
const paletteDepth = PALETTE_DEPTHS[paletteDepthId];
const groupFrames = 48;
const groupCount = 2;
const totalFrames = groupFrames * groupCount;
const durationTicks = totalFrames * cadence.frameTicks;
const samplesPerFrame = 48000 / 24;
const viewportY = 3;
const seekOrder = [0, 47, 48, 49, 95, 48, 0, 73, 24, 73, 47, 95];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function frameState(frameIndex) {
  const group = Math.floor(frameIndex / groupFrames);
  const local = frameIndex % groupFrames;
  const stage = Math.floor(local / 8);
  const glyphs = [7, 8, 9, 10, 11, 0];
  const cells = Buffer.alloc(cellCount * 3);
  for (let cell = 0; cell < cellCount; cell += 1) {
    const offset = cell * 3;
    cells[offset] = glyphs[(cell + stage + group * 2) % glyphs.length];
    cells[offset + 1] = 1 + ((cell + stage + group * 3) % 11);
    cells[offset + 2] = group ? 13 : 0;
  }
  return cells;
}

function subtitleEntry(cellIndex, foreground, background, maskRows) {
  return {
    cellIndex,
    foreground,
    background,
    mask: Buffer.from(maskRows)
  };
}

const captionA = [
  subtitleEntry(4, 1, 0, [
    0x00, 0x18, 0x3c, 0x66, 0x66, 0x7e, 0x66, 0x66,
    0x66, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ])
];
const captionB = [
  subtitleEntry(5, 4, 0, [
    0x00, 0x7c, 0x66, 0x66, 0x7c, 0x66, 0x66, 0x66,
    0x7c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ])
];
const captionC = [
  subtitleEntry(6, 5, 13, [
    0x00, 0x3c, 0x66, 0x60, 0x60, 0x60, 0x66, 0x3c,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ])
];
const captionD = [
  subtitleEntry(7, 6, 13, [
    0x00, 0x78, 0x6c, 0x66, 0x66, 0x66, 0x6c, 0x78,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ])
];

const subtitleGroups = [
  [
    ...Array.from({ length: 16 }, () => captionA),
    ...Array.from({ length: 16 }, () => captionB),
    ...Array.from({ length: 16 }, () => [])
  ],
  [
    ...Array.from({ length: 24 }, () => captionC),
    ...Array.from({ length: 24 }, () => captionD)
  ]
];

const videoChunks = encodeCellTimeline(
  Array.from({ length: totalFrames }, (_, frame) => frameState(frame)),
  {
    columns,
    rows,
    cadenceId,
    paletteDepthId,
    keyframeInterval: groupFrames,
    useDictionary: true
  }
).map((chunk) => ({ ...chunk, compress: false }));

const subtitleChunks = subtitleGroups.map((frames, group) => makeChunk(
  "SUBT",
  group * groupFrames * cadence.frameTicks,
  groupFrames * cadence.frameTicks,
  encodeSubtitleMaskSequence(frames, { cellCount, paletteDepth }),
  { compress: false }
));

const file = muxV64(
  { columns, rows, cadenceId, paletteDepthId },
  [...videoChunks, ...subtitleChunks]
);
const demuxed = demuxV64(file);
const verification = verifyV64(file);
assert.equal(verification.frames, totalFrames);
assert.equal(verification.subtitleChunks, groupCount);
assert.equal(verification.subtitleFrames, totalFrames);
assert.equal(demuxed.index.length, groupCount);
assert.deepEqual(
  demuxed.index.map((entry) => entry.timestamp),
  [0, groupFrames * cadence.frameTicks]
);
assert.equal(
  demuxed.chunks.some((chunk) => chunk.flags & 2),
  false,
  "browser fixture must not require DEFLATE"
);

const videoTimeline = decodeVideoTimeline(demuxed);
const expandedVideo = [];
for (const item of videoTimeline) {
  const count = item.duration / cadence.frameTicks;
  for (let frame = 0; frame < count; frame += 1) {
    expandedVideo.push(Buffer.from(item.state));
  }
}
assert.equal(expandedVideo.length, totalFrames);

const subtitles = decodeSubtitleTimeline(demuxed);
function subtitlePlane(frameIndex) {
  const tick = frameIndex * cadence.frameTicks;
  const chunk = subtitles.chunks.find((item) =>
    tick >= item.timestamp && tick < item.endTimestamp);
  if (!chunk) return [];
  return chunk.sequence.frames[(tick - chunk.timestamp) / cadence.frameTicks];
}

const pcm = Buffer.alloc(totalFrames * samplesPerFrame * 2);
for (let sample = 0; sample < totalFrames * samplesPerFrame; sample += 1) {
  const group = Math.floor(sample / (groupFrames * samplesPerFrame));
  const local = sample % (groupFrames * samplesPerFrame);
  const quiet = local >= 24000 && local < 36000;
  const frequency = group ? 660 : 440;
  const value = quiet
    ? 0
    : Math.round(Math.sin(2 * Math.PI * frequency * sample / 48000) * 10000);
  pcm.writeInt16LE(value, sample * 2);
}

function serializePlane(entries) {
  const output = Buffer.alloc(entries.length * 22);
  let offset = 0;
  for (const entry of entries) {
    output.writeUInt32LE(entry.cellIndex, offset);
    offset += 4;
    output[offset++] = entry.foreground;
    output[offset++] = entry.background;
    Buffer.from(entry.mask).copy(output, offset);
    offset += 16;
  }
  return output;
}

const expected = {};
for (const frameIndex of new Set(seekOrder)) {
  const cells = expandedVideo[frameIndex];
  const entries = subtitlePlane(frameIndex);
  const base = renderCells(
    cells,
    columns,
    rows,
    paletteDepth,
    MASTER_PALETTE
  );
  const composite = entries.length
    ? compositeSubtitleMaskPlane(
        base,
        { cellCount, paletteDepth, entries },
        columns,
        rows,
        MASTER_PALETTE
      )
    : base;
  const scanlined = applyPlaybackEffects(
    { ...composite, viewportY },
    {
      crtScanlines: true,
      crtScanlineStrength: 0.18,
      crtScanlinePeriod: 2,
      crtScanlinePhase: 1
    }
  );
  const audioStart = frameIndex * samplesPerFrame * 2;
  const audio = pcm.subarray(audioStart, audioStart + samplesPerFrame * 2);
  expected[frameIndex] = {
    cellsSha256: sha256(cells),
    subtitleSha256: sha256(serializePlane(entries)),
    compositeSha256: sha256(composite.rgba),
    scanlineSha256: sha256(scanlined.rgba),
    audioSha256: sha256(audio)
  };
}

const manifest = {
  format: "V64-BROWSER-SEEK-FIXTURE-1",
  container: {
    filename: "browser-seek.v64",
    bytes: file.length,
    sha256: sha256(file),
    featureFlags: demuxed.header.featureFlags,
    verification
  },
  audio: {
    filename: "browser-seek.pcm",
    sampleRate: 48000,
    channels: 1,
    samples: totalFrames * samplesPerFrame,
    bytes: pcm.length,
    sha256: sha256(pcm),
    note: "Companion golden PCM timeline for browser seek slicing; AURN packet decode is covered by the separate AM1 playback gate."
  },
  profile: {
    columns,
    rows,
    cellCount,
    cadenceId,
    frameTicks: cadence.frameTicks,
    durationTicks,
    paletteDepthId,
    paletteDepth,
    totalFrames,
    groupFrames,
    groupCount,
    audioSamplesPerFrame: samplesPerFrame
  },
  scanlines: {
    viewportY,
    strength: 0.18,
    period: 2,
    phase: 1
  },
  seekOrder,
  assets: {
    palette: MASTER_PALETTE.slice(0, paletteDepth),
    glyphMasks: GLYPH_MASKS.map((mask) => [...mask])
  },
  expected
};

writeFileSync(resolve(outputDirectory, "browser-seek.v64"), file);
writeFileSync(resolve(outputDirectory, "browser-seek.pcm"), pcm);
writeFileSync(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
console.log(JSON.stringify({
  format: manifest.format,
  containerBytes: file.length,
  containerSha256: manifest.container.sha256,
  pcmSha256: manifest.audio.sha256,
  expectedFrames: Object.keys(expected).length
}, null, 2));
