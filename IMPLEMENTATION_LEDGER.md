# V64 implementation ledger

Updated: 2026-07-30

## Ground truth

- Design source:
  [public V64 / Video64 Drop Google Doc](https://docs.google.com/document/d/1qP6a9f6OSggPun4t1wATHRrC1yPgLngblZwlZdrk1Tg/edit?usp=sharing)
- ANSI Tube source: `ShaelRiley/ansi-tube`
- Inspected ANSI Tube commit: `ee08e66` (`Release ANSI Tube v0.9.9`)
- Canonical source file blob: `core.js` SHA `29fd2065612454a66a92e431213731c41d5dc28c`

No benchmark or build result belongs in this ledger until produced by a checked
command.

## Phase 0 — provenance and assets

- [x] Read the complete design document.
- [x] Inspect ANSI Tube v0.9.9 and isolate the Video 64 matcher.
- [x] Add a one-purpose extractor for names and masks.
- [x] Preserve 64 names, 64 × 16 bytes, MSB-left ordering, and `8×16` geometry.
- [x] Emit SHA-256 asset identities and a PPM atlas.
- [x] Add a reproducible ordered 256-color candidate-palette generator.
- [x] Preserve ANSI Tube's exact twelve-color Hyper Real anchors and grading
  parameters as versioned palette-research provenance.
- [x] Generate and check Hyper Real Candidates 2–4.
- [x] Reject Candidate 3 after its black-and-white separation fell from 5/5 to
  2/5 despite stronger chromatic recognizability.
- [x] Reject Candidate 4 after its black-and-white separation recovered only to
  3/5 despite stronger recognizability, temporal stability, and compression.
- [x] Generate Candidate 5A/5B with fixed dark `[32,32,32]`, middle
  `[112,112,112]`, and light `[224,224,224]` neutrals while separately retaining
  dark teal or dark navy.
- [x] Run the twelve-lane Candidate-5 depth, monochrome, and screen-capture
  ablation with pre-key still and motion review.
- [x] Retain Candidate 5A as the dark-teal/depth endpoint and Candidate 5B as the
  dark-navy/monochrome endpoint.
- [x] Generate Candidate 6A/6B/6C as exact 25%, 50%, and 75% sRGB interpolation
  points between Candidate 5A's dark teal `[0,92,96]` and Candidate 5B's dark
  navy `[16,32,72]`, with every other prefix entry fixed.
- [x] Run the eighteen-lane Candidate-6 finalist gate with pre-key still and
  motion review.
- [x] Freeze Candidate 6A as normative `V64-P256-1`.
- [x] Switch the executable palette default to normative `V64-P256-1`.

Normative `V64-P256-1` uses dark chroma `[4,77,90]`, the checked 25%
teal-to-navy interpolation. Its 16-color prefix SHA-256 is
`e8d7b7de275b79acb403d17a97c4e7ef72ca16600a8f4f3ebdcba86099ce41cf`
and its complete 256-color palette SHA-256 is
`c03d23141eb33b80d79d1a7f3167eeb18ccf1f4f0c0f81572f269abd51317105`.
Any byte change requires a new normative palette identifier.

In checked tranche 5, Candidate 6A used 10,580 selected DEFLATE bytes, 180 bytes
or 1.673% below legacy Candidate 1. It also recorded the lowest selected command
bytes (17,154), changed-cell rate (16.861%), and one-frame-reversion proxy
(1.222%) among the six compared palettes. Pre-key review scored it 5/5 for
depth, 4.5/5 for monochrome hierarchy, and 5/5 for screen capture, matching the
best endpoint scores without their opposing regressions.

## Phase 1 — JavaScript proof codec

- [x] Define and implement a binary v0.1 header and chunk framing.
- [x] Validate magic, reserved fields, dimensions, lengths, hashes, cadence, and
  palette depth.
- [x] Implement keyframes and delta commands.
- [x] Implement `SKIP`, `LITERAL`, `REPEAT_TOKEN`, `FILL_RECT`,
  `DEFINE_TOKEN_DICTIONARY`, and `DICTIONARY_LITERAL`.
- [x] Implement repeat-frame spans.
- [x] Implement CRC-32 and bounded raw-DEFLATE chunk payloads.
- [x] Implement a keyframe seek index.
- [x] Port the 4×8 proxy matcher, dual-color polarity choice, and temporal
  glyph/color retention.
- [x] Implement deterministic RGB rasterization.
- [x] Add FFmpeg source ingest and decoded MP4/MKV generation.
- [x] Add CLI encode, decode, inspect, verify, atlas, and sample commands.
- [x] Add exact-silence and deterministic particle-event chunk primitives.
- [x] Encode, verify, decode, and visually inspect a two-second procedural clip.
- [x] Measure the first round-trip and publish exact hashes and command metrics.
- [x] Add backend-neutral canonical command traces and exact opcode/count/payload
  byte accounting.
- [x] Add experimental Grammar B with packed palette indices, separable
  glyph/foreground/background/color-pair actions, strict progress rules, and
  transactional decoding.
- [x] Implement deterministic canonical-Huffman encode/decode experiments.
- [x] Compare packed-only, per-frame and per-group DEFLATE, Zstandard, and
  canonical Huffman on the identical 48-frame golden trace.
- [x] Add same-value glyph, foreground, background, and color-pair runs.
- [x] Replace the fixed greedy trace builder with bounded dynamic programming
  that minimizes exact packed command bytes.
- [x] Add deterministic 0.5-, 1-, and 2-second independent-group sweeps with
  forced keyframes and verified reconstruction.
- [ ] Add scene-cut scoring and rate-distortion target modes.
- [ ] Complete the 32-glyph and adaptive 16/32/64 canonical-glyph study.
- [ ] Repeat the entropy and grammar comparison on the legally reusable mixed
  corpus before selecting normative syntax or a backend.
- [x] Add a provenance-validating manifest and deterministic CC0 structural
  seed corpus covering all eleven required content classes.
- [x] Add a two-pass static-byte entropy objective and actual-DEFLATE candidate
  selection without changing decoder syntax.
- [x] Publish the first multi-fixture entropy report: 6,807 selected DEFLATE
  bytes versus 7,897 for packed-only parsing, with entropy selected on 5 of 11
  fixtures.
- [x] Add provenance- and SHA-256-validated FFmpeg raster-video ingest.
- [x] Run raster tranche 0 from the self-authored CC0 procedural MP4: entropy
  pass 2 reduced DEFLATE from 9,402 to 8,696 bytes (7.509%).
- [x] Add original CC0 human-content raster tranche 1: dialogue/lecture,
  saturated performance, and 2D animated dialogue crossed with both palette
  candidates.
- [x] Add reproducible 0.5-, 1-, and 2-second independent-group sweeps,
  seek-decode timing, process high-water memory, changed-cell percentage, and a
  one-frame-reversion flicker proxy to the raster harness.
- [x] Measure entropy pass 2 on all six human-content lanes: 29,749 selected
  DEFLATE bytes versus 34,834 for packed parsing (14.598% reduction).
- [x] Complete raster coverage of all eleven required classes, including
  deterministic CC0 3D-animation, black-and-white-film, and screen-capture
  fixtures.
- [x] Add hash-validated still-to-motion treatments without opaque derived-video
  fixtures.
- [x] Add matched subtitle lanes at 60 and 80 columns.
- [x] Add deterministic blind-code previews, public worksheets, and separately
  uploaded concealed keys.
- [x] Run tranche-2 codec measurements: entropy pass 2 selected on all fourteen
  lanes and reduced raw DEFLATE from 174,666 to 147,912 bytes (15.317%).
- [x] Collect pre-key still and motion scores before every palette-key disclosure.
- [x] Retain two-second independent groups as the prototype default. In the
  Candidate-6 finalist tranche they were 11.396% smaller than one-second groups
  and 24.832% smaller than half-second groups, with 1.996 ms median and 3.143 ms
  p95 hosted-runner seek reconstruction.
- [ ] Validate two-second seek behavior in the browser before freezing the group
  duration.

### Subtitle side-plane research

- [x] Prototype bounded sparse `SM1` arbitrary 8×16 masks with row-major delta
  positions, palette indices, strict progress, exact rasterization, and
  damaged-stream rejection.
- [x] Demonstrate exact 60-column transcription with SM1: base 0/4 versus SM1
  4/4.
- [x] Reject SM1's broad extractor and per-frame framing after measuring 108,823
  compressed bytes across sixteen lane-seconds, or 54.412 kbit/s.
- [x] Build SM2 connected-region selection with full planes, repeat-plane spans,
  sparse removal/upsert deltas, strict canonical decoding, and total-V64-byte
  accounting.
- [x] Reduce selected mask cells from 28,632 to 10,362 and side-plane rate from
  54.412 to 4.785 kbit/s, a 91.206% reduction from SM1.
- [x] Improve exact transcription from base 2/8 to SM2 6/8 at 7.590% total-stream
  overhead.
- [x] Diagnose SM2's two failures as under-selection on the 60-column lecture
  lane.
- [x] Build SM3 temporal subtitle-line discovery with connected components,
  horizontal lower-band projection, ranked boxes, and bounded fallback.
- [x] Restore exact 60-column lecture transcription from 0/2 to 2/2 with SM3,
  while identifying broad per-frame projection as a 62.327% overhead failure.
- [x] Build SM4 canonical persistent planes using recurrence thresholds, modal
  palette pairs, consensus masks, and the existing repeat-span syntax.
- [x] Preserve SM3's exact 2/2 lecture transcription and 5/5 edge/stability
  scores while reducing compressed bytes from 12,284 to 1,806.
- [x] Reduce focused total-stream overhead from 62.327% to 9.163%, clearing the
  focused 10% ceiling without adding a decoder opcode.
- [ ] Run a complete eight-lane SM4 regression across lecture and animated
  dialogue at 60 and 80 columns.
- [ ] Require 8/8 exact transcription and total-stream overhead at or below 10%
  before registering the subtitle side plane in the normative V64 container.
- [ ] Add stable-span boundaries and frame-local delta fallback for changing
  subtitle text.

Clean GitHub Actions run `30589727547` at code head
`35b75024e0d62df8afad472f726defd129802047` passed the normative palette finalist
gate. It reduced raw DEFLATE from 73,634 to 64,612 bytes (12.252%) with entropy
selected on all eighteen lanes and produced segregated blind/key artifacts.

Clean GitHub Actions run `30591665741` at code head
`b96f45d3abed42d9da25bf55c7e29a5e12a10305` passed conformance and the focused
SM4 gate. Candidate 6 was correctly skipped by path-specific CI. SM4 retained
exact 2/2 lecture transcription while reducing focused side-plane rate to 3.612
kbit/s and total-stream overhead to 9.163%.

## Phase 2 — audio and finished container profile

- [ ] FFmpeg/libav audio ingest.
- [ ] AM1 preprocessing: mono, 200 Hz–4.5 kHz, compressor, limiter.
- [ ] Opus packetization at 4–16 kb/s, default 8 kb/s.
- [ ] Silence detector with entry/exit hysteresis, hangover, and exact spans.
- [x] Silence chunk syntax and exact-zero timeline semantics in verifier.
- [ ] Audio/video synchronization and repeated-seek tests.
- [ ] Final v1 chunk registry and forward-compatibility policy.

## Phase 3 — Rust and stable API

- [ ] `crates/v64-core`
- [ ] `crates/v64-encoder`
- [ ] `crates/v64-cli`
- [ ] Stable C ABI
- [ ] JavaScript/Rust golden state and raster-hash agreement
- [ ] Fuzz targets and allocation-limit regression corpus

Rust is not installed in the current build environment; this is an environment
blocker, not a codec-design blocker.

## Phase 4 — products

- [ ] `apps/video64-drop`: Linux-first drag/drop batch encoder.
- [ ] Source/V64 decoded split preview.
- [ ] Representative-sample size estimator and calibration history.
- [ ] Per-file overrides and six-stage progress reporting.
- [ ] Keyboard and reduced-motion audit.
- [ ] `apps/v64-player`: native standalone player.
- [x] Specify a shared playback-effects profile whose CRT scanline option is
  enabled by default, live-toggleable, persisted after user changes, and applied
  only after deterministic rasterization.
- [x] Add renderer-neutral default-on scanline compositing with strength 0.18,
  period 2, phase 1, bounded validation, viewport-anchored phase, non-mutation
  guarantees, and conformance tests.
- [ ] Wire the native player's **View → CRT Scanlines** action, keyboard toggle,
  and persisted preference to the shared playback profile.
- [ ] WebAssembly decoder.

## Phase 5 — VLC

- [ ] Pin a supported VLC release and install its development SDK.
- [ ] Build the `.v64` demux module.
- [ ] Build the glyph-video decoder module.
- [ ] Route Opus elementary packets through VLC's Opus decoder.
- [ ] Synthesize exact silence blocks.
- [ ] Expose the persisted `v64-crt-scanlines` module option enabled by default,
  using the same non-normative presentation profile as the standalone player.
- [ ] Test duration, pause, seek, rate, EOF, repeated seeks, scanline default,
  live toggle, persistence, and viewport-phase stability.
- [ ] Document Windows and macOS build routes.

VLC development headers are absent in the current environment. Integration is
intentionally downstream of standalone conformance.

## Next concrete step

Run the complete eight-lane SM4 subtitle regression and add stable-span
boundaries for changing subtitle text. If it passes 8/8 exact transcription at
no more than 10% total-stream overhead, register the existing full/repeat/delta
side-plane grammar in the V64 container profile.

Then resume AM1 as a separately testable audio pipeline: deterministic WAV
fixtures, hysteretic silence segmentation, standard Opus packets, exact `SILN`
spans, and sample-exact A/V synchronization.
