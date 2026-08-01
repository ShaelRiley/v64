# Rust fuzz and allocation-regression gate

Workflow `30674870112` passed at implementation head
`5d3ec23a7bcc4fc3fc77abea3ba88a61bf4eba78`.

## Checked coverage

- All 131 JavaScript tests passed.
- Every Rust workspace target passed in debug and optimized release modes.
- Seven libFuzzer targets compiled for container, Phase-1, Grammar B, renderer,
  subtitle, audio, and WebAssembly-facing surfaces.
- A reproducible 29-seed corpus covered valid project fixtures and
  project-authored malformed structures.
- Every target completed 512 deterministic smoke iterations with seed 1.
- Maximum legal frame state, pathological command streams, aggregate container
  payloads, subtitle repeat expansion, audio timing, renderer allocation
  arithmetic, recovery after repeated malformed inputs, and WebAssembly
  accessor boundaries passed their exact deterministic checks.

## Checked identities

- Corpus manifest SHA-256:
  `acf0e1f72811a687afb2da848cc53a6b28a8f8328b6093a8d2c3e777a1ed3df4`
- Allocation report SHA-256:
  `76ea255cf40527359e34afc48d66930e72030dc47a0c6f4210c63c0d32ecc5ce`
- Expansion report SHA-256:
  `564330c69c8e41c3072a660649fc1135bc14ea182c0f33b0277439556df25641`
- Evidence artifact: `8810093827`
- Artifact ZIP SHA-256:
  `c33b97798756d363a4b216a20fa9697af2c8de35246cf19c35a49349fc6edb99`

The workflow uses Rust 1.85.0, pinned cargo-fuzz 0.12.0, and
nightly-2025-02-20 only for libFuzzer instrumentation. Scheduled and manual
deep runs use 20,000 iterations per target. Failure artifacts are retained even
when a gate fails.

Licensed under MIT. Copyright (c) 2026 Shael Riley.
