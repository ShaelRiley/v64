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
specific prerelease; the new subtitle/audio implementation does not
retroactively alter it.

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

The official Google Docs design document records the same checked evidence and
remaining caveats.

## Boundaries not yet claimed

- Genuine blinded AM1 speech listening is still mandatory before freezing the
  normative audio bitrate profile.
- Feature-length A/V drift evidence is not yet complete.
- Fixed 0.5× and 2× audio currently changes pitch through deterministic sample
  repetition or decimation; no opaque time-stretching algorithm is claimed.
- Windows and macOS packages are not yet claimed.
- The first public prerelease remains silent.

## Next mandatory gates

1. Complete genuine blinded AM1 speech listening and decide whether the current
   speech bitrate profile can freeze.
2. Produce feature-length synchronized playback evidence, including repeated
   seeks and drift measurements across long files.
3. Begin the Video64 Drop application tranche while preserving the current
   format, glyph, palette, and primary encoder invariants.
4. Continue broader browser/WebAssembly decoding and VLC integration in the
   planned product order.
