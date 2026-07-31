# Video 64 current development status

Updated: 2026-07-31

This file is the compact current-state companion to `IMPLEMENTATION_LEDGER.md`.
The ledger retains the full historical evidence chain; this document records the
latest active frontier.

## Project and participation

- Project name: **Video 64**.
- File extension: `.v64`.
- License: maximally permissive Zero-Clause BSD, SPDX `0BSD`.
- Forks, modification, redistribution, and independent implementations require
  no permission.
- Human developers are the primary contributor community.
- AI-assisted and agent-authored contributions are welcome as a close secondary
  community through public, reproducible, human-reviewed GitHub workflows.
- Public contributor invitation: GitHub issue #4.

## Primary encoder profile

- Canonical source alphabet: 64 glyphs.
- Primary/default encoder budget: 32 glyphs.
- Explicit full-alphabet option: 64 glyphs.
- 16 glyphs: research-only.
- Ordinary target: `balanced`.
- Optional higher-rate target: `quality`.
- Maximum independent-group duration: two seconds, derived from cadence.
- Scene cuts may create shorter groups.

## Grammar and compression

The human-heavy combined decision gives human raster material 75% weight and
structural stress material 25%.

- Grammar B structural saving: 35.406%.
- Grammar B human regression: 0.733%.
- Weighted Grammar B saving: 8.302%.
- Direct JavaScript Grammar B overhead: 28.817%, reduced from 212.186%.
- Direct Grammar B peak sampled heap: 3,173,560 bytes, reduced from 16,422,632.
- Grammar B is the provisional byte winner, not a final V1 freeze.
- Phase-1 remains the compatibility and simplicity baseline.
- Raw DEFLATE remains the current entropy leader.

## Rust cross-language state

The Rust workspace uses pinned Rust 1.85.0, edition 2024, locked dependencies,
0BSD, and `#![forbid(unsafe_code)]`.

Completed:

- bounded V64 header/chunk/index/CRC/raw-DEFLATE parsing;
- cadence, palette-depth, feature, asset, and optional encoder-profile parsing;
- complete Phase-1 video command decoding;
- complete direct Grammar B video command decoding;
- debug and optimized-release tests;
- four-way JavaScript/Rust decoded-state agreement.

Four byte-identical outputs:

1. JavaScript Phase-1;
2. Rust Phase-1;
3. JavaScript direct Grammar B;
4. Rust direct Grammar B.

Decoded-state stream:

- bytes: 64,528;
- SHA-256:
  `df3e6e261ee73e64524785775fee032d52bd81fc9215079751b67702d9dff3b9`.

Deterministic Grammar B fixture:

- bytes: 13,102;
- SHA-256:
  `a1b51a75487160b369675b4d128640bf07b041cca6ea7e27ddcaee2b8324a4d9`.

Checked workflow: `30644889435`.
Checked artifact: `8798997215`.
Artifact ZIP SHA-256:
`7852ae12dabe18d766b893f1f87988955b14227cf7f8f7cf23086de3c6c6eed7`.

## Next mandatory gates

1. Rust/JavaScript `SUBT` subtitle-plane timeline agreement.
2. Rust/JavaScript `AURN` and `SILN` audio-timeline agreement.
3. Rust decoder resource and malformed-input measurements.
4. Renderer and raster hash agreement.
5. WebAssembly build and browser golden agreement.
6. Fuzz targets and allocation-limit regression corpus.
7. Stable C ABI, native player, Video64 Drop, and VLC integration.
8. Genuine blinded AM1 speech listening before bitrate freeze.
