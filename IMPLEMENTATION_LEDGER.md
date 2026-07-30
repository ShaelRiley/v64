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
- [ ] Freeze the palette as normative `V64-P256-1`.

Palette blocker: the design document requires empirical corpus comparison before
the final palette is frozen. The executable still uses
`V64-P256-CANDIDATE-1`; the Hyper Real-derived candidate is now the preferred
design direction, but it requires licensed-raster comparison before replacing
the enforced runtime asset.

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
- [ ] Replace or augment the synthetic seed fixtures with licensed raster-video
  clips before drawing recognizable-fidelity or normative syntax conclusions.

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

- [ ] `apps/ansi-drop`: Linux-first drag/drop batch encoder.
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

Ingest the first redistributed human-content raster-video tranche into the
corpus manifest.
Preserve the 0.5-, 1-, and 2-second group sweep while comparing packed-byte and
entropy-aware parser objectives on identical decoded states. Add encode time,
peak memory, seek latency, and recognizable-fidelity notes before freezing the
visual command grammar or entropy backend.

In parallel after that measurement is reproducible, resume AM1 as a separately
testable audio pipeline: deterministic WAV fixtures, hysteretic silence
segmentation, standard Opus packets, exact `SILN` spans, and sample-exact A/V
synchronization.
