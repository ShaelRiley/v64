# Checked Video 64 combined grammar decision gate

Status: **passed**

Checked code head: `af688fc6d93e25b91af62bf7d0cc349b2ae26363`

GitHub Actions workflow: `30642213125` (`V64 combined grammar decision gate`)

Artifact: `combined-grammar-study`, ID `8797976278`

Artifact ZIP SHA-256:
`804506cde3f28a7c969bba43a5a02838b434ea6dd6d766625724c9563c2d035b`

Generated summary SHA-256:
`ff9be2dbb9de6f2908adc29e74f4e985b95a129ff488d1040efb09d9bf1472aa`

Generated Markdown SHA-256:
`c9cad9811da42d1bf7c79990d9aaee80ad07fa606c6a63cb9b52391f547db708`

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

## Single-pass JavaScript decoder resources

The gate measured all 40 human-raster `.v64` files, covering 1,870 nominal
frames, 1,764 coded frames, and 106 repeat frames. Each file was decoded five
times after a verified warm-up.

| Decoder | Total median time | Mean median/file | Worst p95 | Peak heap delta | Peak ArrayBuffer delta | Peak RSS delta |
|---|---:|---:|---:|---:|---:|---:|
| Phase-1 | 135.939 ms | 3.398 ms | 8.076 ms | 10,253,512 bytes | 489,792 bytes | 524,288 bytes |
| Grammar B direct | 175.112 ms | 4.378 ms | 13.173 ms | 3,173,560 bytes | 400,896 bytes | 1,310,720 bytes |

Grammar B's JavaScript decode-time delta is now **+28.817%**. The previous
parse-then-apply implementation measured +212.186%, so the bounded single-pass
path removes approximately 86.4% of the relative performance penalty and cuts
peak sampled heap allocation from 16,422,632 bytes to 3,173,560 bytes.

The direct decoder validates opcodes, varints, packed padding, palette bounds,
grid progress, command counts, truncation, trailing data, and transactional
state without materializing command-object or per-token arrays.

## Static decoder surface

The complexity measurement conservatively includes the direct decoder's helper
functions as well as its exported apply function.

| Decoder | Opcodes | Functions | Source bytes | Source lines | Decision tokens | Loop tokens |
|---|---:|---:|---:|---:|---:|---:|
| Phase-1 | 7 | 1 | 3,850 | 84 | 23 | 7 |
| Grammar B direct | 12 | 5 | 7,459 | 236 | 27 | 6 |

Grammar B adds five mandatory opcodes and 3,609 measured decoder-source bytes.
The source metric is an implementation-surface indicator, not a semantic proof
of safety or maintainability.

## Decision

- Advance Grammar B as the provisional combined-corpus byte winner.
- Retain the bounded single-pass JavaScript decoder as the benchmark path.
- Do not freeze Grammar B into V1 yet.
- Preserve Phase-1 as the compatibility and simplicity baseline.
- Require Rust and WebAssembly golden-state agreement and resource measurements
  before final grammar selection.
- Keep raw DEFLATE as the current entropy leader; this gate does not alter the
  separate entropy-backend freeze requirement.

The 28.817% JavaScript overhead is now small enough to move the next development
focus to cross-language implementation rather than another mandatory JavaScript
rewrite, while leaving room for later micro-optimization.

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
