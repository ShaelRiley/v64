# Video 64 current development status

Updated: 2026-08-01

This file is the compact current-state companion to `IMPLEMENTATION_LEDGER.md`.
The ledger retains the historical evidence chain; this document records the
latest active frontier.

## Project invariants

- Project name: **Video 64**.
- File extension: `.v64`.
- Encoder application name: **Video64 Drop**.
- License: standard MIT, SPDX `MIT`.
- Canonical source alphabet: exactly 64 original 8×16 glyphs.
- Primary/default encoder budget: 32 glyphs.
- Explicit full-alphabet option: 64 glyphs.
- 16 glyphs remains research-only.
- Ordinary target: `balanced`; optional higher-rate target: `quality`.
- Independent groups remain capped at two seconds, with shorter groups allowed
  at scene cuts.
- Normative palette identity remains `V64-P256-1`.
- Human developers have primacy in outreach; AI-assisted and autonomous-agent
  contributors are also explicitly welcome to fork, modify, test, and submit
  implementations under the same permissive license.

## Public release state

Tag `v0.1.0-alpha.1` remains the first playable public Video 64 test release.
It contains the corrected portrait test video and Linux x86_64 base-video
player. The user played the release successfully on SteamOS and confirmed the
orientation and proportions.

That release asset is intentionally silent and predates native player profile
2. Its manifest and checksums remain the authoritative description of that
specific prerelease; the newer subtitle/audio and feature-length evidence does
not retroactively alter it.

## Format, encoder, and core state

Implemented and permanently gated:

- bounded V64 header/chunk/index/CRC/raw-DEFLATE parsing;
- complete Phase-1 and direct Grammar B command decoding;
- provisional Grammar B decision evidence, with Phase-1 retained as the
  compatibility and simplicity baseline;
- exact 32-glyph primary and 64-glyph full-alphabet encoder profiles;
- two-second independent-group ceiling derived from cadence;
- independent JavaScript and Rust `SUBT`/SM2 validation and canonicalization;
- independent JavaScript and Rust `AURN`/`SILN` validation and
  canonicalization;
- stable owning Rust decoder API version 1;
- stable bounded CLI inspect, verify, and state-stream commands;
- pointer-free C ABI version 1 with generation-checked sessions;
- bounded deterministic RGBA rendering from canonical glyph and palette
  assets;
- dependency-free `wasm32-unknown-unknown` renderer conformance;
- hostile-input, rollback, decompression, allocation, fuzz, renderer,
  WebAssembly, stable API, CLI, and C ABI gates.

Raw DEFLATE remains the current entropy leader. Grammar B remains provisional
rather than a frozen V1 grammar decision.

## Native standalone player profile 2

Pull request `#9` was squash-merged into `main` as
`0b50c7d5fbaeace10b9dba33dccda63f12302815`.

Player profile 2 adds:

- exact native `SUBT`/SM2 sparse-cell compositing after base-video
  rasterization;
- subtitle-frame transitions during underlying video repeat spans;
- mono 48 kHz libopus decoding for validated `AURN` packets;
- exact zero-valued PCM synthesis for validated `SILN` spans;
- declared pre-skip and end-trim enforcement;
- pause/resume, repeated seeking, EOF, and recovery synchronization;
- deterministic fixed 0.5×, 1×, and 2× presentation;
- bounded SDL audio-queue refill;
- a 256 MiB decoded PCM-timeline ceiling;
- raw little-endian PCM16 export for deterministic inspection;
- deterministic profile-v2 headless reports;
- real SDL video/audio smoke presentation under Xvfb with a dummy audio
  device.

CRT scanlines remain default-on, persisted, immediately toggleable through
`View → CRT Scanlines` or `C`, viewport-anchored, and strictly
presentation-only.

## Checked profile-v2 evidence

Permanent native-player workflow `30703860943` passed at immutable pull-request
head `d3ae297ae9c30d99e221c531346848dd3e3e01ce`.

- all 12 permanent pull-request workflows passed;
- duplicate procedural, subtitle, and audio reports were byte-identical;
- SUBT fixture: 2 chunks, 5 frames, 10 sparse entries;
- AM1 fixture: 2 AURN runs, 2 SILN spans, 54 Opus packets;
- decoded audio: 96,000 mono samples at 48 kHz, 192,000 PCM bytes;
- native PCM matched the explicit libopus reference decode byte-for-byte;
- PCM SHA-256:
  `d34fe310f0a9aa00f128d00ff7a8fa4b50d2e125d20347b83908e20bb25f89c0`;
- evidence artifact: `8819701746`;
- artifact digest:
  `a6218636f1e45968c6acbf92dbf88da6064d244a57d7cda880bbac9a43734c9f`.

## Checked feature-length synchronization evidence

Permanent workflow `30709579841` passed at immutable pull-request head
`554456a037e8393b5793326cddc418f6a7ea8b55`.

The deterministic 30-minute fixture contains:

- 900 independently seekable two-second groups;
- 43,200 nominal video frames;
- 900 keyframes and 900 repeat spans;
- 1,800 `AURN` runs and 1,800 exact `SILN` spans;
- 48,600 Opus packets;
- 86,400,000 mono samples at 48 kHz;
- 172,800,000 decoded PCM bytes, or 64.37% of the player ceiling.

