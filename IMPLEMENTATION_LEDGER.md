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
- [x] Generate `V64-P256-HYPERREAL-CANDIDATE-2`, whose lower prefixes preserve
  the ultra-saturated Hyper Real direction.
- [x] Generate `V64-P256-HYPERREAL-CANDIDATE-3`, retaining the twelve anchors
  while adding dark navy, dark teal, warm skin, and neutral midtone utility
  colors to the 16-color prefix.
- [x] Run the Candidate-3 missing-class, subtitle, compression, and blind-still
  decision gate.
- [x] Reject Candidate 3 as the frozen prefix while retaining it as the
  chromatic benchmark for Candidate 4.
- [x] Generate and register `V64-P256-HYPERREAL-CANDIDATE-4`, replacing
  Candidate 3's redundant extra warm-skin utility with light neutral
  `[224,224,224]`.
- [x] Run the matched Candidate-1/Candidate-4 visual and compression gate.
- [x] Reject Candidate 4 as the frozen prefix while retaining it as the strongest
  chromatic and temporal benchmark.
- [ ] Generate Candidate 5A/5B with dark neutral `[32,32,32]`, separately
  sacrificing dark navy and dark teal.
- [ ] Freeze the palette as normative `V64-P256-1`.

Candidate 4 is deterministic: its 16-color prefix SHA-256 is
`1e8997b6c6abb748df607bfe3156898a4fd6df547554b31cb150ce31c410bfd6`
and its complete palette SHA-256 is
`f683d64d46f95d5cd49638302eb18aeee7ac1684b2ad22b61ff7b4984c3ffd37`.
It improved mean recognizability from 4.000 to 4.429, separation from 3.571 to
4.143, temporal stability from 3.429 to 4.000, and selected DEFLATE by 504 bytes
(0.681%). Its monochrome separation improved over Candidate 3 from 2/5 to 3/5,
but remained below Candidate 1's 5/5. Candidate 1 therefore remains the
executable default.

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
- [x] Compare palette candidates at the 16-color prefix. Hyper Real candidate 2
  was 99 bytes (0.66%) smaller overall but showed mixed low-depth color fidelity.
- [x] Add original deterministic CC0 3D-animation, black-and-white-film, and
  screen-capture source plates, completing raster coverage of all eleven
  classes.
- [x] Add hash-validated deterministic still-to-motion treatments without
  requiring opaque derived-video fixtures.
- [x] Add matched candidate-1 / candidate-3 subtitle lanes at 60 and 80 columns.
- [x] Add deterministic blind-code previews, public worksheets, and a concealed
  palette key.
- [x] Run and publish tranche-2 codec measurements: entropy pass 2 was selected
  on all fourteen lanes and reduced raw DEFLATE from 174,666 to 147,912 bytes,
  a 15.317% reduction.
- [x] Publish the pre-key blind-still worksheet and decision report. Candidate 3
  improved mean recognizability from 3.571 to 4.000 but failed the monochrome
  hierarchy and produced no exact subtitle transcription at 60 or 80 columns.
- [x] Retain two-second independent groups as the prototype default: 10.034%
  smaller than one-second groups and 20.730% smaller than half-second groups.
- [ ] Validate two-second seek behavior in the browser before freezing the group
  duration; tranche 3 measured 6.008 ms median and 16.150 ms p95 on the hosted
  runner.
- [x] Emit fourteen anonymous motion clips under the established blind codes,
  plus a temporal worksheet and public motion manifest.
- [x] Collect and publish pre-key human temporal-stability scores. Candidate 3
  scored 4.000/5 versus Candidate 1's 3.429/5 despite a slightly worse automated
  one-frame-reversion proxy.
- [x] Prototype a bounded sparse `SM1` subtitle-mask plane with arbitrary 8×16
  masks, row-major delta positions, palette indices, strict progress, exact
  rasterization, and damaged-stream rejection.
- [x] Integrate SM1 into decoded previews and byte accounting, then perform a
  segregated blind base-versus-SM1 motion review.
- [x] Demonstrate exact 60-column transcription: base 0/4 versus SM1 4/4.
- [x] Measure the current SM1 side-plane cost: 108,823 raw-DEFLATE bytes across
  sixteen lane-seconds, or 54.412 kbit/s.
- [x] Reject the broad SM1 extractor and per-frame framing as normative while
  retaining exact arbitrary-mask semantics as a research primitive.
- [ ] Build SM2 with subtitle-region selectivity, repeat-plane spans, cell-delta
  coding, and total-V64-byte accounting.

Clean GitHub Actions run `30584192835` at code head
`7b7b9779c4280d1618186dea01336bca85f76649` passed all conformance tests,
regenerated Candidates 2–4, completed the Candidate-4 matched benchmark, built
both blinded review packages, and uploaded all four blind/key artifacts
separately. Candidate-4 entropy selection reduced raw DEFLATE from 174,202 to
147,582 bytes (15.281%) and selected entropy pass 2 on all fourteen lanes.

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
- [ ] WebAssembly decoder.

## Phase 5 — VLC

- [ ] Pin a supported VLC release and install its development SDK.
- [ ] Build the `.v64` demux module.
- [ ] Build the glyph-video decoder module.
- [ ] Route Opus elementary packets through VLC's Opus decoder.
- [ ] Synthesize exact silence blocks.
- [ ] Test duration, pause, seek, rate, EOF, and repeated seeks.
- [ ] Document Windows and macOS build routes.

VLC development headers are absent in the current environment. Integration is
intentionally downstream of standalone conformance.

## Next concrete step

Generate Candidate 5A and 5B by adding dark neutral `[32,32,32]` while
separately sacrificing dark navy and dark teal; run a compact matched
monochrome/depth/screen ablation against Candidate 1 and Candidate 4. In
parallel, build SM2 around subtitle-region selectivity before adding temporal
repeat and cell-delta syntax.

After those visual gates, resume AM1 as a separately testable audio pipeline:
deterministic WAV fixtures, hysteretic silence segmentation, standard Opus
packets, exact `SILN` spans, and sample-exact A/V synchronization.
