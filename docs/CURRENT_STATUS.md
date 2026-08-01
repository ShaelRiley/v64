# Video 64 current development status

Updated: 2026-07-31

This file is the compact current-state companion to `IMPLEMENTATION_LEDGER.md`.
The ledger retains the historical evidence chain; this document records the
latest active frontier.

## Project, license, and participation

- Project name: **Video 64**.
- File extension: `.v64`.
- License: standard MIT, SPDX `MIT`.
- Copyright notice: `Copyright (c) 2026 Shael Riley`.
- Use, copying, modification, merging, publication, distribution, sublicensing,
  sale, commercial use, forks, ports, glyph-library reuse, and independent
  implementations require no permission.
- Copies or substantial portions must retain the copyright and permission
  notice; no approval, advertising, share-alike, field-of-use, or noncommercial
  condition is added.
- Human developers, AI-assisted developers, and autonomous AI agents have equal
  standing to choose projects and workflows, create forks, open issues, submit
  pull requests, and build independent implementations.
- Protected merges, releases, private security handling, credentials, and legal
  representation remain authorized-maintainer capabilities rather than a
  contributor hierarchy.
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

## Rust cross-language and hardening state

The Rust workspace uses pinned Rust 1.85.0, edition 2024, locked dependencies,
the MIT License, and `#![forbid(unsafe_code)]`.

Completed:

- bounded V64 header/chunk/index/CRC/raw-DEFLATE parsing;
- cadence, palette-depth, feature, asset, and encoder-profile validation;
- complete Phase-1 and direct Grammar B video command decoding;
- four-way JavaScript/Rust decoded-state agreement;
- independent Rust `SUBT`/SM2 subtitle validation and canonicalization;
- independent Rust `AURN`/`SILN` audio timing validation and canonicalization;
- byte-identical JavaScript/Rust subtitle and audio semantic streams;
- deterministic hostile-container rejection and valid-file recovery;
- caller-selectable inflated-chunk ceilings beneath the immutable compiled hard
  ceiling;
- transactional Phase-1 frame decoding with prior-state immutability after
  malformed partial writes;
- bounded deterministic RGBA rasterization from canonical glyph and palette
  assets;
- byte-identical JavaScript/Rust normative and synthetic-palette rasters;
- a dependency-free `wasm32-unknown-unknown` renderer conformance module;
- byte-identical Node and headless-Chrome WebAssembly raster reconstruction;
- permanent cargo-fuzz targets for the container, Phase-1, direct Grammar B,
  renderer, subtitle, audio, and WebAssembly-facing surfaces;
- a reproducible project-owned 29-seed corpus with deterministic PR smoke and
  scheduled/manual deep profiles;
- exact allocation and adversarial-size gates across container payload totals,
  frame state, command bounds, subtitle expansion, audio timing, renderer
  arithmetic, recovery, and WebAssembly accessors;
- stable owning Rust decoder API version 1 with borrowed current-state access,
  allocation-free repeats, transactional advancement, stable EOF, and reset;
- stable bounded `v64` CLI inspect, verify, and state-stream commands;
- pointer-free C ABI version 1 with 16 generation-checked sessions, caller-set
  input/payload ceilings, panic containment, and exact export allowlisting;
- real C11/C++17 caller conformance and JavaScript/Rust/C decoded-state identity;
- permanent read-only CI for resource, rollback, renderer, WebAssembly, stable
  Rust API/CLI, and C ABI conformance.

Checked video decoded-state stream:

- bytes: 64,528;
- SHA-256:
  `df3e6e261ee73e64524785775fee032d52bd81fc9215079751b67702d9dff3b9`.

Checked extension semantic streams:

- `SUBT`/SM2 SHA-256:
  `65a41040b8b8931e051efc4912c291c653582f4f8b642c8d1a8f50f38f69f1b2`;
- `AURN`/`SILN` SHA-256:
  `6f9098e0a9b2218c648993af4266ed53daff0346f06f92675dcbb8cde2d2222b`.

