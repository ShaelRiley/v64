import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HYPERREAL_ANCHORS = Object.freeze([
  [0, 0, 0],
  [255, 255, 255],
  [255, 31, 45],
  [255, 122, 0],
  [255, 225, 0],
  [23, 212, 91],
  [0, 214, 217],
  [22, 119, 255],
  [122, 44, 255],
  [255, 33, 168],
  [123, 75, 42],
  [240, 200, 160]
]);

const CANDIDATE_2_NEUTRAL_COMPLETION = Object.freeze([
  [32, 32, 32],
  [96, 96, 96],
  [160, 160, 160],
  [224, 224, 224]
]);

export const HYPERREAL_CANDIDATE_3_UTILITY = Object.freeze([
  [16, 32, 72],
  [0, 92, 96],
  [178, 112, 72],
  [112, 112, 112]
]);

export const HYPERREAL_CANDIDATE_3_PREFIX = Object.freeze([
  ...HYPERREAL_ANCHORS,
  ...HYPERREAL_CANDIDATE_3_UTILITY
]);

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}

export function hyperRealGrade([r, g, b]) {
  const luminance = clamp(Math.round(r * 0.299 + g * 0.587 + b * 0.114));
  return [r, g, b].map((channel) =>
    Math.round(clamp((luminance + (channel - luminance) * 1.60 - 128) * 1.12 + 128))
  );
}

function srgbToLinear(value) {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgbToOklab([r8, g8, b8]) {
  const r = srgbToLinear(r8);
  const g = srgbToLinear(g8);
  const b = srgbToLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

function distanceSquared(a, b) {
  const lightness = (a[0] - b[0]) * 1.1;
  const greenRed = a[1] - b[1];
  const blueYellow = a[2] - b[2];
  return lightness * lightness + greenRed * greenRed + blueYellow * blueYellow;
}

function unique(colors) {
  const seen = new Set();
  return colors.filter((color) => {
    const key = color.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generatePaletteFromPrefix(prefix) {
  const selected = unique(prefix.map((color) => [...color]));
  const selectedKeys = new Set(selected.map((color) => color.join(",")));
  const candidates = unique(Array.from({ length: 16 ** 3 }, (_, index) => {
    const r = Math.floor(index / 256) * 17;
    const g = Math.floor(index / 16) % 16 * 17;
    const b = index % 16 * 17;
    return hyperRealGrade([r, g, b]);
  })).map((rgb) => ({
    rgb,
    lab: rgbToOklab(rgb),
    minimumDistance: Number.POSITIVE_INFINITY
  }));
  for (const color of selected) {
    const lab = rgbToOklab(color);
    for (const candidate of candidates) {
      candidate.minimumDistance = Math.min(
        candidate.minimumDistance,
        distanceSquared(candidate.lab, lab)
      );
    }
  }
  while (selected.length < 256) {
    let best = null;
    for (const candidate of candidates) {
      if (selectedKeys.has(candidate.rgb.join(","))) continue;
      if (!best ||
          candidate.minimumDistance > best.minimumDistance + 1e-15 ||
          (Math.abs(candidate.minimumDistance - best.minimumDistance) <= 1e-15 &&
            candidate.rgb.join(",") < best.rgb.join(","))) {
        best = candidate;
      }
    }
    if (!best) throw new Error("Hyper Real palette candidate space exhausted");
    selected.push([...best.rgb]);
    selectedKeys.add(best.rgb.join(","));
    for (const candidate of candidates) {
      candidate.minimumDistance = Math.min(
        candidate.minimumDistance,
        distanceSquared(candidate.lab, best.lab)
      );
    }
  }
  return selected;
}

export function generateHyperRealMasterPalette() {
  return generatePaletteFromPrefix([
    ...HYPERREAL_ANCHORS,
    ...CANDIDATE_2_NEUTRAL_COMPLETION
  ]);
}

export function generateHyperRealCandidate3Palette() {
  return generatePaletteFromPrefix(HYPERREAL_CANDIDATE_3_PREFIX);
}

export function paletteBytes(palette) {
  return Buffer.from(palette.flat());
}

export function paletteHash(palette) {
  return createHash("sha256").update(paletteBytes(palette)).digest("hex");
}

function sourceMetadata() {
  return {
    repository: "ShaelRiley/ansi-tube",
    file: "core.js",
    blobSha: "29fd2065612454a66a92e431213731c41d5dc28c",
    palette: "hyperreal",
    anchorsSha256: createHash("sha256")
      .update(Buffer.from(HYPERREAL_ANCHORS.flat()))
      .digest("hex"),
    saturationGrade: 1.60,
    contrastGrade: 1.12
  };
}

function writePalette(outputDirectory, fileStem, metadata) {
  const bytes = paletteBytes(metadata.colors);
  writeFileSync(resolve(outputDirectory, `${fileStem}.rgb`), bytes);
  writeFileSync(resolve(outputDirectory, `${fileStem}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
  return { id: metadata.id, sha256: metadata.sha256, bytes: bytes.length };
}

export function writeHyperRealPaletteAssets(outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const candidate2 = generateHyperRealMasterPalette();
  const candidate3 = generateHyperRealCandidate3Palette();
  const sharedSource = sourceMetadata();
  const result2 = writePalette(outputDirectory, "v64-p256-hyperreal-candidate-2", {
    id: "V64-P256-HYPERREAL-CANDIDATE-2",
    status: "experimental-candidate",
    source: sharedSource,
    generation: "exact Hyper Real anchors, four neutral completions, then ordered OKLab farthest-point sampling over the Hyper Real-graded 16^3 sRGB lattice",
    sha256: paletteHash(candidate2),
    colors: candidate2
  });
  const result3 = writePalette(outputDirectory, "v64-p256-hyperreal-candidate-3", {
    id: "V64-P256-HYPERREAL-CANDIDATE-3",
    status: "experimental-candidate",
    source: sharedSource,
    prefix: {
      sha256: createHash("sha256")
        .update(Buffer.from(HYPERREAL_CANDIDATE_3_PREFIX.flat()))
        .digest("hex"),
      rationale: "Exact twelve Hyper Real anchors plus dark navy, dark teal, warm skin midtone, and neutral midtone utility colors."
    },
    generation: "candidate-3 prefix, then ordered OKLab farthest-point sampling over the Hyper Real-graded 16^3 sRGB lattice",
    sha256: paletteHash(candidate3),
    colors: candidate3
  });
  return {
    format: "V64-HYPERREAL-PALETTE-BUILD-1",
    anchorsSha256: sharedSource.anchorsSha256,
    candidates: [result2, result3]
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] || new URL("../assets/palettes", import.meta.url).pathname);
  console.log(JSON.stringify(writeHyperRealPaletteAssets(output), null, 2));
}
