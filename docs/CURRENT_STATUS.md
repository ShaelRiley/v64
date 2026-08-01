# Video 64 current development status

Updated: 2026-08-01

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

That prerelease is intentionally silent and predates native player profile 2.
Its release manifest and checksums remain authoritative for those assets; newer
subtitle, audio, synchronization, and encoder-application evidence does not
retroactively alter it.

## Permanently gated codec and decoder state

The repository now includes and continuously checks:

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

## Video64 Drop application core

PR #12 merged the first executable Video64 Drop application foundation as
`728059d3bce9ea619a610bd583b94b3e24b9139b`.

The application core owns normative defaults and validation, FFprobe source
analysis, aspect-aware grid derivation, deterministic collision-safe queue
planning, stable job documents, analysis/video/audio/mux/verify stages,
machine-readable progress, actionable failure state, isolated proof-encoder
execution, and independent output verification.

Permanent workflow `30712779947` passed at immutable head
`f5eed760bced9b2a0234abe1f3fd8d542fa3ff59`. Its one-second 320×180 H.264/AAC
source encoded 24 frames to a verified 7,282-byte `.v64` file. Source audio was
detected and explicitly disclosed; the audio stage was skipped rather than
silently ignored. Evidence artifact `8822412544` has digest
`25af6009ce9ded104af5b790215fa5570351bd43eaebbdd4aeed930db7a02cbc`.

## Linux native Video64 Drop shell

PR #13 implements the first Linux/SteamOS native Video64 Drop window on top of
the checked application core. The optional Rust/SDL2 host does not duplicate the
codec or queue logic.

The shell now provides:

- startup file arguments and SDL file-drop events;
- the complete eleven-position cadence control;
- discrete columns, palette, 32/64-glyph, and profile controls;
- deterministic multi-file queue planning and collision-safe output paths;
- keyboard control for focus, settings, queue selection, encoding, retry,
  removal, output-folder access, and quit behavior;
- visible source-audio warnings;
- analysis, video, audio, mux, verify, completion, and failure presentation;
- sequential background encoding through the application core;
- independent final `.v64` verification;
- deterministic headless shell and encode reports;
- a real SDL2 window smoke test under Xvfb.

Permanent read-only workflow `30721506431` passed at immutable head
`80bc00b5c2a4374a0f4ce6838a9ae0a7be2da2f0`. Twelve Node application tests and
six Rust shell tests passed; strict formatting and clippy checks passed; and the
release binary opened the real SDL2 window under Xvfb.

The gate generated a one-second 320×180 H.264/AAC source, analyzed it as an
80×23-cell output, emitted 11 machine-readable progress events, encoded 24 video
frames, and independently verified a 7,186-byte `.v64` container with one
keyframe and 26 chunks. The audio stage was explicitly skipped and the result
remained silent.

Checked identities:

- native release binary SHA-256:
  `468ee00c2e22e68eab1fd65b47ffd65ecea6bf0ac292b0902eb38c1f25a64617`;
- source fixture SHA-256:
  `0d6f12104377d87549b857fc7f94ddf2e722d4b250e6be743cd1a7566dc60cfe`;
- output `.v64` SHA-256:
  `eadd4be993177b8559bea1bb15f76ea7c076ed4f7a64bb31c8b0f6436886342d`;
- deterministic shell report SHA-256:
  `0483071ce60baed1b727458cb637db02204c98c0e236c50c75dc7f0f8562d82d`;
- encode report SHA-256:
  `d40f0f795a46b35898dbcc49d2aad2d0048391c61f8f58b85778f21829ec3994`;
- independent verification report SHA-256:
  `20e5fb0b66a6509d2521271a002c7be025761b28d0073735b5550945a30cd62b`;
- evidence artifact: `8825009901`;
- artifact digest:
  `3c26b076ea1a03850ea9e7fe71a55ddbd03dd164a4c09f317f76da75741f2e49`.

## Boundaries not yet claimed

- Genuine blinded AM1 speech listening remains mandatory before the normative
  audio bitrate profile can freeze.
- Video64 Drop does not yet encode source audio. The native shell detects and
  visibly discloses source audio, but current output remains silent.
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

1. Connect AM1 source-audio encoding and muxing to Video64 Drop so ordinary
   audiovisual inputs no longer produce silent outputs.
2. Complete genuine blinded AM1 speech listening and decide whether the current
   speech bitrate profile can freeze.
3. Add the sampled size estimator and decoded source/V64 preview without
   replacing exact post-encode verification.
4. Add a Linux package with bundled runtime dependencies, desktop file selection,
   application icon handling, and install/uninstall evidence.
5. Add Particle Lighting controls after its normative event and recovery policy
   is ready for application integration.
6. Continue broader browser/WebAssembly decoding, physical-device qualification,
   Windows/macOS packaging, and VLC integration in the planned product order.
