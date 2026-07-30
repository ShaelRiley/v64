# Raster tranche 0: provenance-checked FFmpeg ingest

Date: 2026-07-30

This is the first entropy-parser measurement beginning from a real raster-video
file rather than preconstructed cell states. It proves hash validation, FFmpeg
decode, proxy scaling, Video 64 analysis, temporal stability, candidate command
generation, lossless cell reconstruction, and entropy selection as one
deterministic path.

The single source is the repository's self-authored CC0 procedural MP4. This is
an ingest conformance fixture, not the licensed human-content corpus and not a
recognizable-fidelity verdict.

## Reproduction

```bash
npm test
npm run bench:raster
```

Source:

- `tests/golden/procedural-source.mp4`
- SHA-256:
  `50c9f5a1a24bd12446eb953ee08625f8bc8dad49bf437e8ffa93d7ec0d383f3e`
- declared origin: V64 deterministic FFmpeg `testsrc2` sample
- license: CC0-1.0
- 40×11 cells, 16 colors, 24 fps, 48 analyzed frames, 2 seconds

## Result

| Candidate | Command bytes | Raw DEFLATE bytes |
|---|---:|---:|
| Packed-byte parser | 11,930 | 9,402 |
| Entropy pass 1 | 12,593 | 8,867 |
| Entropy pass 2 | 13,236 | 8,696 |

Entropy pass 2 was selected. It uses 1,306 additional command bytes while
reducing actual DEFLATE output by **706 bytes / 7.509%**. Every candidate
reconstructed all 48 analyzed cell states, and the selected DEFLATE group
round-tripped byte-for-byte.

Canonical selection SHA-256:
`a1572d0926c93e4bf0324b9f3b4df8caaf86d7ce34681d8f53374c295ced6460`

## Decision

The raster-ingest harness is fit for adding licensed clips with explicit
origin, license, local path, and SHA-256. The result also independently
reproduces the central Grammar B finding: a larger command stream can compress
substantially better.

Do not infer a universal 7.509% gain. The next tranche must contain human faces,
dialogue staging, dark material, animation, screen capture, subtitles, static
lecture footage, and saturated scenes under licenses compatible with permanent
benchmark redistribution.
