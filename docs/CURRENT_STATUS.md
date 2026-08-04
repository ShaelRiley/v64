# Video 64 current development status

Updated: 2026-08-03

This is the compact current-state companion to `IMPLEMENTATION_LEDGER.md`. The
ledger retains the complete historical evidence chain; this document records the
latest checked implementation and active frontier.

## Project invariants

- Project name: **Video 64**.
- File extension: `.v64`.
- Encoder application: **Video64 Drop**.
- License: MIT, SPDX `MIT`, Copyright (c) 2026 Shael Riley.
- Canonical source alphabet: exactly 64 original 8×16 glyphs.
- Primary/default encoder budget: 32 glyphs; 64 is the explicit full-alphabet
  option; 16 remains research-only.
- Legal cadences: 0.10, 0.5, 1, 3, 6, 12, 15, 24, 30, 48, and 60 fps; default
  24 fps.
- Default target: `balanced`.
- Maximum independently decodable group duration: two seconds, with shorter
  groups permitted at scene cuts.
- Normative palette: `V64-P256-1`.
- Human developers, AI-assisted developers, and autonomous agents may
  contribute under the same MIT terms; controlled release and security actions
  remain maintainer responsibilities.

## Public release state

Tag `v0.1.0-alpha.1` remains the first playable public Video 64 prerelease. It
contains the corrected portrait test video and Linux x86_64 base-video player.
The user successfully played it on SteamOS and confirmed orientation and
proportions.

That prerelease is intentionally silent and predates native player profile 2,
source-audio encoding, long-form source processing, and the current Video64 Drop
preview and estimation work. Its release manifest and checksums remain
unchanged and authoritative for those assets.

## Permanently gated codec and decoder state

The repository continuously checks:

- bounded header, chunk, index, CRC, and raw-DEFLATE parsing;
- complete Phase-1 and direct Grammar B frame-command decoding;
- exact 32-glyph primary and 64-glyph full-alphabet encoder profiles;
- cadence-derived two-second independent-group enforcement;
- JavaScript and Rust `SUBT`/SM2 and `AURN`/`SILN` validation;
- stable owning Rust decoder API version 1, bounded CLI, and pointer-free C ABI;
- deterministic canonical RGBA rendering and WebAssembly conformance;
- hostile-input, rollback, decompression, allocation, fuzz, renderer, stable
  API, CLI, and C ABI gates.

Raw DEFLATE remains the current entropy leader. Grammar B remains provisional
rather than a frozen V1 grammar decision.

## Native player profile 2

PR #9 added native subtitle and audio presentation. The standalone SDL2 player
composites validated subtitles, decodes `AURN` Opus packets, synthesizes exact
`SILN` zeros, enforces sample accounting, and supports deterministic seeking,
pause, EOF recovery, and 0.5×/1×/2× playback. CRT scanlines remain default-on,
persisted, and presentation-only.

The checked AM1 fixture decoded 54 Opus packets into 96,000 mono 48 kHz samples.
Native PCM matched the explicit libopus reference byte-for-byte with SHA-256
`d34fe310f0a9aa00f128d00ff7a8fa4b50d2e125d20347b83908e20bb25f89c0`.

## Feature-length synchronization evidence

PR #11 added the deterministic 30-minute player-clock gate. Its fixture contains
900 independently seekable groups, 43,200 nominal frames, 1,800 `AURN` runs,
1,800 exact `SILN` spans, 48,600 Opus packets, and 86,400,000 mono samples.
Duplicate accelerated runs reported zero accumulated tick drift, zero PCM
sample-index drift, exact EOF, stable distant seeks, stable recovery, and exact
pause and rate transitions. Peak resident memory was 176,464 KiB.

This proves deterministic decoded video, PCM timeline, and player-clock
alignment. It does not measure operating-system mixer latency, audio-device
oscillator error, or physical hardware scheduler drift.

## Video64 Drop application and Linux shell

PR #12 added the deterministic application core. PR #13 added the first
Linux/SteamOS Rust/SDL2 host. Together they provide:

- normative defaults and validation;
- FFprobe source analysis and aspect-aware grid derivation;
- deterministic collision-safe queue planning;
- startup file arguments and SDL file-drop events;
- cadence, columns, palette, 32/64-glyph, and profile controls;
- queue selection, encoding, retry, removal, and output-folder access;
- explicit analysis, video, audio, mux, verify, completion, and failure states;
- sequential background execution and independent final `.v64` verification;
- deterministic headless reports and a real SDL2/Xvfb window gate.

## AM1 source audio and bounded long-form processing

PR #14 connected ordinary source audio to Video64 Drop. The first audio stream
is converted to mono 48 kHz PCM16, aligned exactly to the V64 video duration,
segmented with the checked hysteretic silence detector, represented as exact
`SILN` spans and bounded `AURN` runs, remuxed, and independently verified.

The active profile is `AM1-PROVISIONAL-8K`: mono 48 kHz, constrained VBR,
8 kbps, and 20 ms packets. It remains `normative: false`; genuine blinded speech
listening is mandatory before the bitrate can freeze.

PR #15 replaced whole-file PCM buffering with bounded disk-spooled two-pass
processing. FFmpeg writes exact-duration PCM to temporary storage, pass one
scans it in fixed-size reads, and pass two reads at most one 60-second audible
run at a time. The default source-PCM buffer bound is 5,760,000 bytes. Temporary
disk use is approximately 96,000 bytes per source second.

