# Human-content raster tranche 3: Candidate 4 results

Date: 2026-07-30

## Bottom line

**Reject Hyper Real Candidate 4 as the frozen 16-color base, while retaining it as the strongest chromatic and temporal reference so far.** Candidate 4 improves general recognizability, chromatic separation, perceived motion stability, and compression, but its black-and-white tonal hierarchy remains materially inferior to Candidate 1.

The checked GitHub Actions run completed all tests, deterministic palette regeneration, fourteen matched benchmark lanes, three entropy candidates, three independent-group sweeps, and segregated blind/key artifact publication.

## Codec results

- Packed parser: **174,202** raw-DEFLATE bytes.
- Selected parser: **147,582** bytes.
- Savings: **26,620 bytes (15.281%)**.
- Entropy pass selected: **14/14 lanes**.
- Canonical selection SHA-256: `2f933d51bf559a2215464ffeac93dc97187a6f74200d961018355acd15a988f9`.

### Palette comparison

| Metric | Candidate 1 | Candidate 4 | Candidate 4 delta |
|---|---:|---:|---:|
| Selected DEFLATE | 74,043 B | 73,539 B | -504 B (-0.681%) |
| Packed DEFLATE | 87,643 B | 86,559 B | -1,084 B (-1.237%) |
| Selected command bytes | 128,673 B | 127,322 B | -1,351 B |
| Mean changed cells | 21.656% | 21.512% | -0.144 pp |
| Mean flicker reversion | 2.506% | 2.598% | +0.092 pp |

### Independent-group sweep

| Maximum duration | Groups | Selected DEFLATE | Penalty vs. 2 s | Median seek | p95 seek |
|---:|---:|---:|---:|---:|---:|
| 0.5 s | 56 | 186,223 B | +26.184% | 1.621 ms | 8.207 ms |
| 1 s | 28 | 164,109 B | +11.199% | 2.825 ms | 9.937 ms |
| 2 s | 14 | 147,582 B | +0.000% | 6.008 ms | 16.150 ms |

Two-second groups are **10.071% smaller than one-second groups** and **20.750% smaller than half-second groups**. They remain the prototype default. The worst lane was `animation-subtitle-80-baseline` at 16.150 ms p95 on the hosted runner.

## Pre-key blind review

Scores were recorded by anonymous code in PR #3 before the palette key was opened.

| Metric | Candidate 1 | Candidate 4 | Delta |
|---|---:|---:|---:|
| Mean recognizability | 4.000/5 | 4.429/5 | +0.429 |
| Mean color/grayscale separation | 3.571/5 | 4.143/5 | +0.571 |
| Mean temporal stability | 3.429/5 | 4.000/5 | +0.571 |
| Exact subtitle transcriptions | 0/4 | 0/4 | 0 |

Candidate 4's monochrome separation improved from Candidate 3's **2/5** to **3/5**, but remained below Candidate 1's **5/5**. Candidate 4 therefore does not restore a sufficient low-depth neutral ladder.

The prior Candidate-3 motion review also showed that perceived temporal stability improved from **3.429/5 to 4.000/5** even while the automated one-frame-reversion proxy became slightly worse. The proxy remains useful diagnostic context, but not a substitute for human motion review.

## Decision

1. **Candidate 4 is rejected as the frozen base prefix.**
2. **Candidate 1 remains the executable default.**
3. **Candidate 4 remains the chromatic and temporal benchmark.**
4. Candidate 5 should add dark neutral `[32,32,32]` and run two controlled ablations:
   - **5A:** retain dark teal and sacrifice dark navy.
   - **5B:** retain dark navy and sacrifice dark teal.
5. Subtitle readability remains a side-plane or renderer problem; Candidate 4 produced no exact base-path transcription.
6. Two-second groups remain the prototype default, not yet a normative constant pending browser seek validation.

## Reproducibility

- Workflow run: `30584192835` at code head `7b7b9779c4280d1618186dea01336bca85f76649`.
- Blind artifact digest: `sha256:1fcb0cc5a47a341e82c7b197cd33b694e31dbda0f4d0782c0687d6aa5b4aadfb`.
- Concealed-key artifact digest: `sha256:45209efd209a827b7f055e699731cce3c1996c87e0f608811db6914646a09e37`.
