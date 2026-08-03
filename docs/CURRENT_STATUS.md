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

PR #14 connects ordinary source audio to Video64 Drop using the existing AM1
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

The current encoder performs whole-file PCM analysis under a hard 256 MiB
ceiling, roughly 46 minutes of mono 48 kHz PCM16. Oversized inputs fail before
FFmpeg extraction starts. Streaming long-form AM1 encoding is not yet claimed.

### Checked application-core evidence

All six workflows triggered on immutable code head
`7e929bb40ec9c1cc45c4df503a6cd83c245dfa40` passed. Permanent application
workflow `30781816136` ran the focused tests, encoded the same real H.264/AAC
source twice, required byte-identical audiovisual outputs, independently decoded
the AM1 timeline, and independently verified the container.

The one-second source produced:

- 40×11 cells and 24 video frames;
- 7,282 video-only bytes, or 58,256 bits per second;
- one `AURN` run containing 51 Opus packets;
- 48,000 kept mono samples and zero `SILN` spans;
- 8,417 final audiovisual bytes, or 67,336 bits per second and 505,020 bytes per
  minute;
- 27 total chunks and independent verification success;
- 48,000 decoded samples / 96,000 PCM bytes with nonzero signal.

Checked identities:

- source SHA-256:
  `07a51b99fd75141590293cfa24094d770fe66d3dff60c78cc164e056a8df702c`;
- byte-identical output SHA-256:
  `d594404c64dc739b5ac5019989a74e4756bd4b8bc1b9446263c5011198d84a66`;
- decoded PCM SHA-256:
  `2e9b8818c3e9272c8ad1aec9fcccb47776708cafbc5351b6ffeefd551ed38edc`;
- completed job SHA-256:
  `78c1c55ed06a8104a4546b9d9f094247951bed80d274f53dad6588fad5bb842d`;
- evidence artifact: `8843920073`;
- artifact digest:
  `75cf2720c6d7e2946839dc472ba334d07c654f49928f45f82522e97c515c6d96`.

### Checked native-shell evidence

Permanent native-shell workflow `30781816155` passed on the same immutable code
head. It passed twelve-plus focused Node tests, six Rust shell tests, formatting,
strict clippy, release compilation, deterministic duplicate shell reports,
actual SDL2 window presentation under Xvfb, audiovisual encoding, and
independent verification.

The native default 80-column fixture produced:

- 80×23 cells and 24 video frames;
- 6,991 video-only bytes, or 55,928 bits per second;
- one `AURN` run containing 51 Opus packets and 48,000 kept samples;
- 8,119 final audiovisual bytes, or 64,952 bits per second;
- 27 chunks and independent verification success.

The shell report explicitly states `sourceAudioEncoding: true` and
`audioBitrateFrozen: false`.

Checked identities:

- native release binary SHA-256:
  `8c032d6e214c973cc5532f0864f734c08cbc368428b9a3407de43149c28eedd9`;
- source fixture SHA-256:
  `600eac1e20e979edb3b920d93896a258ea62edd5ccefe9c04b39190fbab22208`;
- output `.v64` SHA-256:
  `7497662d2084807ae6a0c1377f7eec02ba76382229208174235aadbbf8519f5b`;
- deterministic shell report SHA-256:
  `db325db5dc9b86ca5b8cb58b5508c352b54334a911c060365d612cf2d11b8ac1`;
- encode report SHA-256:
  `cbe3918118206eec62833c8d8e24d025b42c6ea74e93d6ba319fc467010aeb1b`;
- independent verification report SHA-256:
  `46ce0efda7a46db9f6e182ab910a589e2275e7990fa5470f5af0640be72013a1`;
- evidence artifact: `8843929544`;
- artifact digest:
  `1f2a08fa905b1962a6728f9039a16ae50b859ae775517c3fbd4abb1436ea6400`.

## Boundaries not yet claimed

- Genuine blinded AM1 speech listening remains mandatory before the normative
  audio bitrate profile can freeze.
- Streaming long-form AM1 encoding beyond the 256 MiB whole-file PCM ceiling is
  not implemented.
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
2. Add streaming/bounded-memory long-form AM1 encoding beyond the current 256 MiB
   whole-file PCM ceiling.
3. Add the sampled size estimator and decoded source/V64 preview without
   replacing exact post-encode verification.
4. Add a Linux package with bundled runtime dependencies, desktop file selection,
   application icon handling, and install/uninstall evidence.
5. Add Particle Lighting controls after its normative event and recovery policy
   is ready for application integration.
6. Continue broader browser/WebAssembly decoding, physical-device qualification,
   Windows/macOS packaging, and VLC integration in the planned product order.
