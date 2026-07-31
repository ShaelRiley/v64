# Video 64 current development status

Updated: 2026-07-31

This file is the compact current-state companion to `IMPLEMENTATION_LEDGER.md`.
The ledger retains the historical evidence chain; this document records the
latest active frontier.

## Project, license, and participation

- Project name: **Video 64**.
- File extension: `.v64`.
- License: MIT, SPDX `MIT`.
- Copyright notice: `Copyright (c) 2026 Shael Riley`.
- Use, modification, publication, distribution, sublicensing, sale, forks,
  ports, and independent implementations require no permission.
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

## Rust cross-language state

The Rust workspace uses pinned Rust 1.85.0, edition 2024, locked dependencies,
the MIT License, and `#![forbid(unsafe_code)]`.

Completed:

- bounded V64 header/chunk/index/CRC/raw-DEFLATE parsing;
- cadence, palette-depth, feature, asset, and encoder-profile validation;
- complete Phase-1 and direct Grammar B video command decoding;
- four-way JavaScript/Rust decoded-state agreement;
- independent Rust `SUBT`/SM2 subtitle validation and canonicalization;
- independent Rust `AURN`/`SILN` audio timing validation and canonicalization;
- byte-identical JavaScript/Rust subtitle and audio semantic streams.

Checked video decoded-state stream:

- bytes: 64,528;
- SHA-256:
  `df3e6e261ee73e64524785775fee032d52bd81fc9215079751b67702d9dff3b9`.

Checked extension semantic streams:

- `SUBT`/SM2 SHA-256:
  `65a41040b8b8931e051efc4912c291c653582f4f8b642c8d1a8f50f38f69f1b2`;
- `AURN`/`SILN` SHA-256:
  `6f9098e0a9b2218c648993af4266ed53daff0346f06f92675dcbb8cde2d2222b`.

## Active hostile-input tranche

The branch now contains `v64-hostile-gate` and a dedicated CI workflow. The
first tranche requires:

- at least 24 deterministic malformed-input cases;
- 64 identical rejections per case;
- a successful valid-file reparse after every hostile case;
- byte-identical reports across two complete runs;
- a ten-second cap per complete run;
- a 256 MiB process RSS ceiling.

The first checked workflow is pending. This tranche does not yet finalize
raw-DEFLATE worst-case expansion, complete transactional frame-rollback
malformed vectors, or replace coverage-guided fuzzing.

## Next mandatory gates

1. Check and record the first hostile-input/resource workflow.
2. Add parameterized decompression-expansion and transactional rollback cases.
3. Add renderer and raster hash agreement.
4. Add WebAssembly build and browser golden agreement.
5. Add coverage-guided fuzz targets and an allocation-limit regression corpus.
6. Expose the stable C ABI, then proceed toward the native player, Video64 Drop,
   and VLC integration.
7. Complete genuine blinded AM1 speech listening before bitrate freeze.
