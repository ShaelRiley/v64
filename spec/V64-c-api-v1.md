# Video 64 stable C API v1

Status: implemented compatibility boundary pending promoted CI evidence.

This document freezes version 1 of Video 64's decoder-facing C ABI. The public
header is [`include/video64/v64.h`](../include/video64/v64.h), and the exact
export allowlist is [`spec/v64-c-api-v1.symbols`](v64-c-api-v1.symbols).

## Design contract

The ABI uses only fixed-width scalar arguments and return values. Callers never
give Rust a pointer, buffer, callback, allocator, structure layout, or string.
Input enters as one byte or one little-endian word of one to four bytes. Decoded
state and bounded error text leave through indexed byte accessors.

This deliberately narrow interface provides:

- deterministic ownership through generation-checked `uint32_t` handles;
- at most 16 live decoder sessions per process;
- caller-selected input and decoded-payload ceilings from 1 byte through the
  immutable 1 GiB implementation ceiling;
- no raw-pointer trust and no Rust allocation exposed to the caller;
- stale-handle rejection after reset/destroy cycles;
- stable one-past byte sentinel `256`, outside the byte domain;
- panic containment at every exported entry point; and
- no network, floating perceptual processing, machine learning, or unbounded
  allocation.

API calls are serialized by the implementation. A handle may be used from
different threads, but callers must not assume concurrent progress.

## Lifecycle

1. `v64_decoder_create(input_limit, decoded_limit)` returns a nonzero handle or
   zero when the limits are invalid or all 16 slots are occupied.
2. Push the complete `.v64` file with `v64_decoder_push_byte` and/or
   `v64_decoder_push_word_le`.
3. `v64_decoder_finish` validates and owns the parsed file. Header accessors are
   valid after this succeeds.
4. Repeated `v64_decoder_advance` calls return `V64_STATUS_OK` for a decoded
   record and `V64_STATUS_DONE` at stable end-of-stream. Frame/state accessors
   describe only the current record.
5. `v64_decoder_reset` returns the session to empty input state without changing
   its configured limits. `v64_decoder_destroy` invalidates the handle.

Repeat records expose the prior immutable frame state without cloning it.
Malformed frame commands do not commit partial state.

## Status and sentinel values

The status constants in the header are normative. Parse errors occur while
finalizing the container; decode errors occur while advancing the video
timeline. Accessors that cannot return a value use `V64_U32_ERROR`,
`V64_U64_ERROR`, or `V64_BYTE_ERROR` as declared by their return domain.

Error text is diagnostic UTF-8, bounded to 1,024 bytes, and not a compatibility
surface. Programs must branch on status codes rather than matching messages.

## Compatibility

`v64_abi_version()` and `V64_ABI_VERSION` both return 1 for this contract.
Additive exports may be introduced without changing the ABI version only when
all v1 behavior and existing symbols remain compatible. Any changed signature,
constant, lifecycle rule, or interpretation requires a new ABI version and a
new exact symbol manifest.

The Rust decoder API version is reported separately by
`v64_decoder_api_version()`. No Rust struct layout or Rust symbol name is part
of this C compatibility promise.
