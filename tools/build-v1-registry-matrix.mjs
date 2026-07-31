#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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

const outputDirectory = resolve(process.argv[2] || "bench/generated/v1-registry");
mkdirSync(outputDirectory, { recursive: true });

const columns = 4;
const rows = 3;
const paletteDepthId = PALETTE_DEPTHS.indexOf(16);

function build(extra = []) {
  const video = encodeCellTimeline(
    [
      Buffer.alloc(columns * rows * 3),
      Buffer.alloc(columns * rows * 3)
    ],
    { columns, rows, cadenceId: 7, paletteDepthId, keyframeInterval: 24 }
  );
  return demuxV64(muxV64(
    { columns, rows, cadenceId: 7, paletteDepthId },
    [...video, ...extra]
  ));
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

const base = build();
const silence = build([
  makeChunk("SILN", 0, 2500, Buffer.alloc(0), { compress: false })
]);
const particle = build([
  makeChunk("PLIT", 0, 2500, encodeParticleEvents([{
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
  }]), { compress: false })
]);
const compressed = build([
  makeChunk("META", 0, 0, Buffer.alloc(512, 65))
]);

const scenarios = [
  { id: "valid-base", expected: "pass", value: base },
  { id: "valid-silence", expected: "pass", value: silence },
  { id: "valid-particle", expected: "pass", value: particle },
  { id: "valid-deflate", expected: "pass", value: compressed },
  ...[0x01, 0x08, 0x10].map((bit) => ({
    id: `missing-required-${bit.toString(16).padStart(2, "0")}`,
    expected: "fail",
    value: cloneDemuxed(base, { featureFlags: base.header.featureFlags & ~bit })
  })),
  ...[0x02, 0x04, 0x20, 0x40, 0x80].map((bit) => ({
    id: `stray-feature-${bit.toString(16).padStart(2, "0")}`,
    expected: "fail",
    value: cloneDemuxed(base, { featureFlags: base.header.featureFlags | bit })
  })),
  {
    id: "missing-silence-feature",
    expected: "fail",
    value: cloneDemuxed(silence, {
      featureFlags: silence.header.featureFlags & ~0x02
    })
  },
  {
    id: "missing-particle-feature",
    expected: "fail",
    value: cloneDemuxed(particle, {
      featureFlags: particle.header.featureFlags & ~0x04
    })
  },
  {
    id: "missing-deflate-feature",
    expected: "fail",
    value: cloneDemuxed(compressed, {
      featureFlags: compressed.header.featureFlags & ~0x20
    })
  },
  {
    id: "missing-vfrm",
    expected: "fail",
    value: cloneDemuxed(base, {
      chunks: base.chunks.filter((chunk) => chunk.type !== "VFRM")
    })
  },
  {
    id: "duplicate-index",
    expected: "fail",
    value: cloneDemuxed(base, {
      chunks: [...base.chunks, { ...base.chunks.at(-1) }]
    })
  },
  {
    id: "index-not-final",
    expected: "fail",
    value: cloneDemuxed(base, {
      chunks: [base.chunks.at(-1), ...base.chunks.slice(0, -1)]
    })
  }
];

const results = scenarios.map((scenario) => {
  try {
    const result = validateV1Registry(scenario.value);
    return {
      id: scenario.id,
      expected: scenario.expected,
      observed: "pass",
      matched: scenario.expected === "pass",
      featureFlags: scenario.value.header.featureFlags,
      featureResults: result.featureResults,
      chunkCounts: result.chunkCounts
    };
  } catch (error) {
    return {
      id: scenario.id,
      expected: scenario.expected,
      observed: "fail",
      matched: scenario.expected === "fail",
      featureFlags: scenario.value.header.featureFlags,
      message: error.message
    };
  }
});
assert.ok(results.every((result) => result.matched));

const registryBytes = readFileSync(
  new URL("../spec/v64-v1-registry.json", import.meta.url)
);
const matrix = {
  format: "V64-V1-REGISTRY-MATRIX-1",
  registryFormat: V1_REGISTRY.format,
  registryBytes: registryBytes.length,
  registrySha256: createHash("sha256").update(registryBytes).digest("hex"),
  knownFeatureMask: V1_REGISTRY.knownFeatureMask,
  requiredFeatureMask: V1_REGISTRY.requiredFeatureMask,
  featureCount: V1_REGISTRY.features.length,
  chunkCount: V1_REGISTRY.chunks.length,
  scenarios: results.length,
  passedExpectations: results.filter((result) => result.matched).length,
  results
};

writeFileSync(
  resolve(outputDirectory, "matrix.json"),
  `${JSON.stringify(matrix, null, 2)}\n`
);
console.log(JSON.stringify({
  format: matrix.format,
  registrySha256: matrix.registrySha256,
  scenarios: matrix.scenarios,
  passedExpectations: matrix.passedExpectations
}, null, 2));
