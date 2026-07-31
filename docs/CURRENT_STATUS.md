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
- permanent read-only CI for the resource and rollback gate.

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

## Next mandatory gates

1. Add deterministic renderer and pixel-hash agreement.
2. Add a checked WebAssembly decoder build and browser interface.
3. Add coverage-guided fuzz targets and allocation-regression budgets.
4. Expose the stable C ABI, then proceed toward the native player, Video64 Drop,
   and VLC integration.
5. Complete genuine blinded AM1 speech listening before bitrate freeze.