## Checked hostile-container tranche

Workflow `30648764459` passed 29 malformed cases × 64 repetitions.

- duplicate complete runs: byte-identical;
- canonical report SHA-256:
  `27b6494aab8f804adcb3290da46ad1b7c42c16c1c70a32eb1e2356f3e4375b0b`;
- first-run wall time: 0.04 seconds;
- first-run peak RSS: 2,672 KiB;
- valid parser fingerprint recovered after every hostile case:
  `120000:49:1:11787:19564:40x11`.

## Checked decompression and rollback tranche

Permanent workflow `30652118661` passed at head
`4d4324b822439e543f9c5665a9baf5d635eb1859`.

Resource gate:

- stored raw-DEFLATE bytes: 79;
- inflated bytes: 65,536;
- expansion ratio: approximately 829.569:1;
- exact configured boundary accepted;
- one byte below the expanded size rejected deterministically;
- zero cannot disable protection;
- configured limits cannot exceed the compiled 1 GiB hard ceiling;
- 3 cases × 64 repetitions;
- report SHA-256:
  `536671a330caebeb5a109031375592c80d094a876890f41e6d4e8e35a16cbcaf`.

Transactional rollback gate:

- 5 malformed partial-write command streams × 64 repetitions;
- prior validated frame state remained immutable;
- a subsequent valid delta decoded identically after every failure;
- report SHA-256:
  `72f8b9a56aff12f5edaece47a189b28aff0d3dbd8211652f8730ae8b35848d13`.

Evidence artifact: `8801795192`; artifact ZIP SHA-256:
`5a2a4c82ff714793651988369d898870f7f3c19b7cfaea2d2d09d6f3f4e10e3e`.

## Checked renderer and WebAssembly tranche

Permanent workflow `30655257956` passed at implementation head
`6ac241c1a4ba6987060ec0145df9f0c32dcccac8`.

- fixture: 8 × 8 cells containing all 64 canonical glyphs;
- output: 64 × 128 RGBA, 32,768 bytes;
- all 131 JavaScript tests passed;
- every Rust target passed in debug and optimized release modes;
- JavaScript and Rust normative raster: byte-identical;
- two Rust synthetic-palette renders: byte-identical;
- Node and headless Chrome reconstructed every WebAssembly output byte;
- pixel mismatches: zero;
- invalid bytes: zero;
- out-of-range byte sentinel: 256;
- normative RGBA SHA-256:
  `22c5658edd3d14167d7b29a49beef58511ac5e0785e27b30a613fa0dfd560be0`;
- synthetic RGBA SHA-256:
  `751d51c7871fe9f545becc45ce5f3601300f824d61d4555decfac4cb8d988487`;
- WebAssembly binary SHA-256:
  `bfc4c0bc94dc706c99b777f5799345bccf1807b7499d1538176d5d43c866ed59`;
- evidence artifact: `8802996633`;
- artifact ZIP SHA-256:
  `150ab65aca1e97b87949c2986ca3be62643726890340de837a4ffacb0962b3d7`.

## Checked fuzz and allocation-regression tranche

Permanent workflow `30674870112` passed at implementation head
`5d3ec23a7bcc4fc3fc77abea3ba88a61bf4eba78`.

- all 131 JavaScript tests passed;
- every Rust target passed in debug and optimized release modes;
- all seven cargo-fuzz/libFuzzer targets compiled;
- the 29-seed corpus reproduced byte-for-byte;
- every target completed 512 deterministic smoke iterations with seed 1;
- maximum legal frame state is 262,144 cells / 786,432 committed bytes;
- maximum legal raster is 4,096 × 8,192 / 134,217,728 RGBA bytes;
- 64 repeated malformed/recovery iterations passed for Phase-1 and Grammar B;
- container aggregate payload, subtitle frame/entry, audio packet/timing, and
  WebAssembly accessor boundaries rejected deterministically;
