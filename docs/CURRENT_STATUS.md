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
- permanent read-only CI for resource, rollback, renderer, and WebAssembly
  conformance.

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

## Next mandatory gates

1. Add coverage-guided fuzz targets for the container parser, frame decoder,
   renderer boundary checks, subtitle/audio extensions, and WebAssembly surface.
2. Add deterministic allocation-regression budgets and adversarial-size corpora.
3. Expose the stable C ABI, then proceed toward the native player, Video64 Drop,
   and VLC integration.
4. Complete genuine blinded AM1 speech listening before bitrate freeze.
