# Checked Video 64 combined grammar decision gate

Status: **passed**

Checked code head: `a55e8a368e581ddee9e539922269547702128dc5`

GitHub Actions workflow: `30640529023` (`V64 combined grammar decision gate`)

Artifact: `combined-grammar-study`, ID `8797286945`

Artifact ZIP SHA-256:
`b065fca95200ed6156a722d341edb8880268157667e57b4cc238cad37ebf67d7`

Generated summary SHA-256:
`2351ecd13103138b2d0795d2d843daf2cc13d0011f258bdd75d50624d5b35f90`

Generated Markdown SHA-256:
`419487a4b9d6f753e7a6c060a435598daa02f3b0a832078b3b1e9059f41b0c9e`

## Decision method

The gate rebuilds both checked corpora and applies a human-heavy decision rule:

- legally reusable human raster material: 75% weight;
- deterministic structural stress corpus: 25% weight;
- Grammar B must save at least 1% after weighting;
- neither corpus may regress by more than 1%;
- decoder timing, sampled allocation, opcode count, and decoder-source surface
  are reported separately rather than hidden inside the byte result.

The gate compares identical decoded cell states and two-second independent-group
boundaries. Both Phase-1 and Grammar B are validated against the same expected
frames before timing begins.

## Complete-file grammar evidence

| Corpus | Phase-1 group DEFLATE | Grammar B group DEFLATE | Grammar B savings | Weight |
|---|---:|---:|---:|---:|
| structural | 155,992 bytes | 100,761 bytes | 35.406% | 25% |
| human raster | 874,752 bytes | 881,164 bytes | -0.733% | 75% |

Weighted Grammar B savings: **8.302%**.

The human regression remains inside the explicit 1% ceiling. Grammar B therefore
advances as the **provisional combined-corpus grammar winner**, but it is not a
final V1 freeze.

## JavaScript decoder resources

The gate measured all 40 human-raster `.v64` files, covering 1,870 nominal
frames, 1,764 coded frames, and 106 repeat frames. Each file was decoded five
times after a verified warm-up.

| Decoder | Total median time | Mean median/file | Worst p95 | Peak heap delta | Peak ArrayBuffer delta | Peak RSS delta |
|---|---:|---:|---:|---:|---:|---:|
| Phase-1 | 139.994 ms | 3.500 ms | 8.289 ms | 10,253,512 bytes | 489,792 bytes | 393,216 bytes |
| Grammar B | 437.041 ms | 10.926 ms | 28.356 ms | 16,422,632 bytes | 400,896 bytes | 1,601,536 bytes |

Grammar B's current JavaScript decode-time delta is **+212.186%**. Its absolute
worst p95 remains below 30 ms for these complete short files, but the regression
is large enough that implementation efficiency must be revisited before a
normative freeze.

## Static decoder surface

The complexity measurement includes Phase-1's inline parser/apply function and
both Grammar B's separate parser and apply functions.

| Decoder | Opcodes | Functions | Source bytes | Source lines | Decision tokens | Loop tokens |
|---|---:|---:|---:|---:|---:|---:|
| Phase-1 | 7 | 1 | 3,850 | 84 | 23 | 7 |
| Grammar B | 12 | 2 | 6,509 | 175 | 21 | 6 |

Grammar B adds five mandatory opcodes and 2,659 measured decoder-source bytes.
The source metric is an implementation-surface indicator, not a semantic proof
of safety or maintainability.

## Decision

- Advance Grammar B as the provisional combined-corpus byte winner.
- Do not freeze Grammar B into V1 yet.
- Preserve Phase-1 as the compatibility and simplicity baseline.
- Optimize or replace the allocation-heavy JavaScript Grammar B parse/apply path.
- Require Rust and WebAssembly golden-state agreement and resource measurements
  before final grammar selection.
- Keep raw DEFLATE as the current entropy leader; this gate does not alter the
  separate entropy-backend freeze requirement.

## Reproduction

```bash
npm test
npm run bench:rd-glyph
npm run bench:human-rd-glyph
npm run bench:combined-grammar
```

The complete generated JSON, per-file hashes, and resource rows are retained in
the GitHub Actions artifact. This checked repository result records the stable
decision inputs and artifact identities without committing redundant generated
containers.