- corpus manifest SHA-256:
  `acf0e1f72811a687afb2da848cc53a6b28a8f8328b6093a8d2c3e777a1ed3df4`;
- allocation report SHA-256:
  `76ea255cf40527359e34afc48d66930e72030dc47a0c6f4210c63c0d32ecc5ce`;
- expansion report SHA-256:
  `564330c69c8e41c3072a660649fc1135bc14ea182c0f33b0277439556df25641`;
- evidence artifact: `8810093827`;
- artifact ZIP SHA-256:
  `c33b97798756d363a4b216a20fa9697af2c8de35246cf19c35a49349fc6edb99`.

The SM2 parser now checks declared frame count, expected duration, and
canonical-entry budgets before retaining repeated planes. This closes the
allocation-amplification path found while constructing the adversarial corpus.

## Checked stable Rust API, CLI, and C ABI tranche

Permanent workflow `30677740575` passed at implementation head
`11cb07f609b7cc8b724ee2beaa43dbd106ab3a93`.

- all 131 JavaScript tests passed;
- every Rust workspace target passed in debug and optimized release modes;
- exact 22-symbol C export allowlist passed;
- strict C11 and C++17 callers compiled, linked, and executed;
- JavaScript, Rust CLI, and C state streams were byte-identical at 64,528 bytes;
- stable CLI inspect and verify reports repeated byte-for-byte;
- C valid/one-past access, reset/destroy, and stale-handle behavior passed;
- state stream SHA-256:
  `df3e6e261ee73e64524785775fee032d52bd81fc9215079751b67702d9dff3b9`;
- C report SHA-256:
  `4655758a3ae0ef6a4161cde64f735cade67a3d9b339dd69ed31b712300ccd9ee`;
- export manifest SHA-256:
  `7e6073070792ec1ecc610d9a7eedde99da9a3a318d953f6279ea9766a8858097`;
- evidence artifact: `8811105113`;
- artifact ZIP SHA-256:
  `e9fdf29c7e204cbf1779882ea3820dfb171b6abfa839a772ea6223178ec82860`.

## Checked native-player tranche

Permanent workflow `30679295472` passed at implementation head
`da0f09e954fba70da301f506e4d3f6f8d4a99b11`.

- all 131 JavaScript tests passed;
- every Rust workspace target passed in debug and optimized release modes;
- Linux-first SDL2 glyph-video playback compiled on Rust 1.85.0;
- pause, exact 0.5×/1×/2× rates, repeated forward/backward seeking, EOF, and
  recovery after EOF passed;
- `View → CRT Scanlines` and the `C` keyboard toggle use the default-on 0.18,
  period-2, phase-1 viewport-anchored presentation profile;
- the deterministic headless report repeated byte-for-byte;
- the real native window loop completed three presentations under Xvfb;
- SUBT/AURN/SILN timelines are validated before playback, including rejection
  of orphan `SILN` chunks;
- normative `V64-P256-1` and the immutable legacy proof-palette hash are the
  only registered native palette identities;
- headless report SHA-256:
  `29f730b4fe3f9ecfefc58de7b32b209c78df37989df741606d286ed24fca58cf`;
- release player SHA-256:
  `18f3f52cf1a756588659626da0e02ba59c2a59e3f67aeb03a8c5c1146c71edbd`;
- evidence artifact: `8811651756`;
- artifact ZIP SHA-256:
  `25cc32166b6c105a05b64ee1bdeca710c8c7876eaa1cc96204574c185d5f53fb`.

The first native tranche presents base glyph video. Subtitle compositing, Opus
audio output, and Windows/macOS packaging are not yet claimed.

## Next mandatory gates

1. Complete native-player SUBT compositing and AURN/SILN audio presentation.
2. Continue with Video64 Drop, broader WebAssembly/browser decoding, and VLC
   integration in the planned product order after native playback is complete.
3. Complete genuine blinded AM1 speech listening before bitrate freeze.
