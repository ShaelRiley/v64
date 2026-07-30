import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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
  }
]);

function load(definition) {
  const bytes = readFileSync(new URL(definition.rgb, import.meta.url));
  const metadata = JSON.parse(readFileSync(new URL(definition.json, import.meta.url), "utf8"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== 768 || metadata.colors?.length !== 256 ||
      metadata.id !== definition.id || metadata.sha256 !== sha256) {
    throw new Error(`Invalid registered V64 palette ${definition.id}`);
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
