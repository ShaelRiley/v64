# Rust / JavaScript subtitle and audio extension gate

Checked 2026-07-31 at branch head
`3f4daf0977559a54759b6df89aba9af3ead308b9`.

Workflow: `30646732176`

Artifact: `8799766615`

Artifact ZIP SHA-256:

`a7e896871ec424636fe5a8e40a6b411ad69b6b04b930aa67afb6f33a6a6bcc30`

## Result

The independent Rust conformance decoder and the JavaScript reference decoder
produced byte-identical canonical semantic streams for both adopted extension
profiles.

- `SUBT` / SM2 stream SHA-256:
  `65a41040b8b8931e051efc4912c291c653582f4f8b642c8d1a8f50f38f69f1b2`
- `AURN` / `SILN` stream SHA-256:
  `6f9098e0a9b2218c648993af4266ed53daff0346f06f92675dcbb8cde2d2222b`
- deterministic `SUBT` container SHA-256:
  `2535ea2368fe562dcc9ec46b6b6cdb216ad797a7f1b735753719101180b9935a`
- deterministic AM1 container SHA-256:
  `a61b40502b4fd4a079dcb4bef050c7c33b9a854a6126ad350d8800b2d454b469`

All 131 JavaScript repository tests passed. The Rust workspace passed all 15
unit tests across the core parser, Phase-1 decoder, Grammar B decoder, and the
new extension decoder.

## Independently checked semantics

### `SUBT`

- feature declaration and chunk presence;
- whole-frame timestamp and duration alignment;
- file-duration bounds and non-overlap;
- SM2 header, grid, palette, frame count, and reserved fields;
- full planes, repeat spans, sparse removals, and upserts;
- row-major cell progress, palette bounds, sixteen mask rows, and exact stream
  exhaustion.

### `AURN` and `SILN`

- feature declaration and complete contiguous audio coverage;
- exact 48 kHz sample/tick conversion;
- mono AM1 header and reserved fields;
- Opus packet length and TOC-derived sample duration;
- packet descriptors, packet bytes, decoded-sample totals, pre-skip, kept
  samples, and end-trim accounting;
- empty-payload explicit silence and nonzero span duration.

## Next gate

Measure Rust decoder resources and hostile-input rejection, then add renderer
hashes, WebAssembly builds, fuzz targets, and the stable C ABI.
