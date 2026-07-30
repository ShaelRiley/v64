# Subtitle-mask tranche 3: temporal projection selector

Date: 2026-07-30

## Bottom line

**SM3 restores exact 60-column lecture transcription for both tested palettes, but its projection fallback is too expensive for normative adoption.** The corrected horizontal-projection selector raises exact transcription from 0/2 on both the base and SM2 paths to 2/2 on SM3, with 5/5 edge clarity and 5/5 temporal stability. It also raises focused-stream overhead to 62.327%, well above the 10% target.

SM3 therefore proves that the missed lecture subtitle is recoverable from the existing broad mask candidates. The next rate step is not another spatial selector: it is temporal plane stabilization, using a canonical persistent subtitle plane and repeat spans instead of carrying fluctuating masks on every frame.

## Checked implementation

Clean GitHub Actions run `30590945528` at code head `fd892b487d3419009724a866fd9b4f40a0b15fce` passed conformance and the focused two-lane lecture gate. Candidate 6 was correctly skipped by path-specific CI.

The selector used:

- lower-band persistence across 24 frames;
- connected-component discovery;
- horizontal row-band projection when components remained fragmented;
- ranked, deduplicated subtitle boxes;
- bounded per-frame fallback expansion;
- unchanged SM2 full-plane, repeat-span, and removal/upsert-delta syntax.

## Rate results

Across two 60-column lecture lanes and 48 frames:

| Metric | SM2 | SM3 |
|---|---:|---:|
| Selected cells | 188 | 3,511 |
| Raw-DEFLATE side-plane bytes | 1,067 | 12,284 |
| Base V64 selected bytes | 19,709 | 19,709 |
| Total V64 plus side plane | 20,776 | 31,993 |
| Focused-stream overhead | 5.414% | **62.327%** |

The baseline palette lane selected 1,778 SM3 cells and used 6,363 compressed bytes. The Candidate-4 lane selected 1,733 cells and used 5,921 bytes.

## Pre-key blind review

All six base, SM2, and SM3 motion clips were scored by anonymous code before the key was opened.

| Variant | Exact transcription | Mean edge clarity | Mean temporal stability | Mean scene preservation |
|---|---:|---:|---:|---:|
| Base | 0/2 | 1.5/5 | 2.5/5 | 4.0/5 |
| SM2 | 0/2 | 1.5/5 | 2.5/5 | 4.0/5 |
| **SM3** | **2/2** | **5.0/5** | **5.0/5** | 4.0/5 |

Both SM3 clips exactly rendered `WE KEEP THE SIGNAL.` throughout the reviewed motion interval.

## Selector history

The first component-only temporal attempt emitted no boxes and was byte-identical to SM2. The corrected rerun added horizontal projection and found 21 candidate row bands per lane. It selected two dominant boxes spanning lower rows 12–15 and restored the subtitle. This validates the projection mechanism while demonstrating that broad per-frame box filling wastes rate.

## Decision

1. **Advance horizontal temporal projection as a subtitle-line discovery mechanism.**
2. **Reject SM3's broad per-frame fallback planes as a normative rate profile.**
3. Preserve SM2's full/repeat/delta sequence grammar unchanged.
4. Build the next experiment around a canonical persistent plane:
   - choose modal mask/color tuples for persistent cells inside the detected subtitle line;
   - hold that plane across stable subtitle spans;
   - encode the span with one full plane plus repeat commands;
   - fall back to frame-local deltas only when the subtitle visibly changes.
5. Require 2/2 exact lecture transcription while returning total-stream overhead near or below 10%.

## Reproducibility

- Base V64 canonical selection SHA-256: `255fde8d18e2c5a745716c29e63f354384a9753cf6575f3b1d06595c24e747c4`.
- Blind artifact digest: `sha256:53ec6a6573051ecfac4ce9b07812965f35cc163e950b76d64873f5d7231e3d53`.
- Concealed-key artifact digest: `sha256:f90c1c3d5daee8ce65d54bc76a0641f2bc4ad0e213bc45ef2dffdaf095d20bbd`.
