# Human-content raster tranche 4: Candidate-5 ablation

Date: 2026-07-30

## Bottom line

**Advance Candidate 5B as the sole palette finalist, reject Candidate 5A as a freeze candidate, and do not freeze Candidate 5B yet.** Candidate 5B provides the smallest command stream, the lowest automated flicker proxy, and near-baseline monochrome separation. Its missing dark teal nevertheless weakens floor-grid and depth detail. Candidate 5A preserves the strongest depth rendering but leaves a larger monochrome deficit.

Candidate 1 remains the executable default until one final constrained dark-chroma utility study resolves the depth-versus-neutral tradeoff.

## Checked codec results

Clean GitHub Actions run `30587498438` at code head `8b0f80dda9da650e40b75edfbef16c91cea28df7` passed all conformance tests, deterministic Candidate-5 regeneration, the twelve-lane ablation, three independent-group sweeps, and segregated blind/key artifact publication.

- Packed parser: **48,705 raw-DEFLATE bytes**.
- Selected parser: **42,728 bytes**.
- Savings: **5,977 bytes (12.272%)**.
- Entropy pass selected: **12/12 lanes**.
- Canonical selection SHA-256: `bbb1806ee624fa199426d459426016991c8ac93f97e16a5b21004f5260ae2e1c`.

### Palette comparison

| Palette | Selected DEFLATE | Delta vs Candidate 1 | Mean changed cells | Mean flicker reversion |
|---|---:|---:|---:|---:|
| Candidate 1 | 10,760 B | baseline | 17.635% | 1.371% |
| Candidate 4 | 10,742 B | -18 B (-0.167%) | 17.536% | 1.619% |
| Candidate 5A | 10,668 B | -92 B (-0.855%) | 16.963% | 1.319% |
| Candidate 5B | **10,558 B** | **-202 B (-1.877%)** | 16.977% | **1.243%** |

Candidate 5A retains dark teal and omits dark navy. Candidate 5B retains dark navy and omits dark teal. Both add dark neutral `[32,32,32]` while retaining light neutral `[224,224,224]` and middle neutral `[112,112,112]`.

### Independent groups

| Maximum duration | Groups | Selected DEFLATE | Median seek | p95 seek |
|---:|---:|---:|---:|---:|
| 0.5 s | 48 | 56,814 B | 0.587 ms | 1.612 ms |
| 1 s | 24 | 48,192 B | 1.138 ms | 3.084 ms |
| 2 s | 12 | 42,728 B | 1.919 ms | 3.295 ms |

Two-second groups are **11.338% smaller than one-second groups** and **24.793% smaller than half-second groups** in this compact tranche. They remain the prototype default pending browser seek validation.

## Pre-key blind review

All twelve still and motion variants were scored by anonymous code before either palette key was opened.

| Palette | Mean recognizability | Mean separation | Mean temporal stability | Monochrome separation | Depth separation |
|---|---:|---:|---:|---:|---:|
| Candidate 1 | 4.333/5 | 4.333/5 | 4.333/5 | **5.0/5** | 4.0/5 |
| Candidate 4 | 4.333/5 | 4.333/5 | **4.667/5** | 3.0/5 | **5.0/5** |
| Candidate 5A | **4.500/5** | **4.500/5** | **4.667/5** | 4.0/5 | **5.0/5** |
| Candidate 5B | 4.333/5 | 4.333/5 | 4.500/5 | **4.5/5** | 4.0/5 |

Candidate 5A confirms that dark teal is valuable for floor-grid and depth readability. Candidate 5B confirms that dark navy plus a three-rung neutral ladder nearly restores monochrome hierarchy and also yields the best rate and automated stability.

## Decision

1. **Candidate 5A is rejected as the frozen prefix.** It remains the depth/chromatic reference.
2. **Candidate 5B advances as the sole finalist but is not frozen.**
3. **Candidate 1 remains the executable default.**
4. The final palette study must keep dark, middle, and light neutrals fixed and optimize exactly one dark-chroma utility between the Candidate-5A teal and Candidate-5B navy endpoints.
5. The next candidate should be selected by a constrained, reproducible search rather than another unconstrained hand-tuned prefix.
6. The final gate should use the same depth, monochrome, and screen sources and require no material regression from Candidate 5B's monochrome score or Candidate 5A's depth score.

## Reproducibility

- Candidate 5A prefix SHA-256: `441826817e2103b533a89b7162043158911e9d19dc4f745399cd0b5076ef7d71`.
- Candidate 5A palette SHA-256: `0882df7996bfa9637273b18ff50bd0f86de95524c6098754a8be3227d64e2301`.
- Candidate 5B prefix SHA-256: `57b004a2d0038b032596d12d5faf6e69688b176bf9148a5aaad9cfe15ac9f827`.
- Candidate 5B palette SHA-256: `dcab57b7098a23674555453a1db3183b00189ee44a7feffe7d40dd212c76b61a`.
- Blind artifact digest: `sha256:935196893f2fea838562e3a5732f3c7e7e01098b78e214b4d5007fe25995e764`.
- Concealed-key artifact digest: `sha256:a8207ccf76cf70f9f826eb28c4d94153b651673959ff5e1a3e6f83a4c2ba5811`.
