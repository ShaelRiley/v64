# V64 implementation ledger

Updated: 2026-07-30

## Ground truth

- Authoritative design:
  [public V64 / Video64 Drop Google Doc](https://docs.google.com/document/d/1qP6a9f6OSggPun4t1wATHRrC1yPgLngblZwlZdrk1Tg/edit?usp=sharing)
- ANSI Tube source inspected at release `v0.9.9`, commit `ee08e66`.
- Canonical ANSI Tube source blob: `core.js`
  `29fd2065612454a66a92e431213731c41d5dc28c`.
- No benchmark or build result belongs here until produced by a checked command.

## Phase 0 — canonical assets and palette

- [x] Preserve the 64 Video64 glyph names, 64 × 16 mask bytes, MSB-left order,
  and `8×16` geometry.
- [x] Emit deterministic glyph identities and atlas assets.
- [x] Preserve ANSI Tube's exact twelve Hyper Real anchors and its 1.60
  saturation / 1.12 contrast direction.
- [x] Run matched palette Candidates 2–6C through low-depth visual, temporal,
  monochrome, depth, screen-capture, and compression gates.
- [x] Freeze Candidate 6A as normative `V64-P256-1`.
- [x] Switch the executable palette default to `V64-P256-1`.

Normative `V64-P256-1` uses dark chroma `[4,77,90]`.

- 16-color prefix SHA-256:
  `e8d7b7de275b79acb403d17a97c4e7ef72ca16600a8f4f3ebdcba86099ce41cf`
- Complete palette SHA-256:
  `c03d23141eb33b80d79d1a7f3167eeb18ccf1f4f0c0f81572f269abd51317105`

Candidate 6A scored 5/5 for depth, 4.5/5 for monochrome hierarchy, and 5/5
for screen capture while using 1.673% fewer selected bytes than legacy
Candidate 1. Any palette-byte change requires a new normative identifier.

## Phase 1 — JavaScript proof codec

### Core container and video

- [x] Implement the v0.1 binary header and chunk framing.
- [x] Validate magic, version, feature bits, reserved fields, dimensions,
  cadence, palette depth, asset hashes, lengths, CRC-32, and bounded DEFLATE.
- [x] Implement keyframes, deltas, repeat-frame spans, and a keyframe seek index.
- [x] Implement the canonical command set and deterministic dynamic-programming
  command selection.
- [x] Add deterministic raster ingest, rendering, CLI encode/decode/inspect/
  verify commands, and reproducible corpus benchmarking.
- [x] Complete deterministic CC0 coverage of all eleven required raster classes.
- [x] Add blind still/motion reviews with separately uploaded concealed keys.
- [x] Retain two-second independent groups as the prototype default.
- [ ] Validate two-second group seeks in the browser before a normative duration
  freeze.
- [ ] Complete scene-cut scoring, rate-distortion modes, the adaptive glyph-count
  study, and final grammar/entropy selection.

### Subtitle side plane

- [x] SM1 proved exact arbitrary-mask readability but was rejected at
  54.412 kbit/s.
- [x] SM2 introduced connected-region selection plus full-plane, repeat-span,
  and sparse removal/upsert-delta syntax.
- [x] SM3 restored 60-column lecture text through temporal projection but was
  rejected at 62.327% focused-stream overhead.
- [x] SM4 persistent planes reduced the focused overhead to 9.163% while
  retaining exact 2/2 lecture transcription.
- [x] SM5 added deterministic changing-caption span boundaries and sparse-frame
  merging without changing decoder syntax.
- [x] Pass the complete eight-lane gate: exact transcription improved from base
  4/8 to SM4/SM5 8/8 at 7.082% total-stream overhead.
- [x] Publish the versioned subtitle-extension profile.
- [ ] Integrate the proposed `SUBT` chunk and its feature bit into the proof
  container with grid, palette, frame-count, duration, alignment, overlap, and
  canonical-sequence validation.

Full subtitle gate, workflow `30593087909`, code head
`25b108b8572dc940362394286a1f88b63f5a7a85`:

- 192 frames / 17 detected spans;
- 9,086 side-plane bytes;
- 128,304 selected base bytes;
- 137,390 total bytes;
- 7.082% overhead / 4.543 kbit/s;
- mean edge clarity and temporal stability 4.875/5.

## Phase 2 — AM1 audio and finished container profile

### Deterministic source and silence

- [x] Add mono PCM16 WAV encode/decode.
- [x] Add a deterministic 48 kHz, 96,000-sample source fixture.
- [x] Freeze the fixture identity:
  `cb98b4184e0c5f69ab296b80c94b71b9896f5e44cff6e76dd0ec6d957f237c89`.
- [x] Add hysteretic silence entry at −48 dB, exit at −42 dB, 120 ms minimum,
  and 40 ms exit hangover.
- [x] Reject the fixture's 80 ms quiet pause as too short for `SILN`.
- [x] Convert qualifying silence to exact empty-payload `SILN` chunks.
- [x] Reject inexact sample/tick boundaries and overlapping silence spans.

### Standard Opus and `AURN`

- [x] Add mono 48 kHz libopus packetization at 4–16 kbit/s; current experiment
  uses 8 kbit/s constrained VBR, VOIP, and 20 ms packets.
- [x] Parse standard Opus packet durations from TOC bytes.
- [x] Extract deterministic packet streams independent of random Ogg serials.
- [x] Add bounded version-1 `AURN` payloads with pre-skip, end trim, kept
  samples, decoded samples, packet descriptors, and standard packet bytes.
- [x] Register `AURN` as a mandatory chunk with header feature bit `0x40`.
- [x] Require `AURN` and `SILN` to cover one continuous audio timeline from zero
  through the declared file duration.
- [x] Reject TOC-duration, trim/accounting, payload-length, duration, feature,
  alignment, gap, and incomplete-coverage failures.

### Playback and synchronization

- [x] Reconstruct deterministic Ogg framing only as an FFmpeg/libopus transport.
- [x] Decode independent `AURN` runs to exact kept-sample PCM lengths.
- [x] Synthesize `SILN` spans as exact zero PCM.
- [x] Pass full-decode determinism and five repeated-seek comparisons, including
  windows crossing audio/silence boundaries.
- [x] Publish a verified two-second `.v64` playback fixture.
- [ ] Implement the AM1 preprocessing path: mono downmix, 200 Hz high-pass,
  4.5 kHz low-pass, compressor, and limiter.
- [ ] Run matched 4/8/12/16 kbit/s objective and blinded-listening sweeps before
  freezing the default bitrate.
- [ ] Finalize the v1 chunk registry and forward-compatibility policy.

AM1 playback gate, workflow `30596274425`, code head
`c5f76b05789e64645c3d532f819dbfd107e33858`:

- V64 fixture: 1,732 bytes,
  `a61b40502b4fd4a079dcb4bef050c7c33b9a854a6126ad350d8800b2d454b469`;
- two `AURN` runs and two `SILN` spans;
- exact 96,000-sample accounting;
- decoded PCM: 192,000 bytes,
  `b7c875b16fb4673f806477679470b3d6fcde1c92df331a0ba4983c3c33da99a5`;
- all five seek windows match full-decode slices byte-for-byte.

## Phase 3 — Rust and stable API

- [ ] `crates/v64-core`
- [ ] `crates/v64-encoder`
- [ ] `crates/v64-cli`
- [ ] Stable C ABI
- [ ] JavaScript/Rust golden-state and raster/PCM hash agreement
- [ ] Fuzz targets and allocation-limit regression corpus

Rust is not installed in the current build environment. This is an environment
blocker, not a codec-design blocker.

## Phase 4 — products

- [ ] `apps/video64-drop`: Linux-first drag/drop batch encoder.
- [ ] Source/V64 decoded split preview.
- [ ] Representative-sample estimator, calibration history, per-file overrides,
  and six-stage progress reporting.
- [ ] `apps/v64-player`: native standalone player.
- [x] Specify and test renderer-neutral CRT scanlines at strength 0.18, period 2,
  and phase 1.
- [x] Require CRT scanlines enabled by default, live-toggleable, persisted after
  user changes, viewport-anchored, and presentation-only.
- [ ] Wire **View → CRT Scanlines**, the keyboard toggle, and persisted native
  preference.
- [ ] WebAssembly decoder.

## Phase 5 — VLC

- [ ] Pin a supported VLC release and install its development SDK.
- [ ] Build the `.v64` demux and glyph-video decoder modules.
- [ ] Route `AURN` packets through VLC's Opus decoder and synthesize exact
  `SILN` blocks.
- [ ] Expose persisted `v64-crt-scanlines`, enabled by default, using the shared
  playback profile.
- [ ] Test duration, pause, seek, rate, EOF, repeated seeks, scanline default,
  live toggle, persistence, and viewport-phase stability.
- [ ] Document Windows and macOS build routes.

## Next concrete step

Implement the AM1 preprocessing path and a reproducible 4/8/12/16 kbit/s
comparison. Preserve the current standard packet and `AURN` syntax while
measuring size, decode integrity, band-limiting, peak control, and objective
error before blinded listening.

In parallel, integrate the already-passed subtitle sequence as the versioned
`SUBT` container extension. CRT scanlines remain mandatory and enabled by
default for both the native player and VLC plugin.