The release gate ran twice and produced byte-identical reports. Across 4,941
irregular nanosecond increments and a separate single-increment comparison, it
reported zero accumulated tick drift, zero PCM sample-index drift, exact EOF,
stable repeated distant seeks, stable recovery after EOF, and exact pause and
0.5×/2× rate transitions. Peak resident memory was 176,464 KiB.

Checked identities:

- fixture SHA-256:
  `6cb462f16e2ebf9e0bf576210f1d8c6177cc9b69ba4f1045beef0252034d1f58`;
- report SHA-256:
  `4b667cfc198c5a9e9b10846082b4e68be1d2cb07db80e1996e7ca1520b25f2ce`;
- gate binary SHA-256:
  `91565e09695271a1af593994ffbc26dfabf8a70e2c082561b28bcd3fdad42443`;
- evidence artifact: `8821428834`;
- artifact digest:
  `3e422742a81fdb004fa85b3f89b8663a42b2a5353a037be1e37b0f096e49bb56`.

This proves deterministic player-clock, decoded video-record, and PCM timeline
alignment for a feature-length file without waiting thirty wall-clock minutes.
It does not measure operating-system mixer latency, audio-device oscillator
error, or physical hardware scheduler drift.

## Video64 Drop application core

Pull request `#12` establishes the first executable Video64 Drop application
tranche around the existing verified proof encoder. It intentionally freezes a
testable application contract before choosing the native desktop-shell toolkit.

The application core now provides:

- normative 24 fps, 80-column, 32-color, 32-glyph, `balanced` defaults;
- validation for all frozen cadence, palette, glyph-budget, and profile choices;
- FFprobe-backed source metadata and display-aspect analysis;
- aspect-aware row and raster-dimension derivation;
- deterministic output naming and collision-free batch output allocation;
- immutable queue and job documents with stable identifiers;
- explicit analysis, video encode, audio encode, mux, and verify stages;
- actionable failed-stage state and machine-readable progress events;
- isolated child-process invocation of the existing proof encoder rather than
  copied codec logic;
- independent final V64 verification;
- a headless Linux command surface suitable for the later desktop host.

Permanent workflow `30712779947` passed at immutable code head
`f5eed760bced9b2a0234abe1f3fd8d542fa3ff59`. The focused suite contains ten
application tests. The workflow then generated a real one-second H.264/AAC
source and encoded it through Video64 Drop with 24 fps, 40 columns, 16 colors,
32 glyphs, and the `balanced` profile.

Checked application evidence:

- source analysis: 320×180 H.264 video with mono 48 kHz AAC audio;
- derived grid: 40×11 cells, or 320×176 decoded raster pixels;
- encoded frames: 24;
- output bytes: 7,282;
- output bitrate: 58,256 bits per second;
- changed-cell percentage: 20.939%;
- keyframes: 1;
- chunks: 26;
- independent verification: valid;
- output SHA-256:
  `75d3d98a318aaa354aaad42b892126b9be0c60445b6f1ed24f00fad688353c7d`;
- evidence artifact: `8822412544`;
- artifact digest:
  `25af6009ce9ded104af5b790215fa5570351bd43eaebbdd4aeed930db7a02cbc`.

The source audio was detected and disclosed, the audio stage was explicitly
marked skipped, and the completed file was identified as silent. This tranche
does not silently discard audio or claim AM1 source encoding before it exists.

The official Google Docs design document records the checked player evidence
and remaining caveats; the Video64 Drop application-core evidence will be added
there after merge.

## Boundaries not yet claimed

- Genuine blinded AM1 speech listening is still mandatory before freezing the
  normative audio bitrate profile.
- Video64 Drop does not yet encode source audio; application-core outputs remain
  silent and disclose that limitation.
- The native drag-and-drop window, file picker, control surface, decoded preview,
  sampled size estimator, Particle Lighting controls, and packaged application
  are not yet claimed.
- Operating-system and physical-device A/V drift remain platform qualification
  work; the accelerated gate proves arithmetic and decoded-timeline alignment.
- Fixed 0.5× and 2× audio currently changes pitch through deterministic sample
  repetition or decimation; no opaque time-stretching algorithm is claimed.
- Windows and macOS packages are not yet claimed.
- The first public prerelease remains silent.

## Next mandatory gates

1. Build the Linux-first native Video64 Drop shell on the checked application
   core, including drag/drop or file selection, the frozen controls, queue state,
   visible warnings, progress, and completion output.
2. Complete genuine blinded AM1 speech listening and decide whether the current
   speech bitrate profile can freeze.
3. Connect AM1 source-audio encoding to Video64 Drop so ordinary audiovisual
   inputs no longer produce silent outputs.
4. Add the sampled size estimator and decoded source/V64 preview without
   replacing exact post-encode verification.
5. Add platform-specific real-device synchronization and packaging evidence as
   Windows and macOS player and encoder work becomes executable.
6. Continue broader browser/WebAssembly decoding and VLC integration in the
   planned product order.
