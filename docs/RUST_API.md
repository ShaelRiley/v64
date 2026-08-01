# Stable Rust decoder and CLI API

Status: API version 1 implemented pending promoted CI evidence.

Video 64's stable Rust decoding surface lives in
[`v64_core::decoder`](../crates/v64-core/src/decoder.rs). Its explicit
compatibility number is `DECODER_API_VERSION`; version 1 provides:

- `Decoder::from_bytes` for default bounded parsing;
- `Decoder::from_bytes_with_config` for caller-selected parser and resource
  limits beneath the immutable implementation ceilings;
- immutable access to the validated header/container;
- allocation-free repeat-frame advancement over the prior state;
- transactional Phase-1 frame decoding;
- stable EOF and reset behavior; and
- current-frame metadata and borrowed canonical cell state.

`Decoder` owns the parsed container. References returned from `header`,
`file`, and `current_state` cannot outlive it. Advancing or resetting the
decoder requires exclusive access, so Rust's borrow rules prevent a caller from
retaining a stale frame-state reference across mutation.

The public extension and renderer modules remain the stable bounded surfaces
for subtitle canonicalization, audio packet/timing validation, checked raster
layout, and deterministic RGBA rendering. A native player can inspect
`Decoder::file()` and pass validated extension payloads to those modules
without reparsing the container.

## Stable CLI

The `v64-cli` package installs the `v64` binary:

```bash
v64 --version
v64 inspect INPUT.v64
v64 verify INPUT.v64
v64 state-stream INPUT.v64 OUTPUT.bin
```

`inspect` emits deterministic `V64-CLI-INSPECT-1` JSON.
`verify` decodes the complete video timeline and emits deterministic
`V64-CLI-VERIFY-1` JSON. `state-stream` writes the cross-language
`V64GOLD1` conformance stream transactionally.

All three commands reject input beyond 1 GiB. They have no network behavior and
do not invoke a remote or perceptual decoder.

## Compatibility policy

The API version changes when documented decoder behavior or the meaning of an
existing public method changes incompatibly. New optional functionality may be
added without changing version 1. The crate remains pre-1.0, so consumers must
also pin the Cargo package version until the package reaches semantic-versioning
stability.

The separate C compatibility boundary is specified in
[`spec/V64-c-api-v1.md`](../spec/V64-c-api-v1.md).
