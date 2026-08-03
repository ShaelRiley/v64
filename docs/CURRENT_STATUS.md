# Video 64 current development status

Updated: 2026-08-02

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
- Human developers have primacy in outreach. AI-assisted and autonomous-agent
  contributors are also explicitly welcome to fork, modify, test, and submit
  implementations under the same permissive license.

## Public release state

Tag `v0.1.0-alpha.1` remains the first playable public Video 64 prerelease. It
contains the corrected portrait test video and Linux x86_64 base-video player.
The user successfully played that release on SteamOS and confirmed its
orientation and proportions.

That prerelease is intentionally silent and predates native player profile 2 and
Video64 Drop source-audio encoding. Its release manifest and checksums remain
authoritative for those assets; newer subtitle, audio, synchronization, and
encoder-application evidence does not retroactively alter it.

## Permanently gated codec and decoder state

The repository continuously checks:

- bounded header, chunk, index, CRC, and raw-DEFLATE parsing;
- complete Phase-1 and direct Grammar B frame-command decoding;
- exact 32-glyph primary and 64-glyph full-alphabet encoder profiles;
- cadence-derived two-second independent-group enforcement;
- JavaScript and Rust `SUBT`/SM2 validation and canonicalization;
- JavaScript and Rust `AURN`/`SILN` validation and canonicalization;
- stable owning Rust decoder API version 1;
- stable bounded CLI inspect, verify, and state-stream commands;
- pointer-free C ABI version 1 with generation-checked sessions;
- deterministic RGBA rendering from canonical assets;
- dependency-free `wasm32-unknown-unknown` renderer conformance;
- hostile-input, rollback, decompression, allocation, fuzz, renderer,
  WebAssembly, stable API, CLI, and C ABI gates.

Raw DEFLATE remains the current entropy leader. Grammar B remains provisional
rather than a frozen V1 grammar decision.

## Native player profile 2

PR #9 merged native subtitle and audio presentation as
`0b50c7d5fbaeace10b9dba33dccda63f12302815`.

The standalone player composites validated `SUBT`/SM2 subtitles, decodes
validated `AURN` Opus packets, synthesizes exact `SILN` zeros, enforces trim and
sample accounting, supports deterministic seeking, pause, EOF recovery, and
0.5×/1×/2× playback, and presents through bounded SDL video and audio queues.
CRT scanlines remain default-on, immediately toggleable, persisted, and strictly
presentation-only.

Permanent workflow `30703860943` passed at immutable head
`d3ae297ae9c30d99e221c531346848dd3e3e01ce`. Its AM1 fixture decoded 54 Opus
packets into 96,000 mono 48 kHz samples, and native PCM matched the explicit
libopus reference decode byte-for-byte with SHA-256
`d34fe310f0a9aa00f128d00ff7a8fa4b50d2e125d20347b83908e20bb25f89c0`.
Evidence artifact `8819701746` has digest
`a6218636f1e45968c6acbf92dbf88da6064d244a57d7cda880bbac9a43734c9f`.

## Feature-length synchronization evidence

PR #11 added the deterministic feature-length player-clock gate. Permanent
workflow `30709579841` passed at immutable head
`554456a037e8393b5793326cddc418f6a7ea8b55`.

The 30-minute fixture contains 900 independently seekable groups, 43,200 nominal
frames, 1,800 `AURN` runs, 1,800 exact `SILN` spans, 48,600 Opus packets, and
86,400,000 mono samples. Duplicate accelerated runs reported zero accumulated
tick drift, zero PCM sample-index drift, exact EOF, stable distant seeks, stable
recovery, and exact pause and rate transitions. Peak resident memory was
176,464 KiB.

Fixture SHA-256 is
`6cb462f16e2ebf9e0bf576210f1d8c6177cc9b69ba4f1045beef0252034d1f58`;
report SHA-256 is
`4b667cfc198c5a9e9b10846082b4e68be1d2cb07db80e1996e7ca1520b25f2ce`;
evidence artifact `8821428834` has digest
`3e422742a81fdb004fa85b3f89b8663a42b2a5353a037be1e37b0f096e49bb56`.

