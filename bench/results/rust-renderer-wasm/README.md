# Rust renderer and WebAssembly conformance

Workflow `30655257956` passed at implementation head
`6ac241c1a4ba6987060ec0145df9f0c32dcccac8`.

The gate uses one 8 × 8 cell atlas containing every canonical Video 64 glyph.
Each decoded cell is rasterized to an 8 × 16 RGBA block, yielding a 64 × 128
frame and exactly 32,768 output bytes.

## Checked agreement

- All 131 JavaScript repository tests passed.
- Every Rust target passed in debug and optimized release modes.
- JavaScript and Rust produced byte-identical RGBA using normative
  `V64-P256-1`.
- Two independent Rust synthetic-palette renders were byte-identical.
- The dependency-free `wasm32-unknown-unknown` module compiled successfully.
- Node instantiated the WebAssembly module and reconstructed all 32,768 bytes.
- Headless Chrome independently reconstructed the same 32,768 bytes.
- No pixel mismatch or invalid byte occurred.
- The out-of-range WebAssembly byte accessor returned the required sentinel
  value 256.

## Canonical identities

- Canonical glyph asset SHA-256:
  `9a75062711504dc9b2d473cdc261e0a8e34ff349ed9a8e1dc293467e9215da2b`
- Normative palette SHA-256:
  `c03d23141eb33b80d79d1a7f3167eeb18ccf1f4f0c0f81572f269abd51317105`
- Normative RGBA SHA-256:
  `22c5658edd3d14167d7b29a49beef58511ac5e0785e27b30a613fa0dfd560be0`
- Synthetic-palette RGBA SHA-256:
  `751d51c7871fe9f545becc45ce5f3601300f824d61d4555decfac4cb8d988487`
- Normative RGBA FNV-1a 64:
  `df686791d877a76f`
- Synthetic RGBA FNV-1a 64:
  `00bf8840a3a1ec6f`
- WebAssembly binary SHA-256:
  `bfc4c0bc94dc706c99b777f5799345bccf1807b7499d1538176d5d43c866ed59`

Evidence artifact: `8802996633`.
Artifact ZIP SHA-256:
`150ab65aca1e97b87949c2986ca3be62643726890340de837a4ffacb0962b3d7`.

Licensed under MIT. Copyright (c) 2026 Shael Riley.
