import assert from "node:assert/strict";
import test from "node:test";
import { PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import {
  demuxV64,
  encodeCellTimeline,
  encodeParticleEvents,
  makeChunk,
  muxV64
} from "../prototype/js/container.mjs";
import {
  V1_REGISTRY,
  validateV1Registry
} from "../prototype/js/v1-registry.mjs";

const columns = 4;
const rows = 3;
const paletteDepthId = PALETTE_DEPTHS.indexOf(16);

function videoChunks() {
  return encodeCellTimeline(
    [
      Buffer.alloc(columns * rows * 3),
      Buffer.alloc(columns * rows * 3)
    ],
    { columns, rows, cadenceId: 7, paletteDepthId, keyframeInterval: 24 }
  );
}

function build(extra = []) {
  return muxV64(
    { columns, rows, cadenceId: 7, paletteDepthId },
    [...videoChunks(), ...extra]
  );
}

function cloneDemuxed(demuxed, options = {}) {
  return {
    header: {
      ...demuxed.header,
      featureFlags: options.featureFlags ?? demuxed.header.featureFlags
    },
    chunks: options.chunks ?? demuxed.chunks.map((chunk) => ({ ...chunk })),
    index: demuxed.index.map((entry) => ({ ...entry }))
  };
}

test("machine-readable V1 registry fixes all current feature and chunk identities", () => {
  assert.equal(V1_REGISTRY.format, "V64-V1-REGISTRY-1");
  assert.equal(V1_REGISTRY.containerVersion, "0.1");
  assert.equal(V1_REGISTRY.knownFeatureMask, 0xff);
  assert.equal(V1_REGISTRY.requiredFeatureMask, 0x19);
  assert.deepEqual(
    V1_REGISTRY.features.map((feature) => [feature.bit, feature.id]),
    [
      [0x01, "core-video"],
      [0x02, "explicit-silence"],
      [0x04, "particle-events"],
      [0x08, "seek-index"],
      [0x10, "canonical-assets"],
      [0x20, "raw-deflate-storage"],
      [0x40, "opus-audio-runs"],
      [0x80, "subtitle-mask-planes"]
    ]
  );
  assert.deepEqual(
    V1_REGISTRY.chunks.map((chunk) => chunk.type),
    ["VFRM", "RPTF", "AURN", "SILN", "SUBT", "PLIT", "META", "INDX"]
  );
});

test("base proof files satisfy required core-video, index, and asset declarations", () => {
  const demuxed = demuxV64(build());
  const result = validateV1Registry(demuxed);
  assert.equal(demuxed.header.featureFlags, 0x19);
  assert.equal(result.valid, true);
  assert.equal(result.chunkCounts.VFRM, 1);
  assert.equal(result.chunkCounts.RPTF, 1);
  assert.equal(result.chunkCounts.INDX, 1);
  assert.deepEqual(
    result.featureResults.filter((feature) => feature.declared).map((feature) => feature.bit),
    [0x01, 0x08, 0x10]
  );
});

test("SILN, PLIT, and DEFLATE feature declarations exactly follow their storage", () => {
  const silence = demuxV64(build([
    makeChunk("SILN", 0, 2500, Buffer.alloc(0), { compress: false })
  ]));
  assert.equal(Boolean(silence.header.featureFlags & 0x02), true);
  assert.equal(validateV1Registry(silence).chunkCounts.SILN, 1);

  const particlePayload = encodeParticleEvents([{
    classId: 1,
    color: 2,
    x: 100,
    y: 200,
    intensity: 80,
    radius: 12,
    lifetimeTicks: 2500,
    direction: 0,
    spread: 128,
    seed: 1234
  }]);
  const particles = demuxV64(build([
    makeChunk("PLIT", 0, 2500, particlePayload, { compress: false })
  ]));
  assert.equal(Boolean(particles.header.featureFlags & 0x04), true);
  assert.equal(validateV1Registry(particles).chunkCounts.PLIT, 1);

  const compressed = demuxV64(build([
    makeChunk("META", 0, 0, Buffer.alloc(512, 65))
  ]));
  assert.equal(Boolean(compressed.header.featureFlags & 0x20), true);
  assert.equal(compressed.chunks.some((chunk) => chunk.flags & 2), true);
  assert.equal(validateV1Registry(compressed).valid, true);
});

test("required and presence-bound feature mismatches fail closed", () => {
  const base = demuxV64(build());
  for (const bit of [0x01, 0x08, 0x10]) {
    assert.throws(
      () => validateV1Registry(cloneDemuxed(base, {
        featureFlags: base.header.featureFlags & ~bit
      })),
      /Required V1 feature bits are missing/
    );
  }

  for (const bit of [0x02, 0x04, 0x20, 0x40, 0x80]) {
    assert.throws(
      () => validateV1Registry(cloneDemuxed(base, {
        featureFlags: base.header.featureFlags | bit
      })),
      /declaration and bound presence disagree/
    );
  }

  const withSilence = demuxV64(build([
    makeChunk("SILN", 0, 2500, Buffer.alloc(0), { compress: false })
  ]));
  assert.throws(
    () => validateV1Registry(cloneDemuxed(withSilence, {
      featureFlags: withSilence.header.featureFlags & ~0x02
    })),
    /explicit-silence declaration and bound presence disagree/
  );
});

test("registry cardinality, final-index, and known-demuxed-chunk rules fail closed", () => {
  const base = demuxV64(build());
  const withoutVideo = base.chunks.filter((chunk) => chunk.type !== "VFRM");
  assert.throws(
    () => validateV1Registry(cloneDemuxed(base, { chunks: withoutVideo })),
    /VFRM is below its V1 minimum cardinality/
  );

  const duplicateIndex = [...base.chunks, { ...base.chunks.at(-1) }];
  assert.throws(
    () => validateV1Registry(cloneDemuxed(base, { chunks: duplicateIndex })),
    /INDX exceeds its V1 maximum cardinality/
  );

  const indexFirst = [base.chunks.at(-1), ...base.chunks.slice(0, -1)];
  assert.throws(
    () => validateV1Registry(cloneDemuxed(base, { chunks: indexFirst })),
    /INDX must be the final V1 chunk/
  );

  assert.throws(
    () => validateV1Registry(cloneDemuxed(base, {
      chunks: [...base.chunks.slice(0, -1), {
        type: "FAKE",
        flags: 1,
        timestamp: 0,
        duration: 0,
        payload: Buffer.alloc(0)
      }, base.chunks.at(-1)]
    })),
    /absent from the V1 registry/
  );
});

test("unknown lowercase optional chunks are skipped while uppercase chunks remain mandatory", () => {
  const optional = demuxV64(build([
    makeChunk("note", 0, 0, Buffer.from("optional"), { compress: false })
  ]));
  assert.equal(optional.chunks.some((chunk) => chunk.type === "note"), false);
  assert.equal(validateV1Registry(optional).valid, true);

  const mandatory = Buffer.from(build());
  mandatory.write("BORK", 128, 4, "ascii");
  assert.throws(() => demuxV64(mandatory), /Unknown mandatory chunk BORK/);
});
