import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  generateHyperRealCandidate5APalette,
  generateHyperRealCandidate5BPalette
} from "../../tools/hyperreal-candidate-5-generator.mjs";

const DEFINITIONS = Object.freeze([
  {
    id: "V64-P256-CANDIDATE-1",
    rgb: "../../assets/palettes/v64-p256-candidate-1.rgb",
    json: "../../assets/palettes/v64-p256-candidate-1.json"
  },
  {
    id: "V64-P256-HYPERREAL-CANDIDATE-2",
    rgb: "../../assets/palettes/v64-p256-hyperreal-candidate-2.rgb",
    json: "../../assets/palettes/v64-p256-hyperreal-candidate-2.json"
  },
  {
    id: "V64-P256-HYPERREAL-CANDIDATE-3",
    json: "../../assets/palettes/v64-p256-hyperreal-candidate-3.json"
  },
  {
    id: "V64-P256-HYPERREAL-CANDIDATE-4",
    json: "../../assets/palettes/v64-p256-hyperreal-candidate-4.json"
  },
  {
    id: "V64-P256-HYPERREAL-CANDIDATE-5A",
    json: "../../assets/palettes/v64-p256-hyperreal-candidate-5a.json",
    generate: generateHyperRealCandidate5APalette
  },
  {
    id: "V64-P256-HYPERREAL-CANDIDATE-5B",
    json: "../../assets/palettes/v64-p256-hyperreal-candidate-5b.json",
    generate: generateHyperRealCandidate5BPalette
  }
]);

function paletteBytesFromColors(colors, definition) {
  if (!Array.isArray(colors) || colors.length !== 256 ||
      colors.some((color) =>
        !Array.isArray(color) || color.length !== 3 ||
        color.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255))) {
    throw new Error(`Invalid generated V64 palette colors ${definition.id}`);
  }
  return Buffer.from(colors.flat());
}

function inlinePaletteBytes(metadata, definition) {
  return paletteBytesFromColors(metadata.colors, definition);
}

function load(definition) {
  const metadata = JSON.parse(readFileSync(new URL(definition.json, import.meta.url), "utf8"));
  const generatedColors = definition.generate ? definition.generate() : null;
  const bytes = definition.rgb
    ? readFileSync(new URL(definition.rgb, import.meta.url))
    : generatedColors
      ? paletteBytesFromColors(generatedColors, definition)
      : inlinePaletteBytes(metadata, definition);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== 768 ||
      (!generatedColors && metadata.colors?.length !== 256) ||
      metadata.id !== definition.id || metadata.sha256 !== sha256) {
    throw new Error(`Invalid registered V64 palette ${definition.id}`);
  }
  if (generatedColors && metadata.generatedColors !== true) {
    throw new Error(`Generated palette metadata is not explicit for ${definition.id}`);
  }
  return Object.freeze({
    id: definition.id,
    sha256,
    metadata: Object.freeze(metadata),
    bytes: Buffer.from(bytes),
    colors: Object.freeze(Array.from({ length: 256 }, (_, index) =>
      Object.freeze([...bytes.subarray(index * 3, index * 3 + 3)])))
  });
}

const PALETTES = Object.freeze(Object.fromEntries(
  DEFINITIONS.map((definition) => [definition.id, load(definition)])
));

export const PALETTE_ASSET_IDS = Object.freeze(Object.keys(PALETTES));

export function paletteAssetFromId(id = "V64-P256-CANDIDATE-1") {
  const palette = PALETTES[id];
  if (!palette) throw new RangeError(`Unknown V64 palette asset ${id}`);
  return palette;
}
