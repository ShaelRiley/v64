# Stable Rust API, CLI, and C ABI gate

Permanent workflow `30677740575` passed at implementation head
`11cb07f609b7cc8b724ee2beaa43dbd106ab3a93`.

## Checked coverage

- All 131 JavaScript tests passed.
- Every Rust workspace target passed with Rust 1.85.0 in debug and optimized
  release modes.
- The stable `v64` CLI built and emitted repeatable inspect/verify reports.
- The C ABI shared library exported exactly the 22 allowed `v64_*` symbols.
- Strict C11 and C++17 callers compiled, linked, and executed.
- JavaScript, the Rust CLI, and the real C caller emitted byte-identical
  64,528-byte `V64GOLD1` decoded-state streams.
- The C caller checked valid frame/header access, the one-past byte sentinel,
  reset/destroy lifecycle, and stale-handle rejection.
- Rust tests checked the 16-session ceiling, exact 1 GiB configuration boundary,
  just-outside rejection, repeated malformed/reset recovery, transactional input
  limits, stable EOF/reset, and allocation-free repeat state reuse.

## Checked identities

- Implementation head: `11cb07f609b7cc8b724ee2beaa43dbd106ab3a93`
- Workflow: `30677740575`
- Evidence artifact: `8811105113`
- Artifact ZIP SHA-256:
  `e9fdf29c7e204cbf1779882ea3820dfb171b6abfa839a772ea6223178ec82860`
- JavaScript/Rust/C state stream SHA-256:
  `df3e6e261ee73e64524785775fee032d52bd81fc9215079751b67702d9dff3b9`
- C conformance report SHA-256:
  `4655758a3ae0ef6a4161cde64f735cade67a3d9b339dd69ed31b712300ccd9ee`
- CLI inspect report SHA-256:
  `f3819dae3a15dd67dbe3ac41b4d49959195dae6986b6596cc6096c00b5f40bed`
- CLI verify report SHA-256:
  `8584a25e3d36837ac7d35fc123883f461034ff9c19cffe202a9fcff5f59e4b9f`
- Export manifest SHA-256:
  `7e6073070792ec1ecc610d9a7eedde99da9a3a318d953f6279ea9766a8858097`
- Linux shared library SHA-256:
  `02b06c835432ff047ea6579b6cca2810c101fe85a3a75d859487d4d0b7e43c8e`
- Linux CLI SHA-256:
  `924eee8305ec4a443b366e5c2c82a8952feb1d737cb0e0522e19369e330bb47d`

The C ABI is pointer-free: only fixed-width scalars cross the boundary. It has
no network path, callback, caller allocator, exposed Rust layout, or unbounded
session/input/payload allocation.

Licensed under MIT. Copyright (c) 2026 Shael Riley.
