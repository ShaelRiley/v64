# Human-content raster tranche 2

Date: 2026-07-30

Status: corpus, palette candidate, preview path, and blinded-review apparatus are
implemented. Codec measurements and human scores are intentionally pending a
checked full-repository run.

## Purpose

This tranche closes the three raster-content gaps left by tranche 1 and turns
its manual observations into a reproducible comparison protocol:

- 3D animation;
- black-and-white film;
- screen capture;
- Hyper Real candidate 3 versus the candidate-1 baseline;
- subtitle trials at 60 and 80 columns;
- deterministic anonymization and scoring worksheets.

## Reproduction

```bash
npm run palette:hyperreal
npm run corpus:missing-classes
npm run preview:human2
npm run review:human2
npm run bench:human2
```

The blind-review command writes public images and worksheets plus a private
`key.json`. Keep the key hidden until all scoring is complete.

## Candidate 3

Candidate 3 retains ANSI Tube's exact twelve Hyper Real anchors and adds four
16-color utility entries for dark navy, dark teal, warm skin midtone, and a
neutral midtone. Its deterministic identities are:

- palette SHA-256:
  `071127822f9fb56aef0c6b62b6b2807ff035d76d801fe8aa0d71c5c89ca872af`;
- 16-color prefix SHA-256:
  `ed5a8057ee3bc5dbd06c1f03949d59cf323f736295a70b72aefc5aa875886838`.

## Corpus matrix

The manifest contains fourteen two-second lanes:

| Review group | Source class | Grid | Palettes |
|---|---|---:|---|
| `depth-40` | 3D animation | 40×11 | candidate 1, candidate 3 |
| `monochrome-40` | black-and-white film | 40×11 | candidate 1, candidate 3 |
| `screen-40` | screen capture | 40×11 | candidate 1, candidate 3 |
| `lecture-subtitle-60` | live-style subtitle dialogue | 60×17 | candidate 1, candidate 3 |
| `lecture-subtitle-80` | live-style subtitle dialogue | 80×22 | candidate 1, candidate 3 |
| `animation-subtitle-60` | animated subtitle dialogue | 60×17 | candidate 1, candidate 3 |
| `animation-subtitle-80` | animated subtitle dialogue | 80×22 | candidate 1, candidate 3 |

Every lane uses 16 colors, 12 fps, two seconds, and temporal stability `0.48`.

## Source provenance

The missing classes use original deterministic ASCII Netpbm source plates
created by `tools/build-missing-class-plates.mjs` and dedicated under CC0 1.0.
The manifest applies hash-validated deterministic FFmpeg motion treatments at
analysis time, avoiding opaque committed video binaries.

| Source plate | SHA-256 |
|---|---|
| `synthetic-3d-orbit.ppm` | `693d8907cd856d36d31633ddca3ab8df7137049638070a5c832c796355264866` |
| `synthetic-monochrome-film.ppm` | `e17f6c07ce539bbf873ab0f7c980fefed0b6428f6dd78894fb6a714a0e266041` |
| `synthetic-screen-capture.ppm` | `d69f8764be437a1c09140cfa814c60a2dd50dbde921f631b1f45e8b180b0dc6d` |

A checked FFmpeg 7.1.3 source-treatment smoke test emitted exactly 24 RGBA
frames per source at 40×11 proxy resolution. The raw two-second identities were:

| Source class | Raw RGBA SHA-256 |
|---|---|
| 3D animation | `aee0d6dd86732c7926ab78c1ce1effa16d083186dfef7540dc8c5cdcc6d8d8af` |
| black-and-white film | `97c1d08891e4dcf84d93d142a955126c799a203b916f6309b1442108e407d841` |
| screen capture | `cbaf52bcae13d41d79732040848e54a903fcfdf1ebf0b0c9cf39e4cecf1ed85b` |

These raw hashes are implementation evidence for that FFmpeg build, not
cross-version conformance constants.

## Blind-review protocol

`tools/build-blind-review.mjs` derives an eight-character code from the manifest
ID and entry ID, copies previews under code-only filenames, and emits:

- `worksheet.md` with reviewer instructions;
- `worksheet.csv` for scores and subtitle transcription;
- `public-manifest.json` without palette identities;
- `key.json` with the concealed code-to-palette mapping.

Reviewers score recognizability, chromatic or grayscale separation, temporal
stability, and subtitle transcription without seeing palette names.

## Decision gate

This commit does not assert that candidate 3 is superior. The palette, visual
command grammar, and independent-group duration remain unfrozen until the full
benchmark report and blinded scores are appended here. The next checked run
must record:

- packed and selected command bytes;
- raw-DEFLATE bytes by lane and palette;
- changed-cell and one-frame-reversion metrics;
- 0.5-, 1-, and 2-second group-size and seek trade-offs;
- blinded median scores and subtitle transcription success by grid width.