The permanent long-form gate processed 47 minutes / 270,720,000 PCM bytes,
beyond the former 256 MiB ceiling, in 259 scan reads while keeping source-PCM
buffers under 6 MiB. This is bounded long-form file encoding, not a one-pass
live-capture encoder.

## Sampled size estimation and decoded preview

PR #16 adds the application-core and CLI tranche for advisory sampled size
estimation and source-versus-decoded-V64 preview.

The estimator:

- performs real two-second proof encodes at deterministic start, middle, and end
  offsets by default;
- collapses duplicate offsets for short sources;
- uses the selected cadence, columns, palette, glyph budget, and profile;
- removes one fixed short-file container allowance from each sample before rate
  extrapolation, then adds it once to the final estimate;
- adds the current provisional nominal AM1 rate when source audio is present;
- reports minimum, median, and maximum sampled video rates, a central estimate,
  and an observed-rate envelope with a conservative upper margin;
- marks the result advisory and explicitly requires exact post-encode
  verification.

The preview:

- extracts the representative source frame with the encoder's contain-and-pad
  geometry;
- decodes the corresponding sampled `.v64` through the real container decoder,
  canonical palette registry, and renderer;
- writes deterministic lossless `source.ppm`, `decoded-v64.ppm`, and a
  side-by-side `comparison.ppm` with source left and decoded V64 right;
- records sample and image hashes in `preview.json`.

### Checked preview and estimator evidence

All five workflows triggered on immutable code head
`fb59610c413d617f774a3c41093d7835952225a4` passed: application core, native
shell, conformance/visual, human raster, and combined grammar.

Permanent application workflow `30875362339` passed syntax checks, the expanded
focused test suite, the existing 47-minute streaming gate, deterministic repeated
preview generation, repeated sampled proof encodes, a complete audiovisual
encode, AM1 decode, and independent final verification.

The deterministic four-second H.264/AAC fixture used 24 fps, 40 columns, 16
colors, 32 glyphs, and `balanced`, producing a 40×11-cell / 320×176 V64 raster.
Its three two-second samples began at 0, 1, and 2 seconds and produced:

- 51,280, 52,648, and 56,160 variable video bits per second after the checked
  fixed-overhead adjustment;
- sample SHA-256 values
  `b4ca2e82e58b863398ee3149ab5543447b8d7177ddf18b1710fd8563f04557aa`,
  `e0399a5f8e40a8d55ec1723cb419710e75aacd127da8d76776fc7bdbc94839c8`,
  and `552dcda3ff66110beb4963090e1c4e23a56eb5f64c65959c440f72587538b164`;
- a central estimate of 31,348 bytes;
- an advisory envelope of 26,664 to 42,124 bytes;
- a final independently verified audiovisual size of 32,488 bytes;
- a measured central-estimate difference of approximately 3.51% on this single
  synthetic fixture. This is evaluation evidence, not a general accuracy claim.

The representative comparison image is 648×176 pixels with an eight-pixel gap.
Checked preview identities:

- source PPM SHA-256:
  `38dd1990bd81087004a59646ac0a5dd46ff990cbeb73b8e1447f11f52797b111`;
- decoded V64 PPM SHA-256:
  `ee75b165935f9743feb9d59f347524f99479171de4872578d9bd5a41b91d9e0a`;
- comparison PPM SHA-256:
  `9e06806b69368089183b787752cbcb2d11cba59170b926de9874b5d9d0a12687`;
- application evidence artifact: `8879349708`;
- artifact digest:
  `4590880a2310b4b2aa60a355606c9eb962603aab9b50dfd34a107d7bda381b2f`.

The SDL2 shell still reports interactive preview and estimator capabilities as
false. It continues to use the same adjacent application core for encoding, but
native controls and image presentation are a separate checked tranche.

## Boundaries not yet claimed

- Genuine blinded AM1 speech listening remains mandatory before the normative
  audio bitrate profile can freeze.
- Sampled estimates are advisory, content-dependent, and not statistical
  confidence intervals; exact final verification remains authoritative.
- The native SDL2 shell does not yet invoke or display the core preview and
  estimate outputs.
- Disk-spooled long-form encoding is not one-pass live capture and requires
  temporary storage proportional to source duration.
- Particle Lighting controls, active-job cancellation, a bundled Node runtime,
  desktop file selection, and an installable Linux package remain open.
- Operating-system and physical-device A/V drift remain platform qualification
  work.
- Fixed 0.5× and 2× player audio changes pitch through deterministic sample
  repetition or decimation; no opaque time-stretching algorithm is claimed.
- Windows and macOS packages, VLC integration, and the broader browser decoder
  remain open.
- The first public prerelease remains silent.

## Next mandatory gates

1. Complete genuine blinded AM1 speech listening and decide whether the current
   8 kbps speech candidate can freeze.
2. Present advisory estimates and decoded previews interactively in the native
   SDL2 shell without weakening exact post-encode verification.
3. Add a Linux package with bundled runtime dependencies, desktop file selection,
   application icon handling, and install/uninstall evidence.
4. Add Particle Lighting controls after its normative event and recovery policy
   is ready for application integration.
5. Continue physical-device qualification, browser/WebAssembly decoding,
   Windows/macOS packaging, one-pass live-capture research, and VLC integration
   in the planned product order.
