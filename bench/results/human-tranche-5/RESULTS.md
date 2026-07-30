# Human-content raster tranche 5: Candidate-6 finalist gate

Date: 2026-07-30

## Bottom line

**Freeze Hyper Real Candidate 6A as normative `V64-P256-1`.** Candidate 6A is the only constrained finalist that simultaneously matches Candidate 5A's 5/5 depth score, Candidate 5B's 4.5/5 monochrome score, and the strongest 5/5 screen-capture score. It also records the lowest command bytes, changed-cell rate, and one-frame-reversion proxy of the six compared palettes.

Candidate 6A uses dark chroma `[4,77,90]`, the exact 25% sRGB interpolation from Candidate 5A's dark teal `[0,92,96]` toward Candidate 5B's dark navy `[16,32,72]`, while retaining dark `[32,32,32]`, light `[224,224,224]`, and middle `[112,112,112]` neutral rungs.

## Checked codec results

Clean GitHub Actions run `30589727547` at code head `35b75024e0d62df8afad472f726defd129802047` passed conformance, deterministic Candidate-6 regeneration, eighteen matched benchmark lanes, three independent-group sweeps, and segregated blind/key artifact publication.

- Packed parser: **73,634 raw-DEFLATE bytes**.
- Selected parser: **64,612 bytes**.
- Savings: **9,022 bytes (12.252%)**.
- Entropy pass selected: **18/18 lanes**.
- Canonical selection SHA-256: `27bee011f3a41283ddfbccba70134314eaee27e938efa695f9286f45d87a1d17`.

### Palette comparison

| Palette | Selected DEFLATE | Delta vs Candidate 1 | Selected commands | Mean changed cells | Mean flicker reversion |
|---|---:|---:|---:|---:|---:|
| Candidate 1 | 10,760 B | baseline | 17,924 B | 17.635% | 1.371% |
| Candidate 5A | 10,668 B | -92 B (-0.855%) | 17,409 B | 16.963% | 1.319% |
| Candidate 5B | **10,558 B** | -202 B (-1.877%) | 17,228 B | 16.977% | 1.243% |
| **Candidate 6A** | **10,580 B** | **-180 B (-1.673%)** | **17,154 B** | **16.861%** | **1.222%** |
| Candidate 6B | 10,941 B | +181 B (+1.682%) | 17,776 B | 17.250% | 1.274% |
| Candidate 6C | 11,105 B | +345 B (+3.206%) | 18,000 B | 17.503% | 1.329% |

Candidate 6A is 22 compressed bytes (0.208%) larger than Candidate 5B, but 74 command bytes smaller, reduces the changed-cell and flicker proxies, and removes Candidate 5B's depth regression.

### Independent groups

| Maximum duration | Groups | Selected DEFLATE | Median seek | p95 seek |
|---:|---:|---:|---:|---:|
| 0.5 s | 72 | 85,957 B | 0.623 ms | 1.314 ms |
| 1 s | 36 | 72,922 B | 1.108 ms | 1.865 ms |
| 2 s | 18 | 64,612 B | 1.996 ms | 3.143 ms |

Two-second groups are **11.396% smaller than one-second groups** and **24.832% smaller than half-second groups** in this finalist tranche. They remain the prototype default pending browser seek validation.

## Pre-key blind review

All eighteen still and motion variants were scored by anonymous code before the concealed key was opened.

| Palette | Mean recognizability | Mean separation | Mean temporal stability | Depth | Monochrome | Screen |
|---|---:|---:|---:|---:|---:|---:|
| Candidate 1 | 4.333/5 | 4.333/5 | 4.333/5 | 4.0/5 | **5.0/5** | 4.0/5 |
| Candidate 5A | **4.833/5** | **4.833/5** | **4.833/5** | **5.0/5** | 4.5/5 | **5.0/5** |
| Candidate 5B | 4.333/5 | 4.333/5 | 4.500/5 | 4.0/5 | 4.5/5 | 4.5/5 |
| **Candidate 6A** | **4.833/5** | **4.833/5** | **4.833/5** | **5.0/5** | **4.5/5** | **5.0/5** |
| Candidate 6B | 4.333/5 | 4.333/5 | 4.500/5 | 5.0/5 | 3.5/5 | 4.5/5 |
| Candidate 6C | 4.000/5 | 4.000/5 | 4.333/5 | 4.5/5 | 3.0/5 | 4.5/5 |

Candidate 6A matches Candidate 5A's best visual scores while improving selected DEFLATE by 88 bytes, command bytes by 255, changed cells by 0.102 percentage points, and flicker reversion by 0.097 percentage points. Moving farther toward navy in Candidates 6B and 6C causes abrupt monochrome and compression regressions.

## Decision

1. **Freeze Candidate 6A's exact 256-color bytes as normative `V64-P256-1`.**
2. **Switch the executable default from legacy `V64-P256-CANDIDATE-1` to `V64-P256-1`.**
3. Retain Candidate 1 and Candidates 5A/5B as non-normative regression controls.
4. Preserve Candidate 6A's complete palette SHA-256 as the normative palette identity.
5. Palette depth remains independently selectable; the first sixteen entries are now frozen, while the complete 256-color order is frozen by the same asset hash.
6. Any future palette research requires a new normative identifier rather than mutating `V64-P256-1`.

## Reproducibility

- Candidate 6A dark chroma: `[4,77,90]`.
- Candidate 6A prefix SHA-256: `e8d7b7de275b79acb403d17a97c4e7ef72ca16600a8f4f3ebdcba86099ce41cf`.
- Candidate 6A complete palette SHA-256: `c03d23141eb33b80d79d1a7f3167eeb18ccf1f4f0c0f81572f269abd51317105`.
- Blind artifact digest: `sha256:62d9796ebbf4b0487652b61266b8d818fb0b44f6bc9f6a63fab313cbea1110a2`.
- Concealed-key artifact digest: `sha256:fcb36a62ac94f9e582b9dd6cd1108db8ba8a8bc908df73eed280af0ec710914c`.
