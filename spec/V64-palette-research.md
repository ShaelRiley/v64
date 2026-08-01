# V64 palette research

Status: design direction and experimental assets; not a normative palette
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

## Human-content tranche 1 result

Candidate 2 has been measured on three original CC0 human-content sources at a
16-color prefix: lecture/dialogue, saturated performance, and 2D animated
dialogue. It was 99 raw-DEFLATE bytes (0.66%) smaller than candidate 1 across
the matched two-second lanes. Visual inspection was mixed: the performance
lane gained the intended saturated identity, while lecture and animation
showed inadequate blue/teal and midtone separation. Subtitles were unreadable
at 40 columns under both candidates.

Candidate 2 therefore validates the Hyper Real direction but fails the
low-depth-prefix freeze gate.

## Candidate 3

`V64-P256-HYPERREAL-CANDIDATE-3` keeps the exact twelve Hyper Real anchors in the
same order and replaces candidate 2's four grayscale completions with targeted
16-color utility entries:

| Prefix | Hex | Role |
|---:|---|---|
| 13 | `#102048` | dark navy separation |
| 14 | `#005c60` | dark teal separation |
| 15 | `#b27048` | warm skin midtone |
| 16 | `#707070` | neutral midtone / edge support |

The first twelve legal prefixes therefore remain unchanged. Candidate 3 changes
only the 16-color completion and the deterministic farthest-point sequence that
follows it.

Asset and identities:

- `assets/palettes/v64-p256-hyperreal-candidate-3.json`
- generator: `tools/hyperreal-palette-generator.mjs`
- runtime bytes are reconstructed from the validated JSON color table;
  `npm run palette:hyperreal` also emits the corresponding `.rgb` file
- palette SHA-256:
  `071127822f9fb56aef0c6b62b6b2807ff035d76d801fe8aa0d71c5c89ca872af`
- 16-color prefix SHA-256:
  `ed5a8057ee3bc5dbd06c1f03949d59cf323f736295a70b72aefc5aa875886838`

Candidate 3 is a testable hypothesis, not a selection. Its darker chromatic
utility colors may improve blue/teal and skin separation, but only the matched
tranche-2 previews and blinded scoring can establish whether that benefit
outweighs the loss of candidate 2's additional grayscale steps.

## Freeze gate

Do not freeze `V64-P256-1` until all of the following are recorded:

- matched candidate-1 / candidate-3 results for 3D animation,
  black-and-white film, and screen capture;
- 60- and 80-column subtitle transcription rates for both palettes;
- blinded recognizability and separation scores;
- complete-file size and temporal-stability deltas on identical source lanes.

See `bench/HUMAN_RASTER_TRANCHE_1.md` and
`bench/HUMAN_RASTER_TRANCHE_2.md`.
