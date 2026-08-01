import assert from "node:assert/strict";
import test from "node:test";
import { PALETTE_DEPTHS } from "../prototype/js/constants.mjs";
import {
  demuxV64,
  encodeCellTimeline,
  makeChunk,
  muxV64,
  verifyV64
} from "../prototype/js/container.mjs";
import {
  ENCODER_PROFILE_FORMAT,
  decodeEncoderProfilePayload,
  encodeEncoderProfilePayload,
  encoderProfileFromDemuxed
} from "../prototype/js/encoder-profile.mjs";

function oneCellFrames(count = 2) {
  return Array.from({ length: count }, (_, index) =>
    Buffer.from([index % 2 ? 1 : 0, 1, 0])
  );
}

function profiledFile(profile = {}) {
  const cadenceId = profile.cadenceId ?? 7;
  const paletteDepthId = PALETTE_DEPTHS.indexOf(2);
  const chunks = encodeCellTimeline(oneCellFrames(), {
    columns: 1,
    rows: 1,
    cadenceId,
    paletteDepthId,
    keyframeInterval: 48,
    useDictionary: true
  });
  chunks.push(makeChunk("META", 0, 0, encodeEncoderProfilePayload({
    glyphCount: profile.glyphCount ?? 32,
    targetMode: profile.targetMode ?? "balanced",
    cadenceId,
    maximumGroupFrames: profile.maximumGroupFrames ?? 48,
    sceneCutAware: profile.sceneCutAware ?? true,
    dictionary: profile.dictionary ?? true
  })));
  return muxV64({ columns: 1, rows: 1, cadenceId, paletteDepthId }, chunks);
}

test("encoder profile round-trips the primary 32-glyph policy", () => {
  const payload = encodeEncoderProfilePayload({
    glyphCount: 32,
    targetMode: "balanced",
    cadenceId: 7,
    maximumGroupFrames: 48,
    sceneCutAware: true,
    dictionary: true
  });
  const profile = decodeEncoderProfilePayload(payload);
  assert.equal(profile.format, ENCODER_PROFILE_FORMAT);
  assert.equal(profile.project, "Video 64");
  assert.equal(profile.extension, ".v64");
  assert.equal(profile.sourceAlphabetGlyphs, 64);
  assert.equal(profile.glyphCount, 32);
  assert.equal(profile.targetMode, "balanced");
  assert.equal(profile.groupPolicy.maximumTicks, 120000);
  assert.equal(profile.groupPolicy.maximumFrames, 48);
});

test("encoder profile supports the explicit 64-glyph option", () => {
  const profile = decodeEncoderProfilePayload(encodeEncoderProfilePayload({
    glyphCount: 64,
    targetMode: "quality",
    cadenceId: 7,
    maximumGroupFrames: 48
  }));
  assert.equal(profile.glyphCount, 64);
  assert.equal(profile.targetMode, "quality");
});

test("encoder profile rejects non-primary and overlong group declarations", () => {
  assert.throws(
    () => encodeEncoderProfilePayload({ glyphCount: 16, cadenceId: 7 }),
    /must be 32 or 64/
  );
  assert.throws(
    () => encodeEncoderProfilePayload({ glyphCount: 32, cadenceId: 5, maximumGroupFrames: 25 }),
    /exceed the two-second cadence bound/
  );
});

test("profile metadata survives ordinary mux, demux, and verification", () => {
  const file = profiledFile();
  const verified = verifyV64(file);
  assert.equal(verified.valid, true);
  const profile = encoderProfileFromDemuxed(demuxV64(file));
  assert.equal(profile.glyphCount, 32);
  assert.equal(profile.targetMode, "balanced");
  assert.equal(profile.cadence, "24");
  assert.equal(profile.groupPolicy.maximumFrames, 48);
});

test("files without an encoder profile remain valid and report null", () => {
  const cadenceId = 7;
  const paletteDepthId = PALETTE_DEPTHS.indexOf(2);
  const chunks = encodeCellTimeline(oneCellFrames(), {
    columns: 1,
    rows: 1,
    cadenceId,
    paletteDepthId,
    keyframeInterval: 48
  });
  const file = muxV64({ columns: 1, rows: 1, cadenceId, paletteDepthId }, chunks);
  assert.equal(verifyV64(file).valid, true);
  assert.equal(encoderProfileFromDemuxed(demuxV64(file)), null);
});

test("multiple encoder-profile records are rejected by profile inspection", () => {
  const cadenceId = 7;
  const paletteDepthId = PALETTE_DEPTHS.indexOf(2);
  const chunks = encodeCellTimeline(oneCellFrames(), {
    columns: 1,
    rows: 1,
    cadenceId,
    paletteDepthId,
    keyframeInterval: 48
  });
  const payload = encodeEncoderProfilePayload({
    glyphCount: 32,
    targetMode: "balanced",
    cadenceId,
    maximumGroupFrames: 48
  });
  chunks.push(makeChunk("META", 0, 0, payload));
  chunks.push(makeChunk("META", 0, 0, payload));
  const file = muxV64({ columns: 1, rows: 1, cadenceId, paletteDepthId }, chunks);
  assert.equal(verifyV64(file).valid, true);
  assert.throws(
    () => encoderProfileFromDemuxed(demuxV64(file)),
    /Multiple V64 encoder profile records/
  );
});

test("profile decoding rejects cadence-label disagreement and malformed JSON", () => {
  const valid = JSON.parse(encodeEncoderProfilePayload({
    glyphCount: 32,
    cadenceId: 7,
    maximumGroupFrames: 48
  }).toString("utf8"));
  valid.cadence = "12";
  assert.throws(
    () => decodeEncoderProfilePayload(Buffer.from(JSON.stringify(valid))),
    /cadence label disagrees/
  );
  assert.throws(
    () => decodeEncoderProfilePayload(Buffer.from("{")),
    /Invalid encoder profile JSON/
  );
});
