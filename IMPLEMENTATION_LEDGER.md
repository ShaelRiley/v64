# V64 implementation ledger

Updated: 2026-07-31

## Ground truth

- Authoritative design:
  [public V64 / Video64 Drop Google Doc](https://docs.google.com/document/d/1qP6a9f6OSggPun4t1wATHRrC1yPgLngblZwlZdrk1Tg/edit?usp=sharing)
- The project remains **Video 64** and encoded files remain `.v64`.
- The canonical source asset remains the complete 64-glyph Video 64 alphabet.
- The primary/default product encoder budget is 32 glyphs; 64 glyphs is an
  explicit additional option and 16 glyphs is research-only.
- Video 64 is licensed under the maximally permissive Zero-Clause BSD license,
  SPDX identifier `0BSD`; forks and modification require no permission.
- Human developers are the primary contributor community. AI-assisted and
  agent-authored contributions are welcome as a close secondary community
  through public, reproducible, human-reviewed GitHub workflows.
- Public contributor invitation: GitHub issue
  [#4](https://github.com/ShaelRiley/v64/issues/4).
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
- [x] Implement keyframes, delta frames, repeat-frame spans, and a keyframe seek
  index.
- [x] Implement the canonical command set and deterministic dynamic-programming
  command selection.
- [x] Add deterministic raster ingest, rendering, CLI encode/decode/inspect/
  verify commands, and reproducible corpus benchmarking.
- [x] Complete deterministic CC0 coverage of all eleven required raster classes.
- [x] Add blind still/motion reviews with separately uploaded concealed keys.
- [x] Validate two-second group seeks in headless Chrome across cell state,
  subtitle planes, composite raster, audio windows, and viewport scanline phase.
- [x] Freeze two seconds as the maximum independent-group duration for the
  JavaScript proof profile.
- [x] Derive the maximum frame count from cadence: 48 frames at 24 fps, 24 at
  12 fps, 12 at 6 fps, and equivalent values for every supported cadence.
- [x] Add deterministic scene-cut scoring that may begin shorter independent
  groups without exceeding the cadence-derived two-second maximum.
- [x] Add explicit `compact`, `balanced`, and `quality` rate-distortion modes.
- [x] Complete the deterministic 16/32/64-glyph structural-corpus study.
- [x] Make 32 glyphs the executable default and primary optimization target.
- [x] Retain 64 glyphs as an explicit product option through `--glyphs 64`.
- [x] Restrict 16 glyphs to comparative research rather than ordinary product
  encoding.
- [x] Complete the human-raster 32/64 study with valid-file decoder timing,
  sampled allocations, and malformed-input resource-limit measurements.
- [x] Add deterministic `V64-ENCODER-PROFILE-1` metadata in optional `META`
  chunks and expose it through `inspect` and `verify`.
- [x] Complete the weighted combined structural/human grammar decision gate with
  direct Phase-1 versus Grammar B decoder-time, allocation, and source-surface
  measurements.
- [ ] Optimize the JavaScript Grammar B decoder before any V1 grammar freeze;
  its checked combined-corpus size win currently carries a 212.186% decode-time
  regression.
- [ ] Freeze an entropy backend only after Rust/WebAssembly/native decoder cost
  and interoperability measurements.

Browser seek gate, workflow `30599518584`, checked code head
`a53109205a6effc0ab0e4c4bcf15ae8388ba88d0`:

- all 101 repository tests passed;
- artifact `8781381629`;
- four-second fixture: 1,500 bytes,
  `fb718b18ca33daee562dcc9ec46f2393a3b8f74db5b38b20fcd40311aa1e1`;
- two 48-frame / two-second independent groups;
- 96 video frames, two keyframes, 12 repeat spans;
- two `SUBT` chunks covering all 96 subtitle frames;
- companion 48 kHz PCM: 192,000 samples,
  `8846750d2fe20c1c86ca9c3a37b1d6f28cf8471719e99e7d688fef3d9eec9310`;
- Chrome reproduced Node-derived cell, subtitle, composite, scanline, and PCM
  hashes for thirteen out-of-order seeks across eight unique frames;
- repeated targets were byte-stable and no prior-group state was carried across
  the two-second boundary.

Structural scene-cut / rate-distortion / glyph-budget gate, workflow
`30633411868`, checked code head
`2a802f851a716c83b4288820ec2e8632533ddd47`:

- complete repository suite passed;
- artifact `8794322086`;
- artifact ZIP SHA-256:
  `c7afbf5cb4c2a85a7e7cf9eefb57a3213983875c54e48bb73548bca033f16ed4`;
- full generated summary SHA-256:
  `afbaeef137c932602b14a234c8652b348184d46d63adbce221332fbc4755be00`;
- eleven deterministic CC0 structural classes;
- 72 frames per class, six configurations, 66 matched cases;
- every generated container passed ordinary verification;
- fixed 16 glyphs: 85,967 bytes, distortion 0.011532598;
- fixed 32 glyphs: 88,671 bytes, distortion 0.006832271;
- fixed 64 glyphs: 91,701 bytes, distortion 0.005947205;
- 16 → 32 cost 3.145% more bytes and reduced distortion 40.757%;
- 32 → 64 cost another 3.417% and reduced distortion 12.954%;
- 32 glyphs emerged as the fixed-budget knee;
- Grammar B plus group DEFLATE used 100,896 bytes versus 156,061 for Phase-1;
- Grammar B plus Zstandard used 104,852 bytes and canonical Huffman used
  418,966 bytes.

Human-raster 32-primary gate, workflow `30636581459`, checked code head
`df0708742300b344e522009a7d78a17e3f1e0359`:

- complete repository suite passed;
- artifact `8795660692`;
- artifact ZIP SHA-256:
  `c9209d2378fba31218ea39a49fa6e6d36873986dbd9553e1395156cb166238f6`;
- full generated summary SHA-256:
  `b381ed29dc1afb3920ec00ee5f41fde48f08e28ffac5ceb133f673a04df3f660`;
- ten original CC0 source/grid lanes normalized to `V64-P256-1`;
- four configurations and 40 verified `.v64` files;
- primary 32 balanced: 249,578 bytes, distortion 0.018299704;
- fixed 32 quality: 256,482 bytes, distortion 0.018015554;
- optional 64 quality: 274,904 bytes, distortion 0.017388208;
- adaptive 32/64 quality selected 32 on all 480 frames and exactly matched the
  fixed-32 quality result;
- fixed 64 quality cost 7.183% more bytes than fixed 32 quality for only 3.482%
  lower distortion;
- balanced 32 used 2.766% fewer bytes than quality 32 for only 1.553% more
  distortion;
- worst valid-file decode p95: 18.206 ms;
- largest sampled heap delta: 16,420,128 bytes;
- largest sampled ArrayBuffer delta: 2,859,280 bytes;
- all seven malformed classes were rejected;
- worst hostile-input p95: 1.682 ms;
- worst hostile sampled heap delta: 129,336 bytes;
- worst hostile sampled ArrayBuffer delta: 920,753 bytes;
- Phase-1 plus group DEFLATE used 874,752 bytes;
- Grammar B plus group DEFLATE used 881,164 bytes, making Grammar B 0.733%
  larger on the human corpus;
- Grammar B plus Zstandard used 912,638 bytes and canonical Huffman used
  988,292 bytes;
- raw DEFLATE remains 3.449% smaller than Zstandard on these human groups.

Decision: 32 glyphs is frozen as the primary/default JavaScript encoder budget,
64 remains the explicit full-alphabet option, balanced is the ordinary target,
and final grammar selection is reopened because the structural and human
corpora disagree slightly.

Combined grammar decision gate, workflow `30640529023`, checked code head
`a55e8a368e581ddee9e539922269547702128dc5`:

- complete repository suite and both source-corpus rebuilds passed;
- artifact `8797286945`;
- artifact ZIP SHA-256:
  `b065fca95200ed6156a722d341edb8880268157667e57b4cc238cad37ebf67d7`;
- human material receives 75% decision weight and structural stress material
  receives 25%;
- Grammar B must save at least 1% weighted and may not regress either corpus by
  more than 1%;
- structural Phase-1/Grammar B group-DEFLATE bytes: 155,992 / 100,761,
  a 35.406% Grammar B saving;
- human Phase-1/Grammar B group-DEFLATE bytes: 874,752 / 881,164,
  a 0.733% Grammar B regression;
- weighted Grammar B saving: 8.302%;
- decoder comparison covered 40 human files and 1,870 nominal frames;
- Phase-1 total median decode time: 139.994 ms, worst p95 8.289 ms;
- Grammar B total median decode time: 437.041 ms, worst p95 28.356 ms;
- Grammar B decode-time delta: +212.186%;
- Phase-1 decoder surface: 7 opcodes, one function, 3,850 source bytes;
- Grammar B decoder surface: 12 opcodes, parser plus apply functions,
  6,509 source bytes.

Decision: Grammar B advances as the provisional combined-corpus byte winner but
is not frozen. Phase-1 remains the compatibility and simplicity baseline.
Optimize Grammar B's JavaScript parser/apply path and require Rust/WebAssembly
golden-state and resource agreement before final command selection.

### Encoder profile metadata

- [x] Add deterministic `V64-ENCODER-PROFILE-1` JSON carried in optional `META`.
- [x] Record Video 64 identity, `.v64`, canonical source alphabet size 64,
  selected glyph count 32/64, target mode, cadence, scene-cut policy,
  cadence-derived two-second group bound, and dictionary selection.
- [x] Preserve legacy compatibility: files without the record remain valid and
  report `encoderProfile: null`.
- [x] Reject malformed JSON, non-primary glyph counts, unknown targets,
  cadence disagreement, overlong group declarations, and multiple profile
  records during profile inspection.
- [x] Emit the profile from ordinary CLI encoding and expose it through
  `v64 inspect` and `v64 verify`.

The profile reports an encoder decision; it does not replace the canonical
64-glyph asset hash or change the core container feature mask.

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
- [x] Register mandatory `SUBT` with feature bit `0x80` in the JavaScript proof
  container.
- [x] Enforce grid, palette, frame-count, duration, alignment, overlap,
  file-boundary, feature-presence, and canonical-sequence validation.
- [x] Publish a deterministic sparse-coverage fixture and checked container
  identities.

Full subtitle gate, workflow `30593087909`, code head
`25b108b8572dc940362394286a1f88b63f5a7a85`:

- 192 frames / 17 detected spans;
- 9,086 side-plane bytes;
- 128,304 selected base bytes;
- 137,390 total bytes;
- 7.082% overhead / 4.543 kbit/s;
- mean edge clarity and temporal stability 4.875/5.

`SUBT` container gate, workflow `30598259834`, checked code head
`c710c8b5e85399d5d1d35ed65ca6829755a0a7d3`:

- all 96 repository tests passed;
- fixture artifact `8780957363`;
- container: 528 bytes,
  `2535ea2368fe562dcc9ec46b6b6cdb216ad797a7f1b735753719101180b9935a`;
- two `SUBT` chunks / five subtitle frames / one sparse base-only frame;
- feature flags `0xB9`, including mandatory `SUBT` bit `0x80`;
- feature bits above `0x80` remain mandatory-unknown.

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

### Playback, preprocessing, and synchronization

- [x] Reconstruct deterministic Ogg framing only as an FFmpeg/libopus transport.
- [x] Decode independent `AURN` runs to exact kept-sample PCM lengths.
- [x] Synthesize `SILN` spans as exact zero PCM.
- [x] Pass full-decode determinism and five repeated-seek comparisons, including
  windows crossing audio/silence boundaries.
- [x] Publish a verified two-second `.v64` playback fixture.
- [x] Implement deterministic AM1 preprocessing: stereo/mono ingest, mono 48 kHz
  output, 200 Hz high-pass, 4.5 kHz low-pass, 3:1 compressor, and −1 dBFS
  limiter.
- [x] Run a reproducible 4/8/12/16 kbit/s objective sweep and publish separate
  blind and concealed-key artifacts.
- [ ] Conduct blinded listening on legally reusable speech before freezing the
  default bitrate.

### V1 registry and forward compatibility

- [x] Publish `spec/v64-v1-registry.json` as the machine-readable JavaScript
  proof-profile registry.
- [x] Register all eight known feature bits and all eight known chunk types.
- [x] Require feature/chunk or feature/storage-flag presence agreement.
- [x] Require bits `0x01`, `0x08`, and `0x10` (`0x19`) in every V1 proof file.
- [x] Document and test unknown uppercase mandatory rejection and lowercase
  optional-extension skipping after bounded framing checks.
- [x] Generate an 18-scenario registry conformance matrix.
- [x] Expose registry-bound file verification through `verifyV1File` and
  `npm run verify:v1 -- INPUT.v64`.
- [ ] Reproduce the registry in Rust, WebAssembly, native-player, and VLC
  implementations before the final cross-implementation V1 freeze.

V1 registry gate, workflow `30600260674`, checked code head
`26f93df75912cc134496553d6a12a68fa7938a02`:

- all 109 repository tests passed;
- artifact `8781628600`;
- registry: 4,058 bytes,
  `7ea2c530b467c01f17bdea1021648388e008a6b6bc3fc2a3e91b06415f4585e9`;
- known feature mask `0xFF`;
- required feature mask `0x19`;
- eight feature declarations and eight known chunk declarations;
- 18/18 generated positive/negative scenarios matched expectation;
- ordinary file verification now returns both codec and registry evidence.

AM1 playback gate, workflow `30596274425`, code head
`c5f76b05789e64645c3d532f819dbfd107e33858`:

- V64 fixture: 1,732 bytes,
  `a61b40502b4fd4a079dcb4bef050c7c33b9a854a6126ad350d8800b2d454b469`;
- two `AURN` runs and two `SILN` spans;
- exact 96,000-sample accounting;
- decoded PCM: 192,000 bytes,
  `b7c875b16fb4673f806477679470b3d6fcde1c92df331a0ba4983c3c33da99a5`;
- all five seek windows match full-decode slices byte-for-byte.

AM1 preprocessing/bitrate workflow `30597112780`, code head
`626792677a4d1ade2c81340448082571ed55f26a`:

- deterministic stereo 44.1 kHz challenge source to canonical mono 48 kHz;
- checked high-pass, low-pass, compression, limiter, and canonical WAV framing;
- objective 4/8/12/16 kbit/s variants;
- blind artifact `8780557547` and separately concealed key `8780557677`;
- no bitrate frozen before genuine speech listening.

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
- [ ] Expose 32-glyph balanced as the primary preset and 64-glyph quality as the
  explicit additional option.
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
- [ ] Decode and composite `SUBT` exact-mask planes over base glyph video.
- [ ] Expose persisted `v64-crt-scanlines`, enabled by default, using the shared
  playback profile.
- [ ] Test duration, pause, seek, rate, EOF, repeated seeks, scanline default,
  live toggle, persistence, and viewport-phase stability.
- [ ] Document Windows and macOS build routes.

## Open-source governance and outreach

- [x] License the repository under `0BSD`.
- [x] Publish `CONTRIBUTING.md`, `GOVERNANCE.md`, `AGENTS.md`, `SECURITY.md`, and
  a pull-request evidence template.
- [x] State human-contributor primacy and welcome AI-assisted/agent-authored work
  under the same technical and security gates.
- [x] Open public contributor invitation issue #4 covering Rust, WebAssembly,
  players, integrations, compression, accessibility, packaging, and forks.
- [ ] Announce mature contribution opportunities to appropriate open-source,
  multimedia, retrocomputing, creative-coding, accessibility, preservation,
  and AI-development communities as the relevant interfaces stabilize.

Third-party agent communities are announcement surfaces only. All code,
evidence, issue reports, and decisions return through public GitHub review; no
repository secrets, private vulnerability reports, release authority, or
maintainer identity is delegated to those platforms.

## Next concrete step

Replace Grammar B's allocation-heavy parse-then-apply path with a bounded
single-pass JavaScript decoder while preserving exact states and malformed-input
rejection. Rerun the combined gate and require a substantial reduction from the
current +212.186% decode-time delta. Then begin the Rust core/container golden
implementation for the 32-glyph primary profile, optional 64-glyph profile,
cadence-derived group limits, optional encoder `META`, registry semantics,
raster state, subtitle planes, and audio timing.

Keep the AM1 bitrate key sealed until genuine blinded speech listening is
recorded. CRT scanlines remain mandatory and enabled by default for both the
native player and VLC plugin.
