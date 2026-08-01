# V64 encoder profile metadata

Status: checked JavaScript proof-profile metadata

## Purpose

Video 64 retains a canonical 64-glyph source alphabet and the `.v64` file
extension. The encoder now uses 32 glyphs as its primary/default optimization
budget, with 64 glyphs available as an explicit full-alphabet option.

The binary header continues to identify the canonical 64-glyph asset. Encoder
choice is recorded separately in an optional `META` chunk so existing files and
decoders remain compatible.

## Record format

The profile is deterministic UTF-8 JSON with format identifier:

`V64-ENCODER-PROFILE-1`

A canonical record contains:

- `project`: `Video 64`;
- `extension`: `.v64`;
- `sourceAlphabetGlyphs`: `64`;
- `glyphCount`: `32` or `64`;
- `targetMode`: `compact`, `balanced`, or `quality`;
- cadence label and cadence identifier;
- scene-cut-aware group policy;
- maximum group duration of 120,000 timeline ticks, or two seconds;
- cadence-derived maximum frame count;
- dictionary-selection state.

The ordinary encoder emits exactly one record. `v64 inspect` and `v64 verify`
return the decoded profile as `encoderProfile`.

## Compatibility

The record uses the already registered optional `META` chunk. Files without a
profile remain valid and report `encoderProfile: null`. This preserves existing
fixtures and third-party files.

The record does not redefine the glyph asset, command grammar, palette, or
container feature bits. It reports the encoder decision that produced the
ordinary glyph-video stream.

## Validation

Profile parsing rejects:

- glyph budgets other than 32 or 64;
- unknown target modes;
- malformed JSON or record identity;
- cadence-label and cadence-ID disagreement;
- group limits beyond the cadence-derived two-second ceiling;
- multiple encoder-profile records in one file.

Ordinary container verification remains independent of optional profile
inspection. This prevents optional metadata from changing legacy file validity,
while product and diagnostic tools can enforce stricter profile semantics.

## Current defaults

- primary glyph budget: 32;
- optional full-alphabet budget: 64;
- ordinary target: balanced;
- group maximum: two seconds derived from cadence;
- scene-cut-aware groups: enabled;
- dictionary selection: enabled.