This proves deterministic decoded video, PCM timeline, and player-clock
alignment. It does not measure operating-system mixer latency, audio-device
oscillator error, or physical hardware scheduler drift.

## Video64 Drop application and Linux shell

PR #12 merged the deterministic Video64 Drop application foundation as
`728059d3bce9ea619a610bd583b94b3e24b9139b`. PR #13 merged the first
Linux/SteamOS Rust/SDL2 window as
`ceaed4dd0c47a2a62c115adf2b3ea0e56a69fec9`.

The application and shell provide:

- normative defaults and validation;
- FFprobe source analysis and aspect-aware grid derivation;
- deterministic collision-safe queue planning;
- startup file arguments and SDL file-drop events;
- discrete cadence, columns, palette, 32/64-glyph, and profile controls;
- keyboard queue selection, encoding, retry, removal, output-folder access, and
  quit behavior;
- explicit analysis, video encode, audio encode, mux, verify, completion, and
  failure states;
- sequential background execution and independent final `.v64` verification;
- deterministic headless reports and a real SDL2 window gate under Xvfb.

## Video64 Drop AM1 source-audio encoding

PR #14 connected ordinary source audio to Video64 Drop using the existing AM1
container and decoder semantics. The implementation:

- extracts the first source-audio stream as mono 48 kHz PCM16;
- aligns PCM exactly to the encoded V64 video duration, trimming or zero-padding
  when necessary;
- detects qualifying long silence with the checked hysteretic detector;
- maps silence to exact `SILN` spans;
- maps audible regions to standard constrained-VBR libopus `AURN` runs;
- bounds each audible run to 60 seconds;
- remuxes the verified video and metadata timeline with the complete AM1 audio
  timeline;
- independently verifies the finished audiovisual `.v64`;
- retains an explicit skipped audio stage for sources without audio.

The active profile is `AM1-PROVISIONAL-8K`: mono 48 kHz, constrained VBR,
8 kbps, and 20 ms packets. It is explicitly marked `normative: false`. Genuine
blinded speech listening remains mandatory before this bitrate can freeze.

PR #15 replaces the former duration-limited whole-file PCM production path with
bounded disk-spooled two-pass processing:

- FFmpeg writes exact-duration PCM directly to a temporary spool file;
- the checked hysteretic silence detector now has a stateful form that preserves
  exact decisions across arbitrary input chunk boundaries;
- pass one scans the spool in fixed-size reads without buffering the recording;
- pass two reads and encodes at most one bounded 60-second audible run at a time;
- the default source-PCM buffer bound is 5,760,000 bytes;
- temporary disk use is 96,000 bytes per second of mono 48 kHz PCM16 duration;
- the legacy in-memory helper remains available for fixtures only and retains an
  explicit 256 MiB ceiling.

This is bounded long-form file encoding, not a one-pass live-capture encoder.

### Checked streaming application-core evidence

All eight workflows triggered on immutable code head
`15a72e9862d682339936595601e7aa20ac589082` passed or were retained as broad
regressions before documentation finalization. Permanent application workflow
`30783825634` passed the 18 focused tests, stateful-detector parity, disk-spooled
versus in-memory AM1 byte equality, the long-form bound, deterministic duplicate
Video64 Drop output, independent AM1 decoding, and independent container
verification.

The long-form sparse-spool gate processed:

- 47 minutes / 2,820 seconds;
- 169,200,000 V64 ticks;
- 135,360,000 mono samples;
- 270,720,000 PCM bytes, beyond the former 268,435,456-byte ceiling;
- 259 fixed-size scan reads of at most 1,048,576 bytes;
- one exact full-duration `SILN` span;
- a 5,760,000-byte maximum configured source-PCM buffer, under 6 MiB;
- zero whole-file PCM buffering.

The ordinary one-second audiovisual fixture remained byte-identical to the
pre-streaming output and produced:

- 40×11 cells and 24 video frames;
- one `AURN` run containing 51 Opus packets;
- 48,000 kept mono samples;
- 8,417 final audiovisual bytes and 27 chunks;
- exactly 48,000 decoded samples / 96,000 nonzero PCM bytes;
- independent verification success.

