# Phase 1 measured checkpoint

Date: 2026-07-29

This is one engineering fixture, not a representative compression corpus. It
proves that conventional raster video can be ingested, converted to canonical
Video 64 cell states, compressed into a real `.v64` file, parsed, verified,
seek-indexed, deterministically decoded, and emitted as conventional raster
video.

## Fixture

- Source: FFmpeg-generated `testsrc2` plus a moving yellow rectangle
- Legal status: procedurally generated in the test command; no third-party media
- Source: 320×180, 24 fps, 2.000 s, 48 frames, no audio
- V64 controls: Balanced, 40 columns, 11 derived rows, 16-color palette, 24 fps
- Decoded raster: 320×176

## Results

| Metric | Result |
|---|---:|
| Source MP4 | 57,920 bytes |
| V64 file | 13,483 bytes |
| V64 total bitrate | 53,932 bit/s |
| V64 bytes/minute extrapolation | 404,490 |
| Decoded MP4 | 40,381 bytes |
| Changed cells | 20.232% |
| Video chunks | 48 |
| Keyframes | 1 |
| Repeat spans | 0 |
| Stored VFRM payload | 11,763 bytes |
| Inflated VFRM payload | 19,540 bytes |
| Seek entries | 1 |
| Encode wall time | 1.094 s |
| Decode-to-MP4 wall time | 0.835 s |

Wall times are single warm local runs and include FFmpeg process startup. They
are not statistically stable benchmarks.

## Command distribution

| Command | Opcode instances | Cells represented |
|---|---:|---:|
| `SKIP` | 1,293 | 16,496 |
| `LITERAL` | 1,400 | 3,074 |
| `DICTIONARY_LITERAL` | 740 | 1,276 |
| `REPEAT_TOKEN` | 48 | 274 |
| `DEFINE_TOKEN_DICTIONARY` | 48 | n/a |
| `END` | 48 | n/a |

The file defined 581 local token entries across its frames and used 1,276
dictionary references. Dictionary references represented 27.60% of explicitly
written cells (`1,276 / (3,074 + 1,276 + 274)`). This is a token-dictionary
result, not yet the required 16/32/64 canonical-glyph dictionary comparison.

## Determinism and exact timing

- Re-encoding the same source with the same command produced the identical V64
  SHA-256: `cd72a313c0c71d67e85f8b6c62cabdc72a879b6dff5b933bddee0f0ae9ae2b2c`.
- The verifier decoded 48 frames and 120,000 ticks.
- FFprobe measured the decoded raster video as 320×176, 24/1 fps, 48 frames,
  and exactly 2.000 s.
- Decoded MP4 SHA-256:
  `1d1e0ffc2347b664d87153d71f5f145a3a14f128bbb06c8a413a5a5a1d24a21b`.

## Current scope boundary

The file is video-only. `SILN` and `PLIT` syntax is implemented and tested, but
AM1 preprocessing, standard Opus packets, audiovisual muxing, and synchronization
are not. The next measurement must add audio fixtures before any claim about the
complete audiovisual bitrate is made.
