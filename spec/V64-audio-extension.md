# V64 AM1 audio extension

Status: proof-profile extension implemented and checked in JavaScript.

## Timeline

- Audio is mono 48 kHz.
- The V64 timeline remains 60,000 ticks per second.
- Every audio boundary must map exactly between samples and ticks.
- A file with encoded audio uses `AURN` for non-silent runs and `SILN` for explicit zero-valued spans.
- `AURN` and `SILN` chunks must form one continuous timeline from tick zero through the declared file duration.
- Silence never shortens time.

## `AURN` chunk

`AURN` is a mandatory uppercase chunk and sets header feature bit `0x40`.

The payload is uncompressed standard Opus packet data with explicit sample accounting. Ogg framing is not stored in V64.

### Fixed header: 32 bytes

| Offset | Type | Field |
|---:|---|---|
| 0 | u8 | version, currently `1` |
| 1 | u8 | channels, currently `1` |
| 2 | u16 LE | reserved flags, must be zero |
| 4 | u32 LE | sample rate, must be `48000` |
| 8 | u32 LE | decoder pre-skip samples |
| 12 | u32 LE | end-trim samples |
| 16 | u32 LE | kept output samples |
| 20 | u32 LE | total decoded packet samples |
| 24 | u32 LE | packet count |
| 28 | u32 LE | total packet-data bytes |

The accounting identity is mandatory:

`pre_skip + kept_samples + end_trim = decoded_samples`

The chunk duration must equal `kept_samples` converted exactly to 60,000-Hz timeline ticks. The chunk timestamp must lie on an exact 48-kHz sample boundary.

### Packet descriptors

The fixed header is followed by one four-byte descriptor per packet:

| Offset within descriptor | Type | Field |
|---:|---|---|
| 0 | u16 LE | packet length, 1–1275 bytes |
| 2 | u16 LE | decoded samples declared for this packet |

The descriptor table is followed by the concatenated Opus packet bytes.

Every declared packet duration must equal the duration inferred from the Opus TOC. The sum of inferred packet samples must equal `decoded_samples`.

The proof profile is bounded to 65,535 packets per `AURN` chunk.

## `SILN` chunk

- Payload must be empty.
- Duration must be nonzero.
- Decoders synthesize exact zero PCM for the complete span.

## Playback reconstruction

The JavaScript proof decoder wraps each independent `AURN` run in deterministic Ogg Opus framing only for interchange with FFmpeg/libopus. The wrapper uses:

- fixed serial `0x56363401`;
- `OpusHead` version 1, mono, mapping family 0;
- vendor string `V64`;
- final granule equal to `decoded_samples - end_trim`.

Ogg bytes are not normative V64 data. Standard Opus packet bytes and the AURN accounting fields are normative.

## Checked fixture

The two-second AM1 fixture contains:

- 48 video frames at 24 fps;
- two independent `AURN` runs;
- two exact `SILN` spans;
- 96,000 total audio samples;
- five repeated-seek windows that match exact slices of the full PCM decode.

The implementation rejects payload-length disagreement, malformed packet lengths, TOC-duration disagreement, trim/accounting mismatch, timeline gaps, feature-bit mismatch, inexact sample boundaries, and incomplete audio coverage.