Checked identities:

- source SHA-256:
  `07a51b99fd75141590293cfa24094d770fe66d3dff60c78cc164e056a8df702c`;
- byte-identical output SHA-256:
  `d594404c64dc739b5ac5019989a74e4756bd4b8bc1b9446263c5011198d84a66`;
- decoded PCM SHA-256:
  `2e9b8818c3e9272c8ad1aec9fcccb47776708cafbc5351b6ffeefd551ed38edc`;
- completed job SHA-256:
  `2720557f30f108baed9cdb215a80a8334600f15ab5a50722703bcf932513ddb1`;
- long-form report SHA-256:
  `8c7112aa1deb12af2fd35a5f33a1d127e9adf839da28bf94929539b9a7787119`;
- evidence artifact: `8844560891`;
- artifact digest:
  `2f2146407f578370b095e133ed32fb647a34fcafbd488f8c41f57f63a7067cca`.

### Checked streaming native-shell evidence

Permanent native-shell workflow `30783825616` passed on the same immutable code
head. It passed the expanded Node tests, Rust shell tests, formatting, strict
clippy, release compilation, deterministic duplicate shell reports, actual SDL2
window presentation under Xvfb, streaming audiovisual encoding, and independent
verification.

The native fixture reported `strategy: disk-spooled-two-pass`,
`wholeFilePcmBuffered: false`, and a 5,760,000-byte source-PCM buffer bound. It
produced a verified 8,314-byte audiovisual `.v64` with one `AURN` run, 51 Opus
packets, 48,000 kept samples, and 27 chunks.

Checked identities:

- native release binary SHA-256:
  `8c032d6e214c973cc5532f0864f734c08cbc368428b9a3407de43149c28eedd9`;
- source fixture SHA-256:
  `0d6f12104377d87549b857fc7f94ddf2e722d4b250e6be743cd1a7566dc60cfe`;
- output `.v64` SHA-256:
  `f64d13751f96a243e59411822e958c00301218649d314a728087d3c0f92831ab`;
- deterministic shell report SHA-256:
  `db325db5dc9b86ca5b8cb58b5508c352b54334a911c060365d612cf2d11b8ac1`;
- encode report SHA-256:
  `07db04d786f9d0d811f550c7204ab85d686ccbe2f104206a357fdf1b22cc8319`;
- independent verification report SHA-256:
  `46ce0efda7a46db9f6e182ab910a589e2275e7990fa5470f5af0640be72013a1`;
- evidence artifact: `8844569353`;
- artifact digest:
  `18a903e8869a8f52d25a9f8c911f45f501791a2da8f818acc6fa44afe3a9395b`.

## Boundaries not yet claimed

- Genuine blinded AM1 speech listening remains mandatory before the normative
  audio bitrate profile can freeze.
- Disk-spooled long-form encoding is not a one-pass live-capture encoder and
  requires temporary storage proportional to source duration.
- The native shell does not yet include decoded source/V64 preview, sampled size
  estimation, Particle Lighting controls, active-job cancellation, a bundled
  Node runtime, desktop file picker, or installable Linux package.
- Operating-system and physical-device A/V drift remain platform qualification
  work.
- Fixed 0.5× and 2× player audio changes pitch through deterministic sample
  repetition or decimation; no opaque time-stretching algorithm is claimed.
- Windows and macOS player and encoder packages are not yet claimed.
- The first public prerelease remains silent.

## Next mandatory gates

1. Complete genuine blinded AM1 speech listening and decide whether the current
   8 kbps speech candidate can freeze.
2. Add the sampled size estimator and decoded source/V64 preview without
   replacing exact post-encode verification.
3. Add a Linux package with bundled runtime dependencies, desktop file selection,
   application icon handling, and install/uninstall evidence.
4. Add Particle Lighting controls after its normative event and recovery policy
   is ready for application integration.
5. Continue broader browser/WebAssembly decoding, physical-device qualification,
   Windows/macOS packaging, one-pass live capture research, and VLC integration
   in the planned product order.
