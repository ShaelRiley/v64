# Human-content raster tranche 2

Date: 2026-07-30

Status: complete. The corpus, deterministic palette candidate, preview path,
clean-checkout benchmark, blind still review, and candidate decision have been
published. Candidate 3 is rejected as the frozen 16-color base and retained as
the chromatic benchmark for Candidate 4.

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

The completed review preserved the key until the code-only midpoint stills were
scored. Human temporal stability could not be rated because the package contains
stills rather than motion; this is now a recorded protocol defect, not a filled
or inferred score.

## Clean-checkout execution

The repository workflow runs the Node conformance suite under Node 22 with
FFmpeg, regenerates the Hyper Real assets and missing-class plates, renders the
fourteen previews, builds the blind package, executes `bench:human2`, and
publishes blind and key artifacts separately.

GitHub Actions run `30569348195` completed successfully at head
`5e326e406e02d6750389b28c4e3dffbf4e604a20`.

- blind artifact SHA-256:
  `71363cf85af1dfe774e07109c6456e3d4b33a315eb9bac8449547eab3bb43610`;
- concealed-key artifact SHA-256:
  `5185290b01293ad85710cbe57fcc2a752aaecd141ab44fe30ed3590e8ca168ed`.

## Measured result

The selected static-byte entropy parser won all fourteen lanes and reduced raw
DEFLATE from 174,666 to 147,912 bytes, a 26,754-byte or 15.317% reduction.
Candidate 3 used 73,869 selected-DEFLATE bytes versus 74,043 for candidate 1,
a marginal 174-byte or 0.235% advantage.

The blinded still review produced these palette means:

| Metric | Candidate 1 | Candidate 3 |
|---|---:|---:|
| recognizability | 3.571/5 | 4.000/5 |
| color or grayscale separation | 3.571/5 | 3.857/5 |
| exact subtitle transcriptions | 0/4 | 0/4 |

Candidate 3's monochrome separation fell from the baseline's 5/5 to 2/5. Its
mean one-frame-reversion proxy was also 0.090 percentage points worse. The
complete per-lane report and structured metrics are in:

- `bench/results/human-tranche-2/RESULTS.md`;
- `bench/results/human-tranche-2/summary.json`;
- `bench/reviews/human-tranche-2/scores-reviewer-1.json`;
- `bench/reviews/human-tranche-2/worksheet-scored-reviewer-1.csv`.

## Decision

- Reject Candidate 3 as the frozen 16-color base.
- Keep Candidate 1 as the executable default.
- Retain Candidate 3 as the chromatic reference for Candidate 4.
- Keep two-second groups as the prototype default; defer normative freeze until
  browser seek validation because the worst 80-column lane reached 19.402 ms
  p95 on the hosted runner.
- Build Candidate 4 by replacing Candidate 3's redundant warm-skin utility with
  a light neutral while preserving the twelve Hyper Real anchors, dark navy,
  dark teal, and mid-gray.
- Extend blind review to anonymous motion clips before asking reviewers to score
  temporal stability.
- Treat subtitle readability as a renderer or grammar problem: neither palette
  produced an exact transcription at 60 or 80 columns.
