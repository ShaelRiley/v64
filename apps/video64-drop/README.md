# Video64 Drop

This directory contains the deterministic Video64 Drop application core and
headless Linux entry point used by the native desktop shell. It orchestrates the
existing verified V64 proof encoder rather than duplicating codec logic.

The application core provides:

- normative defaults of 24 fps, 80 columns, 32 colors, 32 glyphs, and the
  `balanced` profile;
- stable source probing, aspect-aware row derivation, and collision-safe output
  naming;
- an immutable queue/job model with deduplication;
- explicit analysis, video encode, audio encode, mux, and verification stages;
- real invocation of the existing V64 video encoder;
- provisional AM1 source-audio encoding as mono 48 kHz constrained-VBR Opus;
- exact `SILN` spans for qualifying long silence;
- bounded `AURN` runs for audible source regions;
- deterministic audiovisual remuxing and final V64 verification;
- actionable failure state and machine-readable progress events.

## AM1 status

Ordinary audiovisual inputs now produce audiovisual `.v64` files. The first
audio stream is converted to mono 48 kHz PCM16 and aligned exactly to the
encoded video duration. Long silence is represented by `SILN`; audible spans
are encoded into standard Opus packets carried by `AURN` chunks.

The current profile is identified as `AM1-PROVISIONAL-8K`: constrained VBR,
8 kbps, 20 ms packets, with individual audible runs bounded to 60 seconds. It is
explicitly `normative: false`. Genuine blinded speech listening remains
mandatory before this bitrate can freeze.

Sources without audio retain an explicit skipped audio stage and produce valid
video-only output.

## Headless use

```bash
node apps/video64-drop/cli.mjs inspect input.mp4
node apps/video64-drop/cli.mjs encode input.mp4 output.v64 \
  --fps 24 --columns 80 --palette 32 --glyphs 32 --profile balanced
```

Progress events are written as newline-delimited JSON to standard error. The
completed job document is written to standard output.

## Remaining product boundary

Decoded source/V64 preview, sampled size estimation, Particle Lighting controls,
active-job cancellation, a bundled runtime, desktop file selection, and an
installable Linux package remain later tranches.

## Test

```bash
npm --prefix apps/video64-drop test
```
