import { readFileSync } from "node:fs";
import { demuxV64, verifyV64 } from "./container.mjs";

const registryUrl = new URL("../../spec/v64-v1-registry.json", import.meta.url);
export const V1_REGISTRY = Object.freeze(
  JSON.parse(readFileSync(registryUrl, "utf8"))
);

function countChunks(chunks) {
  const counts = new Map();
  for (const chunk of chunks) {
    counts.set(chunk.type, (counts.get(chunk.type) || 0) + 1);
  }
  return counts;
}

function featureBindingPresent(feature, chunks) {
  const binding = feature.binding;
  if (binding.kind === "header-only") return true;
  if (binding.kind === "chunk-presence") {
    return binding.chunks.some((type) => chunks.some((chunk) => chunk.type === type));
  }
  if (binding.kind === "chunk-storage-flag") {
    return chunks.some((chunk) => Boolean(chunk.flags & binding.flag));
  }
  throw new Error(`Unknown registry binding kind ${binding.kind}`);
}

export function validateV1Registry(demuxed, registry = V1_REGISTRY) {
  if (!demuxed?.header || !Array.isArray(demuxed.chunks)) {
    throw new TypeError("V1 registry validation requires a demuxed V64 file");
  }
  if (registry.format !== "V64-V1-REGISTRY-1" ||
      registry.containerVersion !== demuxed.header.version) {
    throw new Error("V1 registry and container version disagree");
  }
  const flags = demuxed.header.featureFlags;
  if (flags & ~registry.knownFeatureMask) {
    throw new Error("Unknown mandatory feature bits under the V1 registry");
  }
  if ((flags & registry.requiredFeatureMask) !== registry.requiredFeatureMask) {
    throw new Error("Required V1 feature bits are missing");
  }

  const counts = countChunks(demuxed.chunks);
  const knownTypes = new Set(registry.chunks.map((chunk) => chunk.type));
  for (const chunk of demuxed.chunks) {
    if (!knownTypes.has(chunk.type)) {
      throw new Error(`Demuxed chunk ${chunk.type} is absent from the V1 registry`);
    }
  }

  for (const declaration of registry.chunks) {
    const count = counts.get(declaration.type) || 0;
    if (count < declaration.minimum) {
      throw new Error(`${declaration.type} is below its V1 minimum cardinality`);
    }
    if (declaration.maximum !== null && count > declaration.maximum) {
      throw new Error(`${declaration.type} exceeds its V1 maximum cardinality`);
    }
    if (declaration.mustBeLast && count) {
      const last = demuxed.chunks.at(-1);
      if (last?.type !== declaration.type) {
        throw new Error(`${declaration.type} must be the final V1 chunk`);
      }
    }
  }

  const featureResults = [];
  for (const feature of registry.features) {
    const declared = Boolean(flags & feature.bit);
    const present = featureBindingPresent(feature, demuxed.chunks);
    if (feature.required && !declared) {
      throw new Error(`Required V1 feature ${feature.id} is not declared`);
    }
    if (feature.binding.kind !== "header-only" && declared !== present) {
      throw new Error(
        `V1 feature ${feature.id} declaration and bound presence disagree`
      );
    }
    featureResults.push({
      bit: feature.bit,
      id: feature.id,
      declared,
      present
    });
  }

  return {
    valid: true,
    format: registry.format,
    version: registry.containerVersion,
    knownFeatureMask: registry.knownFeatureMask,
    requiredFeatureMask: registry.requiredFeatureMask,
    featureResults,
    chunkCounts: Object.fromEntries(
      registry.chunks.map((chunk) => [chunk.type, counts.get(chunk.type) || 0])
    )
  };
}

export function verifyV1File(input, registry = V1_REGISTRY) {
  const bytes = Buffer.from(input);
  const codec = verifyV64(bytes);
  const declarations = validateV1Registry(demuxV64(bytes), registry);
  return {
    ...codec,
    registry: declarations
  };
}
