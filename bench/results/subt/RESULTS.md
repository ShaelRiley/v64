# Checked SUBT container gate

Status: **passed**

Checked code head: `c710c8b5e85399d5d1d35ed65ca6829755a0a7d3`

GitHub Actions workflow: `30598259834` (`V64 SUBT container and fixture`)

Artifact: `subt-deterministic-fixture`, ID `8780957363`

## Result

The existing canonical SM2 subtitle sequence is registered in the proof
container as mandatory chunk `SUBT` with mandatory feature bit `0x80`.
Encoder-side SM3, SM4, and SM5 selection improvements continue to produce the
same full-plane, repeat-span, and sparse removal/upsert-delta wire grammar.

The clean workflow passed all 96 repository tests, generated a deterministic
`.v64` fixture, independently verified its manifest, and uploaded the fixture as
a GitHub Actions artifact.

## Deterministic fixture identity

- container: `subt-container.v64`
- bytes: **528**
- SHA-256:
  `2535ea2368fe562dcc9ec46b6b6cdb216ad797a7f1b735753719101180b9935a`
- feature flags: `0xB9`
- `SUBT` feature bit: `0x80`
- video frames: **6**
- subtitle chunks: **2**
- subtitle frames: **5**
- uncovered base-only frames: **1**
- file duration: **15,000 ticks**

The first subtitle chunk covers two identical planes and has a 58-byte canonical
SM2 payload with SHA-256
`0037a6902862233547dba0d1172eb2b1fc59cb4d0c48890bf1e298cd5ca2857a`.

The second subtitle chunk covers three frames, including a changing plane, and
has an 81-byte canonical SM2 payload with SHA-256
`d7fca9882e79402058bc0aba902dcf7096f57c5a77e30a948a1b0aac86d8ed52`.

## Container rules now checked

- `SUBT` is a known mandatory chunk.
- Chunk presence and feature bit `0x80` must agree.
- Feature bits above the registered `0x80` boundary remain mandatory-unknown.
- Timestamp and duration must be whole nominal-frame spans.
- Chunk duration must equal the decoded SM2 frame count.
- SM2 cell count must equal `columns × rows`.
- SM2 palette depth must equal the active V64 palette depth.
- A chunk may not exceed the declared file duration.
- Subtitle coverage may be sparse, but chunks may not overlap.
- Canonical decoding must consume the complete payload.
- Bad magic, trailing bytes, invalid removals, no-progress records, and
  out-of-range cell or palette references fail closed through the canonical SM2
  decoder.

## Decision

The full subtitle readability/rate gate and the proof-container integration gate
have both passed. `SUBT` is therefore a checked extension of the JavaScript proof
container. This does not yet freeze a final V1 registry across future Rust,
browser, native-player, or VLC implementations; those implementations must
reproduce the same bounded semantics and golden fixture identity.
