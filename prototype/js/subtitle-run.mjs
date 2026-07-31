import { decodeSubtitleMaskSequence } from "./subtitle-mask-sm2.mjs";

export const SUBT_FEATURE_FLAG = 0x80;

function assertHeader(header) {
  if (!header || !Number.isInteger(header.columns) || !Number.isInteger(header.rows) ||
      !Number.isInteger(header.paletteDepth) || !Number.isInteger(header.duration) ||
      !Number.isInteger(header.cadence?.frameTicks) || header.cadence.frameTicks < 1) {
    throw new TypeError("SUBT validation requires a parsed V64 header");
  }
}

export function validateSubtChunk(chunk, header) {
  assertHeader(header);
  if (!chunk || chunk.type !== "SUBT") throw new TypeError("SUBT validator requires a SUBT chunk");
  const frameTicks = header.cadence.frameTicks;
  if (!Number.isSafeInteger(chunk.timestamp) || chunk.timestamp < 0 ||
      !Number.isSafeInteger(chunk.duration) || chunk.duration < 1) {
    throw new RangeError("SUBT timestamp or duration is out of range");
  }
  if (chunk.timestamp % frameTicks || chunk.duration % frameTicks) {
    throw new Error("SUBT timestamp and duration must be whole nominal frame spans");
  }
  const endTimestamp = chunk.timestamp + chunk.duration;
  if (!Number.isSafeInteger(endTimestamp) || endTimestamp > header.duration) {
    throw new Error("SUBT chunk exceeds the declared file duration");
  }

  const sequence = decodeSubtitleMaskSequence(chunk.payload);
  const expectedCells = header.columns * header.rows;
  const expectedFrames = chunk.duration / frameTicks;
  if (sequence.cellCount !== expectedCells) {
    throw new Error("SUBT cell count disagrees with the V64 grid");
  }
  if (sequence.paletteDepth !== header.paletteDepth) {
    throw new Error("SUBT palette depth disagrees with the V64 header");
  }
  if (sequence.frameCount !== expectedFrames) {
    throw new Error("SUBT frame count disagrees with chunk duration");
  }

  return {
    timestamp: chunk.timestamp,
    duration: chunk.duration,
    endTimestamp,
    frameCount: sequence.frameCount,
    cellCount: sequence.cellCount,
    paletteDepth: sequence.paletteDepth,
    sequence
  };
}

export function validateSubtitleTimeline(demuxed) {
  if (!demuxed?.header || !Array.isArray(demuxed.chunks)) {
    throw new TypeError("SUBT timeline validation requires a demuxed V64 file");
  }
  const chunks = demuxed.chunks.filter((chunk) => chunk.type === "SUBT");
  const featureDeclared = Boolean(demuxed.header.featureFlags & SUBT_FEATURE_FLAG);
  if (featureDeclared !== Boolean(chunks.length)) {
    throw new Error("SUBT feature flag and chunk presence disagree");
  }
  if (!chunks.length) return null;

  const validated = chunks
    .map((chunk) => validateSubtChunk(chunk, demuxed.header))
    .sort((a, b) => a.timestamp - b.timestamp || a.endTimestamp - b.endTimestamp);
  let previousEnd = -1;
  for (const item of validated) {
    if (item.timestamp < previousEnd) throw new Error("SUBT chunks overlap");
    previousEnd = item.endTimestamp;
  }

  return {
    chunks: validated,
    frameCount: validated.reduce((sum, item) => sum + item.frameCount, 0),
    firstTimestamp: validated[0].timestamp,
    lastTimestamp: validated[validated.length - 1].endTimestamp
  };
}
