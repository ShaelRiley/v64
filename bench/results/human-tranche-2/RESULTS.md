# Human-content raster tranche 2: measured results

Date: 2026-07-30

## Bottom line

**Reject Hyper Real Candidate 3 as the frozen 16-color base, but retain it as the chromatic benchmark for Candidate 4.** Candidate 3 improved the one-reviewer blinded still scores, yet it materially damaged the black-and-white hierarchy, did not make subtitles exactly readable at either 60 or 80 columns, and delivered only a marginal compression advantage.

The clean GitHub Actions run completed all tests, deterministic regeneration, fourteen benchmark lanes, three entropy candidates, three independent-group sweeps, and segregated blind/key artifact publication.

## Codec results

- Packed parser: **174,666** raw-DEFLATE bytes.
- Selected parser: **147,912** bytes.
- Savings: **26,754 bytes (15.317%)**.
- Entropy pass selected: **14/14 lanes**.
- Canonical selection SHA-256: `fdf6758a60e991d29461305f824b3e5cb18d368d238751172f7a2d4f84ed9588`.

### Palette comparison

| Metric | Candidate 1 | Candidate 3 | Candidate 3 delta |
|---|---:|---:|---:|
| Selected DEFLATE | 74,043 B | 73,869 B | -174 B (-0.235%) |
| Packed DEFLATE | 87,643 B | 87,023 B | -620 B (-0.707%) |
| Selected command bytes | 128,673 B | 127,916 B | -757 B |
| Mean changed cells | 21.656% | 21.645% | -0.011 pp |
| Mean flicker reversion | 2.506% | 2.596% | +0.090 pp |

### Independent-group sweep

| Maximum duration | Groups | Selected DEFLATE | Penalty vs. 2 s | Median seek | p95 seek |
|---:|---:|---:|---:|---:|---:|
| 0.5 s | 56 | 186,593 B | +26.151% | 1.613 ms | 5.789 ms |
| 1 s | 28 | 164,405 B | +11.151% | 2.843 ms | 10.493 ms |
| 2 s | 14 | 147,912 B | +0.000% | 6.087 ms | 16.408 ms |

Two-second groups are **10.034% smaller than one-second groups** and **20.730% smaller than half-second groups**. They remain the prototype default. A normative freeze is deferred because the Candidate-3 80-column animated lane reached a 19.402 ms p95 seek reconstruction on the hosted runner.

## Blinded still review

One reviewer scored code-only midpoint images at native 100% scale before opening the palette key. Temporal stability was intentionally left blank: a midpoint still cannot support a human motion judgment.

| Metric | Candidate 1 | Candidate 3 | Delta |
|---|---:|---:|---:|
| Mean recognizability | 3.571/5 | 4.000/5 | +0.429 |
| Mean color/grayscale separation | 3.571/5 | 3.857/5 | +0.286 |
| Exact subtitle transcriptions | 0/4 | 0/4 | 0 |

### Paired scores

| Group | C1 recognition | C3 recognition | C1 color/gray | C3 color/gray |
|---|---:|---:|---:|---:|
| `animation-subtitle-60` | 3/5 | 4/5 | 3/5 | 4/5 |
| `animation-subtitle-80` | 3/5 | 4/5 | 3/5 | 4/5 |
| `depth-40` | 4/5 | 5/5 | 4/5 | 5/5 |
| `lecture-subtitle-60` | 3/5 | 3/5 | 3/5 | 4/5 |
| `lecture-subtitle-80` | 3/5 | 4/5 | 3/5 | 4/5 |
| `monochrome-40` | 5/5 | 4/5 | 5/5 | 2/5 |
| `screen-40` | 4/5 | 4/5 | 4/5 | 4/5 |

Candidate 3 improved the depth and animated/live chromatic scenes, but the black-and-white lane fell from **5/5 to 2/5** for tonal separation because the 16-color prefix lacks a sufficient neutral ladder. The extra warm-skin utility color is redundant with the existing brown and light-skin anchors and is the leading replacement candidate.

## Decision

1. **Candidate 3 is rejected as the frozen base prefix.** Its chromatic behavior remains the target to preserve.
2. **Candidate 1 remains the executable default.**
3. **Two-second independent groups remain the prototype default**, not yet a normative format constant.
4. **Candidate 4 should preserve the twelve Hyper Real anchors, dark navy, dark teal, and mid-gray, while replacing the extra warm-skin utility with a light neutral.**
5. **The blind apparatus must emit anonymous motion clips** before temporal stability can be human-scored.
6. **Subtitle readability requires a rendering or grammar intervention**, not another palette-only revision.

## Reproducibility

- Workflow run: `30569348195` at head `5e326e406e02d6750389b28c4e3dffbf4e604a20`.
- Blind artifact digest: `sha256:71363cf85af1dfe774e07109c6456e3d4b33a315eb9bac8449547eab3bb43610`.
- Concealed-key artifact digest: `sha256:5185290b01293ad85710cbe57fcc2a752aaecd141ab44fe30ed3590e8ca168ed`.
- Toolchain: Node v22.23.1, npm 10.9.8, FFmpeg 6.1.1-3ubuntu5, Ubuntu 24.04 x86_64.
- Structured metrics: `bench/results/human-tranche-2/summary.json`.
- Blinded scores: `bench/reviews/human-tranche-2/scores-reviewer-1.json` and `worksheet-scored-reviewer-1.csv`.
