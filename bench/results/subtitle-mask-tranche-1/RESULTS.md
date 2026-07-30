# Subtitle-mask tranche 1: measured results

Date: 2026-07-30

## Bottom line

**SM1 proves that a sparse 8×16 subtitle-mask side plane can restore exact transcription, but the current broad lower-band extractor is too expensive for normative adoption.** At 60 columns, the unmasked path yielded zero exact transcriptions while SM1 yielded four of four. At 80 columns, both paths were transcribable at the motion-review scale, but SM1 materially improved edge clarity and temporal stability.

## Blind review

Scores were committed by anonymous code before opening the concealed key.

| Grid | Variant | Exact transcriptions | Mean edge clarity | Mean temporal stability | Mean scene preservation |
|---|---:|---:|---:|---:|---:|
| 60 columns | base | 0/4 | 1.000/5 | 2.000/5 | 4.000/5 |
| 60 columns | SM1 | 4/4 | 5.000/5 | 5.000/5 | 4.000/5 |
| 80 columns | base | 4/4 | 3.000/5 | 3.000/5 | 4.000/5 |
| 80 columns | SM1 | 4/4 | 4.000/5 | 4.000/5 | 4.500/5 |
| All lanes | base | 4/8 | 2.000/5 | 2.500/5 | 4.000/5 |
| All lanes | SM1 | 8/8 | 4.500/5 | 4.500/5 | 4.250/5 |

## Byte cost

Across eight two-second subtitle lanes and 192 frames:

- Active mask cells: **28,632**, or **149.125 per frame**.
- Raw SM1 payload: **547,272 bytes**.
- Four-byte frame boundaries: **768 bytes**.
- Framed stream: **548,040 bytes**.
- Sum of lane-local raw-DEFLATE streams: **108,823 bytes**.
- Compression reduction from framed bytes: **80.143%**.
- Compressed side-plane rate: **54.412 kbit/s**, or **566.786 bytes per frame** at 12 fps.
- Mean compressed cost: **13,602.875 bytes per two-second lane**.

The result is a readability proof, not a rate-efficient syntax. The extractor selected substantial non-subtitle lower-band detail; grammar refinements alone cannot recover that wasted rate.

## Decision

1. Keep SM1 experimental and outside the V64 container.
2. Preserve its exact arbitrary-mask semantics and strict decoder checks.
3. Do not freeze its per-frame framing or broad lower-band extraction.
4. Build SM2 as a selective temporal side plane:
   - isolate subtitle-like connected regions rather than every high-contrast lower-band cell;
   - add repeat-plane and cell-delta coding;
   - measure exact transcription against total V64 bytes, not side-plane bytes alone.
