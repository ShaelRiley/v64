# Entropy shootout 1: deterministic structural seed corpus

Date: 2026-07-30

This is the first multi-fixture measurement of an entropy-aware Grammar B
parser. It is a command-structure experiment, not a visual-fidelity verdict or
a normative codec decision.

The seed corpus contains eleven self-authored, deterministic, CC0 cell-state
generators. They exercise dialogue-like facial motion, dark staging, rapid
motion, flat and depth-like animation, monochrome grain, music-video cuts,
screen capture, subtitles, static lecture motion, and highly saturated
material. These fixtures are legally reusable and reproducible, but they do not
replace later trials using licensed human-content video.

## Reproduction

```bash
npm test
npm run bench:corpus
```

Configuration:

- 11 fixtures;
- 24×8 cells;
- 24 nominal frames per fixture;
- legal palette depths from 2 through 16;
- maximum literal horizon: 32 cells;
- static-byte Laplace smoothing alpha: 0.5;
- selection backend: raw DEFLATE level 9;
- every parser result decoded and compared with its source cell states;
- every selected DEFLATE group decompressed and compared byte-for-byte.

## Parser candidates

1. Packed-byte dynamic programming from Grammar B v2.
2. A dynamic program weighted by byte probabilities learned from candidate 1.
3. A second entropy pass retrained on candidate 2.

The offline encoder compresses all three valid candidate groups and selects the
smallest actual DEFLATE result. Stable ties prefer the packed-byte parser. This
selection costs encoder time but adds no decoder syntax.

## Aggregate result

| Metric | Packed parser | Selected candidate | Change |
|---|---:|---:|---:|
| Command bytes | 29,323 | 29,451 | +128 |
| DEFLATE bytes | 7,897 | 6,807 | −1,090 |
| DEFLATE change | — | — | **−13.803%** |
| Fixtures selecting entropy pass | — | 5 of 11 | — |
| Fixtures retaining packed parser | — | 6 of 11 | — |
| Median per-fixture saving | — | 0% | — |
| 75th-percentile saving | — | 6.923% | — |

Canonical selection SHA-256:
`867ca48430806181272c2274991edf33a0dc84883426a4532d75cf0a0faea798`

One measured complete shootout in the current Linux x64 / Node.js v24.14.0
environment took 15.561 seconds and reported a 150,756 KiB maximum resident
set. These are development-harness measurements, not optimized encoder
performance claims.

The aggregate gain is concentrated rather than universal. The entropy model
was selected for dialogue-like motion, rapid motion, depth-like animation,
monochrome film grain, and saturated material. The saturated fixture accounts
for most of the reduction: 4,478 to 3,494 DEFLATE bytes. The packed parser
remained preferable for dark staging, flat animation, screen capture,
subtitles, static lecture motion, and the tied music-video fixture.

## Per-fixture result

| Structural class | Packed DEFLATE | Selected | Selected DEFLATE | Saving |
|---|---:|---|---:|---:|
| Dialogue | 130 | entropy pass 1 | 121 | 6.923% |
| Dark cinematography | 123 | packed | 123 | 0% |
| Rapid motion | 337 | entropy pass 1 | 331 | 1.780% |
| 2D animation | 200 | packed | 200 | 0% |
| 3D animation | 446 | entropy pass 1 | 361 | 19.058% |
| Black-and-white film | 744 | entropy pass 1 | 738 | 0.806% |
| Music video | 1,004 | packed | 1,004 | 0% |
| Screen capture | 170 | packed | 170 | 0% |
| Subtitles | 192 | packed | 192 | 0% |
| Static lecture | 73 | packed | 73 | 0% |
| Highly saturated material | 4,478 | entropy pass 2 | 3,494 | 21.974% |

## Decision

Retain multi-candidate, actual-backend selection as an encoder experiment.
Static-byte entropy estimates are useful on some structures but are not a
universal replacement for packed-byte minimization.

Do not freeze Grammar B, DEFLATE, the palette, or group duration from this seed
corpus. The next measurement must ingest licensed raster-video clips, preserve
the 0.5-, 1-, and 2-second independent-group sweep, and add encode time, peak
memory, seek latency, and fidelity observations.
