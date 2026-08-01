# Video64 Drop

This directory contains the first executable Video64 Drop application tranche:
a dependency-free, deterministic application core and headless Linux entry
point around the existing verified V64 proof encoder.

It establishes the contract that the later drag-and-drop desktop shell will use:

- normative defaults of 24 fps, 80 columns, 32 colors, 32 glyphs, and the
  `balanced` profile;
- stable source probing, aspect-aware row derivation, and output naming;
- an immutable queue/job model with deduplication;
- explicit analysis, video encode, audio encode, mux, and verification stages;
- real invocation of the existing V64 encoder rather than a duplicate codec;
- final V64 verification and actionable failure state;
- machine-readable progress events suitable for a desktop host.

## Current transitional boundary

The proof encoder used by this tranche is still video-only. When source audio is
present, Video64 Drop reports that fact, marks the audio stage as skipped, and
states that the resulting file is silent. It does not silently discard audio.
AM1 source-audio encoding, Particle Lighting, the sampled size estimator,
decoded preview, and the native drag-and-drop window are subsequent tranches.

## Headless use

```bash
node apps/video64-drop/cli.mjs inspect input.mp4
node apps/video64-drop/cli.mjs encode input.mp4 output.v64 \
  --fps 24 --columns 80 --palette 32 --glyphs 32 --profile balanced
```

Progress events are written as newline-delimited JSON to standard error. The
completed job document is written to standard output.

## Test

```bash
npm --prefix apps/video64-drop test
```
