# Checked V1 registry gate

Status: **passed**

Checked code head: `26f93df75912cc134496553d6a12a68fa7938a02`

GitHub Actions workflow: `30600260674` (`V64 V1 registry conformance`)

Artifact: `v1-registry-conformance`, ID `8781628600`

## Result

The JavaScript proof profile now has a machine-readable registry for all known
header features and chunk types. A registry-bound file verifier performs the
existing codec checks and then enforces required bits, feature/chunk presence,
storage-flag declarations, cardinality, final-index placement, and the current
unknown-extension policy.

The clean workflow passed all **109** repository tests. The generated matrix ran
**18** positive and negative scenarios, and all **18** matched their expected
outcome.

## Registry identity

- file: `spec/v64-v1-registry.json`
- format: `V64-V1-REGISTRY-1`
- bytes: **4,058**
- SHA-256:
  `7ea2c530b467c01f17bdea1021648388e008a6b6bc3fc2a3e91b06415f4585e9`
- known feature mask: `0xFF`
- required feature mask: `0x19`
- feature declarations: **8**
- known chunk declarations: **8**

## Feature registry

| Bit | Meaning | Requirement |
|---:|---|---|
| `0x01` | Core glyph video | Required; at least one `VFRM` |
| `0x02` | Explicit silence | Exactly matches `SILN` presence |
| `0x04` | Particle events | Exactly matches `PLIT` presence |
| `0x08` | Seek index | Required; exactly one final `INDX` |
| `0x10` | Canonical assets | Required header declaration |
| `0x20` | Raw-DEFLATE storage | Exactly matches any compressed chunk flag |
| `0x40` | Standard Opus audio runs | Exactly matches `AURN` presence |
| `0x80` | Subtitle mask planes | Exactly matches `SUBT` presence |

Required bits are `0x01 | 0x08 | 0x10 = 0x19`. Any bit outside `0xFF`
remains unknown mandatory and fails closed.

## Chunk registry

The checked known types are:

`VFRM`, `RPTF`, `AURN`, `SILN`, `SUBT`, `PLIT`, `META`, `INDX`.

`VFRM` has minimum cardinality one. `INDX` has exact cardinality one and must be
the final parsed chunk. The existing per-chunk and cross-timeline validators
continue to enforce command bounds, video continuity, AURN/SILN continuity,
SUBT alignment/non-overlap, particle references, CRC, inflation limits, and
index targets.

Unknown all-uppercase or otherwise non-lowercase chunk names are mandatory and
rejected. Unknown names containing lowercase characters are optional extensions:
they are skipped only after normal bounded framing, CRC, and inflation checks.

## Generated conformance matrix

The matrix contains four valid profiles:

- base video/index/assets;
- explicit silence;
- particle events;
- DEFLATE storage.

It also contains fourteen expected failures covering:

- each missing required bit;
- stray `SILN`, `PLIT`, DEFLATE, `AURN`, and `SUBT` feature declarations;
- missing declarations for present silence, particle, and DEFLATE storage;
- missing `VFRM`;
- duplicate `INDX`;
- non-final `INDX`.

All scenarios matched expectation.

## Reproducible commands

```sh
npm run registry:matrix
npm run verify:v1 -- INPUT.v64
```

The file verifier returns both the ordinary codec verification result and the
complete registry declaration report.

## Decision

This registry is checked for the JavaScript V1 proof profile. It is now the
source for generated conformance evidence and registry-bound file verification.
Rust, WebAssembly, native-player, and VLC implementations must consume or
reproduce the same declarations before the final cross-implementation V1 freeze.
