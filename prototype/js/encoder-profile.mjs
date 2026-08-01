import { cadenceFromId } from "./constants.mjs";
import {
  VIDEO64_DEFAULT_GLYPH_COUNT,
  primaryGlyphCountFromValue
} from "./glyph-subset.mjs";

export const ENCODER_PROFILE_FORMAT = "V64-ENCODER-PROFILE-1";
export const ENCODER_PROFILE_TARGETS = Object.freeze(["compact", "balanced", "quality"]);
const TWO_SECONDS_TICKS = 120_000;

function checkedTarget(value = "balanced") {
  const target = String(value).trim().toLowerCase();
  if (!ENCODER_PROFILE_TARGETS.includes(target)) {
    throw new RangeError(
      `Encoder target must be ${ENCODER_PROFILE_TARGETS.join(", ")}`
    );
  }
  return target;
}

function twoSecondFrames(cadenceId) {
  const cadence = cadenceFromId(cadenceId);
  return Math.max(1, Math.floor(TWO_SECONDS_TICKS / cadence.frameTicks));
}

function canonicalDocument(input = {}) {
  const cadenceId = Number(input.cadenceId);
  const cadence = cadenceFromId(cadenceId);
  const maximumGroupFrames = Number(
    input.maximumGroupFrames ?? twoSecondFrames(cadenceId)
  );
  if (!Number.isInteger(maximumGroupFrames) || maximumGroupFrames < 1 ||
      maximumGroupFrames > twoSecondFrames(cadenceId)) {
    throw new RangeError("Encoder profile group frames exceed the two-second cadence bound");
  }
  return {
    format: ENCODER_PROFILE_FORMAT,
    project: "Video 64",
    extension: ".v64",
    sourceAlphabetGlyphs: 64,
    glyphCount: primaryGlyphCountFromValue(
      input.glyphCount ?? VIDEO64_DEFAULT_GLYPH_COUNT
    ),
    targetMode: checkedTarget(input.targetMode),
    cadence: cadence.label,
    cadenceId: cadence.id,
    groupPolicy: {
      sceneCutAware: input.sceneCutAware !== false,
      maximumTicks: TWO_SECONDS_TICKS,
      maximumFrames: maximumGroupFrames
    },
    dictionary: input.dictionary !== false
  };
}

export function encodeEncoderProfilePayload(input = {}) {
  return Buffer.from(JSON.stringify(canonicalDocument(input)), "utf8");
}

export function decodeEncoderProfilePayload(payload) {
  let input;
  try {
    input = JSON.parse(Buffer.from(payload).toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid encoder profile JSON: ${error.message}`);
  }
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      input.format !== ENCODER_PROFILE_FORMAT || input.project !== "Video 64" ||
      input.extension !== ".v64" || input.sourceAlphabetGlyphs !== 64 ||
      !input.groupPolicy || typeof input.groupPolicy !== "object" ||
      input.groupPolicy.maximumTicks !== TWO_SECONDS_TICKS) {
    throw new Error("Invalid V64 encoder profile metadata");
  }
  const canonical = canonicalDocument({
    glyphCount: input.glyphCount,
    targetMode: input.targetMode,
    cadenceId: input.cadenceId,
    maximumGroupFrames: input.groupPolicy.maximumFrames,
    sceneCutAware: input.groupPolicy.sceneCutAware,
    dictionary: input.dictionary
  });
  if (input.cadence !== canonical.cadence) {
    throw new Error("Encoder profile cadence label disagrees with cadence id");
  }
  return Object.freeze({
    ...canonical,
    groupPolicy: Object.freeze({ ...canonical.groupPolicy })
  });
}

export function encoderProfileFromDemuxed(demuxed) {
  const profiles = [];
  for (const chunk of demuxed.chunks) {
    if (chunk.type !== "META") continue;
    let parsed;
    try {
      parsed = JSON.parse(chunk.payload.toString("utf8"));
    } catch {
      continue;
    }
    if (parsed?.format !== ENCODER_PROFILE_FORMAT) continue;
    profiles.push(decodeEncoderProfilePayload(chunk.payload));
  }
  if (profiles.length > 1) throw new Error("Multiple V64 encoder profile records");
  return profiles[0] ?? null;
}
