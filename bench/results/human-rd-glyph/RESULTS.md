# Checked human raster 32-primary rate-distortion gate

Status: **passed**

Checked code head: `df0708742300b344e522009a7d78a17e3f1e0359`

GitHub Actions workflow: `30636581459` (`V64 human raster 32-primary gate`)

Artifact: `human-rd-glyph-study`, ID `8795660692`

Artifact ZIP SHA-256:
`c9209d2378fba31218ea39a49fa6e6d36873986dbd9553e1395156cb166238f6`

Full generated summary SHA-256:
`b381ed29dc1afb3920ec00ee5f41fde48f08e28ffac5ceb133f673a04df3f660`

Generated manifest SHA-256:
`4d1c49bf0f9b89ded4b0727d014f9cb4eed35ece49642e1cfb84b4d2f2289e42`

## Scope

The clean workflow passed the complete repository suite and evaluated ten
original CC0 source/grid lanes normalized to normative `V64-P256-1`:

- fictional lecture, performance, and animated-dialogue sources at 40 columns;
- original synthetic depth, monochrome-film, and screen-capture plates at 40
  columns;
- lecture and animated-dialogue subtitle lanes at 60 and 80 columns.

Each two-second 12 fps lane was repeated twice. The cadence-derived group limit
therefore produced two independent 24-frame groups per lane, preserving the
frozen two-second maximum instead of incorrectly applying a fixed 48-frame
limit to 12 fps material.

Four configurations produced 40 verified `.v64` files:

- primary 32-glyph balanced;
- fixed 32-glyph quality;
- optional fixed 64-glyph quality;
- adaptive 32/64-glyph quality.

## Aggregate results

| Configuration | Container bytes | Groups | Scene cuts | Mean distortion | Mean PSNR | 32/64 selections | Worst decode p95 |
|---|---:|---:|---:|---:|---:|---|---:|
| primary 32 balanced | 249,578 | 20 | 0 | 0.018299704 | 17.765714 | 480/0 | 17.575 ms |
| fixed 32 quality | 256,482 | 20 | 0 | 0.018015554 | 17.835827 | 480/0 | 17.907 ms |
| optional 64 quality | 274,904 | 20 | 0 | 0.017388208 | 18.009902 | 0/480 | 18.206 ms |
| adaptive 32/64 quality | 256,482 | 20 | 0 | 0.018015554 | 17.835827 | 480/0 | 17.573 ms |

## Glyph-count decision

At matched quality settings, moving from 32 to 64 glyphs:

- increases container bytes by **7.183%**;
- reduces mean distortion by only **3.482%**.

The adaptive 32/64 quality path selected **32 glyphs for all 480 frames**. Its
bytes and distortion exactly match fixed 32-glyph quality.

This human-raster result strengthens the project decision:

- **32 glyphs is the default, primary product and optimization target**;
- **64 glyphs remains an explicit additional option**;
- the canonical source alphabet remains 64 glyphs;
- the project remains Video 64 and files remain `.v64`;
- 16 glyphs remains research-only and is excluded from the product-facing human
  gate.

Balanced 32 costs **2.766% fewer bytes** than quality 32 while accepting only
**1.553% more distortion**, supporting balanced 32 as the ordinary default.

## Grammar and entropy result

The complete human result reverses the small synthetic-corpus Grammar B lead:

- Phase-1 grammar plus group DEFLATE: **874,752 bytes**;
- Grammar B plus group DEFLATE: **881,164 bytes**;
- Grammar B plus canonical Huffman: **988,292 bytes**;
- Grammar B plus Zstandard: **912,638 bytes**.

Grammar B is **0.733% larger** than Phase-1 under group DEFLATE on this human
corpus. Final command syntax therefore remains open. The synthetic evidence and
human evidence disagree slightly, so neither grammar should be frozen before a
larger mixed-corpus and decoder-complexity decision.

Raw DEFLATE remains **3.449% smaller** than Zstandard on the Grammar B groups.
Canonical Huffman remains noncompetitive.

## Decoder and hostile-input resources

Across ordinary valid files:

- worst decode p95: **18.206 ms**;
- largest sampled heap delta: **16,420,128 bytes**;
- largest sampled ArrayBuffer delta: **2,859,280 bytes**.

The largest checked hostile-source container was 68,448 bytes. All **7/7**
malformed classes were rejected:

- unknown mandatory feature bit;
- excessive declared maximum stored chunk;
- oversized first chunk;
- CRC corruption;
- unknown mandatory uppercase chunk;
- truncated file;
- trailing byte.

Worst hostile-input measurements:

- p95 rejection time: **1.682 ms**;
- sampled heap delta: **129,336 bytes**;
- sampled ArrayBuffer delta: **920,753 bytes**.

## Decisions

- Freeze 32 glyphs as the primary/default JavaScript encoder budget.
- Retain 64 glyphs as the explicit full-alphabet option.
- Keep balanced as the ordinary target and quality as an opt-in target.
- Preserve the cadence-derived two-second independent-group ceiling.
- Do not freeze Grammar B; Phase-1 leads this human gate by 0.733%.
- Continue advancing raw DEFLATE as the current entropy leader, without a final
  cross-implementation freeze.

The next implementation gate is encoder metadata and inspection support for the
32/64 profile choice, followed by Rust/WebAssembly golden agreement and broader
mixed-corpus grammar selection.
