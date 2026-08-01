# Checked scene-cut, rate-distortion, and glyph-budget gate

Status: **passed**

Checked code head: `2a802f851a716c83b4288820ec2e8632533ddd47`

GitHub Actions workflow: `30633411868` (`V64 scene cut and rate-distortion study`)

Artifact: `scene-cut-rate-distortion-glyph-study`, ID `8794322086`

Artifact ZIP SHA-256:
`c7afbf5cb4c2a85a7e7cf9eefb57a3213983875c54e48bb73548bca033f16ed4`

Full generated summary SHA-256:
`afbaeef137c932602b14a234c8652b348184d46d63adbce221332fbc4755be00`

## Result

The clean workflow passed the complete repository suite, executed **66** matched
study cases, independently verified every generated `.v64` container, checked
the 48-frame maximum group bound, and uploaded the full per-class evidence.

The study covers all eleven deterministic CC0 structural classes. Each
24-frame seed fixture is rendered to raster and repeated three times, producing
72 frames per class. The raster is then independently re-analyzed under fixed
16/32/64-glyph budgets and explicit `compact`, `balanced`, and `quality`
rate-distortion modes.

## Aggregate results

| Configuration | Container bytes | Groups | Scene cuts | Mean normalized distortion | Mean PSNR | 16/32/64 selections |
|---|---:|---:|---:|---:|---:|---|
| fixed 16 | 85,967 | 22 | 0 | 0.011532598 | 23.937921 | 792/0/0 |
| fixed 32 | 88,671 | 22 | 0 | 0.006832271 | 26.600956 | 0/792/0 |
| fixed 64 | 91,701 | 22 | 0 | 0.005947205 | 27.201746 | 0/0/792 |
| compact | 85,967 | 22 | 0 | 0.011532598 | 23.937921 | 792/0/0 |
| balanced | 88,161 | 22 | 0 | 0.007886214 | 26.083268 | 402/390/0 |
| quality | 90,510 | 67 | 48 | 0.006508797 | 26.914203 | 204/282/306 |

## Glyph-budget findings

Moving from 16 to 32 glyphs costs **3.145%** more container bytes while reducing
mean distortion by **40.757%**. Moving from 32 to 64 glyphs costs another
**3.417%** while reducing distortion by **12.954%**.

This makes 32 glyphs the strongest fixed-budget knee on the deterministic mixed
corpus. Sixty-four glyphs remains useful for the quality target, but the last
32 glyphs provide a smaller incremental return than the first expansion.

The adaptive balanced mode uses 16 glyphs for 402 frames and 32 for 390 frames.
It costs **2.552%** more than compact while reducing distortion by **31.618%**.
The quality mode costs **2.664%** more than balanced while reducing distortion
by another **17.466%**.

## Scene-cut findings

The compact and balanced thresholds retain the ordinary two-group maximum-bound
schedule on this corpus. The quality threshold inserts 48 early scene-cut
boundaries, producing 67 groups across the eleven fixtures. Every group remains
at or below the frozen **48-frame / two-second** maximum.

Scene cuts therefore shorten independent groups but never extend them. Every
new group begins with a self-contained keyframe and passes ordinary container
verification.

## Grammar and entropy findings

Across all six configurations:

- Phase-1 grammar plus group DEFLATE: **156,061 bytes**.
- Grammar B plus group DEFLATE: **100,896 bytes**.
- Grammar B plus canonical Huffman: **418,966 bytes**.
- Grammar B plus Zstandard: **104,852 bytes**.

Grammar B plus raw DEFLATE is **35.348%** smaller than Phase-1 plus DEFLATE.
Raw DEFLATE is **3.773%** smaller than Zstandard on these small independent
groups. Canonical Huffman is decisively noncompetitive in this configuration.

## Decisions

- Keep `compact`, `balanced`, and `quality` as explicit, deterministic target
  modes.
- Retain the 48-frame / two-second maximum; scene cuts may create shorter
  independent groups.
- Treat 32 glyphs as the provisional fixed-budget knee.
- Advance Grammar B and raw DEFLATE as the current benchmark leaders.
- Do **not** freeze final grammar or entropy syntax from synthetic structural
  evidence alone.

The next gate is identical scene/RD/glyph and grammar/backend evaluation on the
legally reusable human raster corpus, followed by decoder-cost and allocation
measurements before a final wire-format selection.
