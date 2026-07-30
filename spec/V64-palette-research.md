# V64 palette research

Status: design direction and experimental asset; not a normative palette
freeze.

## Chromatic direction

The V64 base palette should be inspired by ANSI Tube's **Hyper Real** palette.
Its ultra-saturated hues are an intentional part of V64's visual identity, not
merely an optional display preset.

The canonical ANSI Tube source is `core.js` blob
`29fd2065612454a66a92e431213731c41d5dc28c`. Hyper Real defines these twelve
ordered anchors:

| Prefix | Hex | Role |
|---:|---|---|
| 1 | `#000000` | black |
| 2 | `#ffffff` | white |
| 3 | `#ff1f2d` | saturated red |
| 4 | `#ff7a00` | saturated orange |
| 5 | `#ffe100` | saturated yellow |
| 6 | `#17d45b` | saturated green |
| 7 | `#00d6d9` | saturated cyan |
| 8 | `#1677ff` | saturated blue |
| 9 | `#7a2cff` | saturated violet |
| 10 | `#ff21a8` | saturated magenta |
| 11 | `#7b4b2a` | brown |
| 12 | `#f0c8a0` | warm skin tone |

ANSI Tube also applies a 1.60 saturation grade and 1.12 contrast grade.

## Candidate 2

`V64-P256-HYPERREAL-CANDIDATE-2` preserves the exact twelve anchors as its first
twelve colors. Consequently, the legal 2-, 3-, 4-, 6-, 8-, and 12-color
prefixes remain intentionally ordered and immediately usable. Four neutral
steps complete the 16-color prefix. Remaining entries use deterministic OKLab
farthest-point sampling over the Hyper Real-graded 16³ sRGB lattice.

Assets:

- `assets/palettes/v64-p256-hyperreal-candidate-2.rgb`
- `assets/palettes/v64-p256-hyperreal-candidate-2.json`
- generator: `tools/hyperreal-palette-generator.mjs`
- palette SHA-256:
  `47a136bb5abdabea6ae22387ba9496cee398000c958104ad7f542ab1034785d2`
- anchor-byte SHA-256:
  `31c9a10ee942a10ce0d251dbe5b121cde724844d17e84f42fa247027a1345322`

The current executable still uses `V64-P256-CANDIDATE-1`.

## Human-content tranche 1 result

Candidate 2 has now been measured on three original CC0 human-content sources
at a 16-color prefix: lecture/dialogue, saturated performance, and 2D animated
dialogue. It was 99 raw-DEFLATE bytes (0.66%) smaller than candidate 1 across
the matched two-second lanes. Visual inspection was mixed: the performance
lane gained the intended saturated identity, while lecture and animation
showed inadequate blue/teal and midtone separation. Subtitles were unreadable
at 40 columns under both candidates.

Candidate 2 therefore validates the Hyper Real direction but fails the
low-depth-prefix freeze gate. Candidate 3 should retain the exact Hyper Real
anchors while improving 16-color midtones, skin separation, blue/teal
separation, and subtitle edges. See `bench/HUMAN_RASTER_TRANCHE_1.md`.
