# Video64 Drop

This directory contains the deterministic Video64 Drop application core and
headless Linux entry point used by the native desktop shell. It orchestrates the
existing verified V64 proof encoder and decoder rather than duplicating codec
logic.

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
- bounded disk-spooled long-form source-audio processing;
- deterministic sampled output-size estimation;
- source-versus-decoded-V64 preview images rendered through the actual decoder;
- deterministic audiovisual remuxing and final V64 verification;
- actionable failure state and machine-readable progress events.

## Sampled size estimation

The `estimate` command creates short video-only proof encodes at deterministic
positions across the source. The default plan uses three two-second samples at
the start, middle, and end. Short sources automatically collapse duplicate
sample offsets.

Each sample is encoded with the selected real Video 64 settings. A fixed
container-overhead allowance is removed from each short sample before its video
rate is extrapolated, then added once to the final estimate. Sources with audio
also include the current provisional AM1 nominal rate.

The result contains the sampled minimum, median, and maximum video rates, a
central byte estimate, and an observed-rate envelope with a conservative upper
margin. It is explicitly advisory. The range is not a statistical confidence
interval, and exact post-encode verification remains authoritative.

## Decoded preview

The `preview` command uses the same deterministic sample plan. It extracts the
representative middle source frame with the encoder's contain-and-pad geometry,
decodes the corresponding sampled `.v64` through the real container decoder and
canonical renderer, and writes:

- `source.ppm`;
- `decoded-v64.ppm`;
- `comparison.ppm`, with source on the left and decoded V64 on the right;
- `preview.json`, containing settings, sample hashes, estimate data, dimensions,
  paths, and preview hashes.

PPM is used for the evidence surface because it is simple, lossless, and
deterministic. Desktop presentation can convert or upload these images without
changing the checked preview pixels.

## AM1 status

Ordinary audiovisual inputs produce audiovisual `.v64` files. The first audio
stream is converted to mono 48 kHz PCM16 and aligned exactly to the encoded
video duration. Long silence is represented by `SILN`; audible spans are encoded
into standard Opus packets carried by `AURN` chunks.

The current profile is identified as `AM1-PROVISIONAL-8K`: constrained VBR,
8 kbps, 20 ms packets, with individual audible runs bounded to 60 seconds. It is
explicitly `normative: false`. Genuine blinded speech listening remains
mandatory before this bitrate can freeze.

Production encoding no longer buffers the complete PCM recording in memory.
FFmpeg writes exact-duration PCM to a temporary disk spool. A first pass scans
that file in fixed-size reads using the same checked hysteretic silence detector;
a second pass reads and encodes only one bounded audible run at a time. The
default source-PCM buffer bound is 5,760,000 bytes, the size of one 60-second
mono 48 kHz PCM16 run. Temporary disk use is approximately 96,000 bytes per
second of source duration.

A permanent sparse-file gate processes 47 minutes / 270,720,000 PCM bytes,
beyond the former 256 MiB ceiling, in 259 scan reads while keeping source-PCM
buffers below 6 MiB. The small in-memory helper remains available only for
fixtures and focused tests and retains its explicit 256 MiB ceiling.

Sources without audio retain an explicit skipped audio stage and produce valid
video-only output.

## Headless use

```bash
node apps/video64-drop/cli.mjs inspect input.mp4
node apps/video64-drop/cli.mjs estimate input.mp4 \
  --fps 24 --columns 80 --palette 32 --glyphs 32 --profile balanced
node apps/video64-drop/cli.mjs preview input.mp4 preview-output \
  --fps 24 --columns 80 --palette 32 --glyphs 32 --profile balanced
node apps/video64-drop/cli.mjs encode input.mp4 output.v64 \
  --fps 24 --columns 80 --palette 32 --glyphs 32 --profile balanced
```

Use `--sample-seconds` and `--sample-count` to change the advisory sampling
budget. Progress events from `encode` are written as newline-delimited JSON to
standard error. Completed command documents are written to standard output.

## Remaining product boundary

The application core and CLI now provide sampled estimation and decoded preview,
but the SDL2 shell does not yet present them interactively. The AM1 bitrate is
not frozen. Particle Lighting controls, active-job cancellation, a bundled
runtime, desktop file selection, and an installable Linux package remain later
tranches. The disk-spooled implementation is not a one-pass live-capture
encoder.

## Test

```bash
npm --prefix apps/video64-drop test
```
