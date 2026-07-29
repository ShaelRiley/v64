<!-- Exported verbatim in paragraph order from the authoritative Google Doc on 2026-07-29. -->

# V64 / ANSI Drop — Design Specification and Implementation Plan

## V64 Video Format and ANSI Drop

Design specification, encoder product definition, reference architecture, and implementation plan

### Working definition

V64 is a deliberately low-fidelity audiovisual format that converts conventional video into a fixed grid of Video 64 Homebrew cells. Each cell uses one of Shael Riley’s canonical 8×16 bitmap glyphs and foreground/background colors drawn from a selectable bounded palette. The file stores cell states, temporal changes, deterministic particle-lighting events, and narrowband mono audio rather than ordinary pixels. V64 supports exactly eleven frame cadences—0.10, 0.5, 1, 3, 6, 12, 15, 24, 30, 48, and 60 frames per second—with 24 fps as the normative default and 60 fps as the maximum.

### Bottom line

Build V64 as a new medium with a normative decoder specification and a replaceable encoder. Preserve the existing 64 Video 64 glyph masks exactly; lock the timing model to 0.10/0.5/1/3/6/12/15/24/30/48/60 fps; default to 24 fps; expose selectable columns and palette depths; use dual-color cells; compress through temporal hysteresis, skipped cells, repeated frames, run-length commands, local dictionaries, and entropy coding; encode sparse lighting triggers that drive a deterministic particle system; store mono AM-grade Opus packets for non-silent audio and exact silence spans for silence; and ship ANSI Drop as the primary drag-and-drop encoder before VLC integration.

The product objective is not a predetermined megabyte claim but the smallest watchable file at a chosen grid, frame rate, palette depth, and effect setting. ANSI Drop will rapidly analyze an input, estimate the resulting size for the current controls, and show the quality/size trade before full encoding. Exact size is known only after encoding.

### 1. Product thesis

V64 should not attempt to reconstruct the source video. Its promise is different: preserve motion, staging, silhouettes, faces, textural rhythm, color identity, dialogue, and timing well enough that a movie remains watchable as a distinctive homebrew glyph-video artifact.

- The decoder is simple, deterministic, offline-capable, and royalty-free apart from any chosen third-party audio library obligations.

- The glyph alphabet and palette are static format assets. A decoder never trains, downloads, or generates them.

- The encoder may improve indefinitely without invalidating older decoders.

- The format is suitable for films, animation, music videos, archival curiosities, low-bandwidth sharing, demos, and artistic releases.

- A .v64 file must remain playable without ANSI Tube, a browser, YouTube, or a network connection.

#### Non-goals

- Pixel-faithful preservation, photographic restoration, or archival-master fidelity.

- Direct competition with H.264, AV1, or HEVC at equal perceptual quality.

- Lossless source-video round trips.

- Embedding arbitrary per-file glyph sets or palettes in the v1 core profile.

- Depending on machine learning during decoding.

- Making the VLC plugin the first proof that the format works.

### 2. ANSI Drop encoder product

ANSI Drop is the primary user-facing encoder: a compact desktop utility inspired by Ogg Drop and FLAC Drop. The interaction model is deliberate simplicity rather than a conventional transcoder dashboard.

#### Core interaction

- Drag one or more conventional video files onto the ANSI Drop window or application icon.

- Select one of eleven frame cadences: 0.10, 0.5, 1, 3, 6, 12, 15, 24, 30, 48, or 60 fps. Use a discrete stepped slider or segmented cadence control; 24 fps is preselected.

- Select columns. Rows are previewed automatically from aspect ratio.

- Select palette depth from the supported discrete list.

- Enable or disable Particle Lighting and choose Low, Standard, or High event density. Standard is the default.

- Choose an output profile: Smallest, Balanced, or Clearest. The profile changes temporal retention, keyframe spacing, audio bitrate, and entropy effort, but never silently changes the selected frame rate, columns, or palette depth.

- Review the visual preview, estimated file size, estimated bitrate, and estimated encode time; then press Encode or simply drop again onto a designated Encode target.

#### Size estimator

ANSI Drop cannot know the exact compressed size before performing the encode. It therefore runs a rapid analysis pass over sampled frames and audio windows. The estimate combines cell-change rate, token entropy, scene-cut frequency, particle-event frequency, speech duty cycle, selected grid, palette index width, frame rate, and profile settings. The interface displays a central estimate and a conservative range, for example “Estimated 18 MB; likely 15–23 MB.” After encoding, it replaces the estimate with the exact size and records estimator error for local calibration.

#### Preview behavior

- Loop a representative 8–15 second section selected from motion, dialogue, and scene-change heuristics.

- Allow source/V64 split view and instantaneous switching among the eleven frame cadences, palette depths, and column settings.

- Show the decoded output, not the encoder’s analysis proxy.

- Display effective output dimensions as columns × rows and raster-equivalent 8×16 cell dimensions.

- Warn when a combination is likely to be unrecognizable or disproportionately large.

#### Batch and accessibility behavior

- Each queued file may inherit global controls or override them.

- Keyboard operation must cover file selection, all eleven cadence positions, column choices, palette depth, effect density, preview, and encode.

- Progress must report analysis, video encode, audio encode, mux, verify, and completion separately.

- Failed files remain in the queue with actionable diagnostics; successful files are not reprocessed.

### 3. Cardinality and coding-efficiency decisions

#### Why retain 64 glyphs

Sixty-four glyphs is unusually efficient because it maps exactly to six bits. A 32-glyph alphabet would save one raw glyph bit per explicitly coded cell, but may worsen shape matching enough to increase changed-cell frequency and color churn. A 128-glyph alphabet would cost a seventh bit and likely add redundant shapes. Therefore V64 retains all 64 canonical glyphs in the decoder while requiring the encoder benchmark three modes: Full 64, Compact 32, and Adaptive Subset.

- Full 64: direct 6-bit canonical index; highest structural vocabulary and simplest decoder.

- Compact 32: one standardized 32-glyph subset selected by corpus testing; 5-bit raw index.

- Adaptive Subset: file or group-of-pictures dictionary maps 16, 32, or 64 local codes to canonical glyph IDs. This can reduce entropy without changing the canonical set, but dictionary overhead must be included in every comparison.

The v1 default remains Full 64 unless corpus testing demonstrates that Compact 32 produces a lower total bitrate at equivalent recognizable fidelity. The decision is empirical: bytes per minute at matched human legibility, not visual intuition alone.

#### Palette cardinality

Unlike the glyph vocabulary, palette depth should vary by file. Color indices are present twice in a dual-color cell and therefore materially affect bitrate. ANSI Drop exposes the discrete depths and estimates their actual effect. Lower depth usually reduces token diversity and improves run/dictionary compression even when raw index width does not change.

#### Column cardinality

Columns are the strongest size control because cell count grows approximately linearly with columns and rows grows with columns at fixed aspect ratio, making total cells grow roughly with the square of column count. Doubling columns therefore approaches four times as many cells before temporal compression. ANSI Drop must make this relationship visible.

### 4. Existing ANSI Tube foundation

The inspected ANSI Tube baseline is manifest version 0.9.9. Its repository already contains the essential visual invention required for V64: an original deterministic 64-shape, 8×16 bitmap video alphabet; a 4×8 proxy sampled for every output cell; structure-aware glyph matching; independent foreground and background colors; and temporal stability that resists marginal glyph changes, texture flicker, and small palette oscillations.

#### Canonical existing assets to preserve

- VIDEO_GLYPH_NAMES: the ordered semantic names of all 64 glyphs.

- VIDEO_GLYPH_MASKS: exactly 64 masks, each represented by sixteen bytes; each byte is one 8-pixel bitmap row with the most-significant bit on the left.

- The canonical 8×16 cell dimensions.

- The current reference matcher’s feature model: binary occupancy, area, centroid, coarse regional occupancy, and orientation histogram.

- The current encoder’s foreground/background polarity selection and temporal-stability behavior.

- The present grid geometry, in which rows are derived from source aspect ratio and the 8×16 cell aspect.

The masks, their order, and their names become a versioned format asset. They are not merely an encoder implementation detail. Any future glyph revision requires a new glyph-set identifier and cannot silently replace Video64-v1.

#### Reference glyph order

Void; Center Pin; Vertical Seed; Horizontal Seed; Small Disk; Ring; Mid Disk; Full Block; Upper Half; Lower Half; Left Half; Right Half; Upper-Left Quarter; Upper-Right Quarter; Lower-Left Quarter; Lower-Right Quarter; Center Pillar; Center Slab; Top Band; Bottom Band; Vertical Thin; Vertical Heavy; Horizontal Thin; Horizontal Heavy; Rising Diagonal Thin; Rising Diagonal Heavy; Falling Diagonal Thin; Falling Diagonal Heavy; Left Edge; Right Edge; Top Edge; Bottom Edge; Terminal Left; Terminal Right; Terminal Up; Terminal Down; Corner Upper Left; Corner Upper Right; Corner Lower Left; Corner Lower Right; Tee Up; Tee Down; Tee Left; Tee Right; Cross; Diagonal Cross; Fork Up; Fork Down; Top Arc; Bottom Arc; Left Arc; Right Arc; Smile; Frown; Eye Pair; Brow Pair; Nose Mark; Mouth Bar; Head Dot; Bust Silhouette; Sparse Checker; Dense Checker; Vertical Hatch; Horizontal Hatch.

#### Code reuse boundary

Do not copy the browser renderer wholesale. Extract the deterministic visual core from ANSI Tube and separate three concerns that are currently adjacent:

- Analysis: source pixels to candidate glyph index, foreground color, and background color.

- Encoding: candidate cell states to rate-controlled temporal commands.

- Rendering: decoded cell states to an RGB or YUV output frame.

The browser implementation remains a visual reference and prototype source. The V64 specification must define the decoded cell states and timing, not mandate one JavaScript matching algorithm.

### 5. Normative v1 media profile

A conforming V64 v1 core file uses the following constrained media model.

#### Video grid

- Cell dimensions: 8×16 output pixels.

- Columns: user-selectable encoder control. Recommended UI choices are 40, 60, 80, 100, 120, 160, and 200, with an Advanced numeric entry bounded by the decoder profile.

- Rows: derived automatically from source aspect ratio and the 8×16 cell aspect unless an advanced crop or squash mode is selected.

- Frame cadence: exactly 0.10, 0.5, 1, 3, 6, 12, 15, 24, 30, 48, or 60 fps. Default: 24 fps. Maximum: 60 fps. No arbitrary or variable nominal frame-rate values are permitted.

- Frame durations: repeat-frame spans may cover multiple nominal ticks, allowing static passages to consume almost no video data while preserving the selected playback cadence.

- Scan order: left-to-right, top-to-bottom.

- Recommended hard decoder limit: 512 columns × 288 rows.

- No interlacing, alpha channel, rotation metadata, or chroma subsampling exists at the cell-state layer.

#### Cell state

The v1 core cell is dual-color. A cell state contains:

- Glyph index: 6 bits, values 0–63.

- Foreground palette index: 8 bits, values 0–255.

- Background palette index: 8 bits, values 0–255.

- Reserved token bits: 2 bits, set to zero in v1.

The complete cell token occupies 24 bits on disk. Bits 0–5 are the glyph index; bits 6–13 are the foreground index; bits 14–21 are the background index; bits 22–23 are reserved. The glyph mask chooses foreground for set bits and background for cleared bits. The encoder’s temporary polarity decision is therefore resolved into color order and is not stored as a separate bit.

A constrained Monochrome-on-Black profile may fix the background to palette index 0 and use a compact 14-bit logical state, but the core decoder must support dual-color cells. Dual color is the principal reason Video64 preserves local edge polarity and recognizable forms.

#### Selectable palette-depth model

V64 does not assume that 256 colors is always optimal. The encoder exposes palette depth as a first-class rate-control dimension. The decoder supports a canonical ordered 256-color master palette, and each file declares how many leading entries are active or supplies a compact palette remap table.

Permitted palette depths

ANSI Drop offers 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, and 256 colors, matching ANSI Tube’s established depth vocabulary. Power-of-two depths receive an “efficient packing” indicator because fixed-width indices use every code point. Non-power-of-two depths remain valid and can still save space when entropy coding is enabled, but they may occupy the same raw bit width as the next power of two.

- 2 colors: 1 bit per color index.

- 3–4 colors: 2 bits.

- 6–8 colors: 3 bits.

- 12–16 colors: 4 bits.

- 24–32 colors: 5 bits.

- 48–64 colors: 6 bits.

- 96–128 colors: 7 bits.

- 256 colors: 8 bits.

The encoder must report the actual coded cost rather than implying that every smaller number yields a smaller file. A 24-color file, for example, may cost the same fixed-width index bits as a 32-color file unless probability coding and token reuse exploit the smaller distribution.

Master-palette construction

- Build one legally usable calibration corpus spanning live action, varied skin tones, animation, low-light and high-key footage, landscapes, saturated graphics, monochrome films, subtitles, and interfaces.

- Cluster in OKLab with reserved neutral, skin-tone, dark-chroma, and saturated anchor regions.

- Order the resulting 256 entries so useful lower-depth prefixes are perceptually balanced rather than merely truncations of an arbitrary list.

- Publish the 768-byte RGB table, human-readable values, rendered chart, construction script, corpus manifest, and cryptographic hash.

- Freeze the master palette only after blind review across every supported depth.

Per-file custom palettes are deferred until measurements prove that their header overhead and reduced interoperability outperform the ordered master palette.

#### Glyph-set identity

- Glyph-set ID 1: Video64-v1.

- Palette ID 1: V64-P256-1.

- The file header includes both numeric IDs and truncated content hashes.

- A decoder must reject unknown mandatory IDs rather than silently substituting different assets.

- Optional future IDs may add other fixed alphabets or palettes while preserving v1 decoding.

### 6. Why the file can be extremely small

At 80×23, one frame contains only 1,840 cells. A naïve dual-color full frame is 1,840 × 22 logical bits, approximately 5.1 KB before packing overhead. At 12 frames per second, naïvely rewriting every cell would still consume roughly 219 MB per hour. V64 becomes small only when it avoids rewriting most cells.

The principal compression gains must come from:

- Severe spatial reduction before encoding: the source becomes 1,840 symbolic cells rather than hundreds of thousands or millions of pixels.

- Temporal rate-distortion control: leave a prior cell unchanged unless the visual improvement justifies the required bits.

- Repeat-frame spans: represent identical or intentionally held frames by duration, not duplicated payloads.

- Skip runs: unchanged cells cost a short command and run length.

- Repeated-token runs and filled rectangles for large areas.

- Small local dictionaries for recurring glyph/foreground/background combinations.

- Scene-cut keyframes rather than fixed full-frame rewriting.

- Palette and glyph hysteresis that prevents low-value oscillation.

- Repeat-frame spans and deliberate frame holds during low-motion or high-complexity passages, while preserving the selected nominal cadence.

#### Target bitrate envelopes

- Micro: approximately 8–20 kb/s total, intended for extreme novelty compression.

- Tiny: approximately 18–40 kb/s total.

- Standard: approximately 30–75 kb/s total.

- Rich: approximately 60–160 kb/s total.

At 35 kb/s total, a 90-minute file is about 23.6 MB. At 20 kb/s, it is about 13.5 MB. At 70 kb/s, it is about 47.3 MB. Actual performance must be measured on a public benchmark corpus; the encoder should expose both target-bitrate and target-quality modes.

### 7. Container and bitstream

The .v64 container should be intentionally small, seekable, streamable, and easy to parse without a general multimedia framework. All multibyte integers are little-endian. Variable-length unsigned integers use a bounded LEB128-style encoding.

#### Fixed 80-byte file header

- Bytes 0–3: magic V64F.

- Bytes 4–5: major version.

- Bytes 6–7: minor version.

- Bytes 8–11: header size.

- Bytes 12–15: global flags.

- Bytes 16–17: columns.

- Bytes 18–19: rows.

- Bytes 20–23: nominal frame-rate numerator.

- Bytes 24–27: nominal frame-rate denominator.

- Bytes 28–31: timeline ticks per second.

- Bytes 32–39: total duration in ticks, or zero when unknown during streaming.

- Bytes 40–43: glyph-set ID.

- Bytes 44–47: palette ID.

- Bytes 48–55: truncated glyph-set content hash.

- Bytes 56–63: truncated palette content hash.

- Bytes 64–71: byte offset of the final seek index, or zero for a non-seekable stream.

- Bytes 72–75: recommended maximum keyframe interval in ticks.

- Bytes 76–79: reserved, zero in v1.

#### Chunk framing

Every chunk begins with a 24-byte header: four-byte ASCII type; 32-bit flags; 64-bit presentation timestamp; 32-bit duration in timeline ticks; and 32-bit payload length. Unknown optional chunks may be skipped by length. Mandatory unknown chunks cause a clean unsupported-format error.

Core chunk types

- META: optional UTF-8 JSON metadata, bounded in size and never required for playback.

- VFRM: one keyframe, delta frame, or repeat-frame record.

- AUDP: one or more length-prefixed Opus packets with exact sample durations.

- SILN: exact-duration generated silence; payload may be empty.

- INDX: seek entries mapping timestamps to file offsets and keyframe status.

- END!: optional terminal marker for streaming validation.

A per-chunk CRC32 may be enabled by a global flag. Decoders must validate declared lengths before allocation and must impose practical limits on metadata, dictionary size, grid dimensions, and packet counts.

#### Video frame model

A keyframe begins from the canonical void cell state. A delta frame begins from the fully decoded preceding frame. A repeat frame changes no cells and advances time by its declared duration. Both keyframes and delta frames use the same row-major command stream.

Core command opcodes

- 0x00 END: finish the frame; all remaining cells retain their baseline state.

- 0x01 SKIP n: advance across n unchanged cells.

- 0x02 LITERAL n: read n packed 24-bit tokens and write them sequentially.

- 0x03 REPEAT_TOKEN n token: write one token into n sequential cells.

- 0x04 DEFINE_LOCAL_DICTIONARY k: read k packed tokens, where 1 ≤ k ≤ 256.

- 0x05 DICTIONARY_LITERAL n: read n one-byte dictionary indexes and write the referenced tokens.

- 0x06 FILL_RECT x y w h token: fill a bounded rectangle.

- 0x07 through 0x1F: reserved for compatible future extensions, including motion-copy commands.

The encoder must evaluate several legal representations for each frame and select the smallest. A decoder does not need to know how that decision was made.

#### Seeking

- Emit keyframes at scene cuts and at a configurable maximum interval, recommended two to five seconds.

- Write a compact final index containing timestamp, file offset, and keyframe flag.

- Permit playback without an index by linear parsing.

- On seek, jump to the nearest preceding keyframe, rebuild forward, and synchronize audio by timestamp.

### 8. Deterministic particle-lighting layer

Particle Lighting is a format-native visual layer derived from ANSI Tube’s reactive-effects concept. It is not stored as rendered pixels or a list of every particle. The encoder writes sparse lighting events; every conforming decoder expands them through the same deterministic simulation.

#### Event record

- Timestamp in nominal frame ticks.

- Normalized origin X and Y.

- Event class: burst, spark, aura, ray, phosphor trail, or contour flash.

- Intensity, radius, lifetime, and decay curve.

- Palette color index or automatic foreground-derived color sentinel.

- Direction and spread where applicable.

- 16-bit deterministic seed.

A typical event record should occupy 8–14 bytes before entropy coding. Quiet frames carry no effect data. The simulation uses bounded particle counts and fixed-point or precisely specified integer arithmetic so independent decoders render equivalent results.

#### Lighting interaction

- Particles and auras are composited after glyph rasterization.

- Lighting may brighten or tint nearby glyph foreground/background colors through a bounded lookup table; it may not alter the decoded glyph state.

- Phosphor trails use prior decoded frames but have a specified maximum persistence, allowing deterministic seeking from a keyframe plus a short preroll.

- Decoders must support the layer. Users may disable its display for accessibility or performance, but the file remains conforming.

- ANSI Drop’s Standard setting should privilege sparse, salient events. The effect must remain lighting punctuation, not constant visual confetti.

#### Encoder detection

The reference encoder derives events from low-resolution luminance change, edge energy, bright-source persistence, local motion, and scene cuts. It rate-limits events, merges nearby triggers, and selects the cheapest event sequence that preserves the intended reactive impression. This layer should add only a small fraction of video bitrate.

### 9. Audio profile

V64 audio is not merely low bitrate; it is deliberately narrowband and mono, with exact timing and explicit silence. The v1 recommendation is standard Opus audio packets so existing, mature decoders can be reused.

#### V64-AM1 default

- One channel.

- Speech-oriented Opus application mode.

- Narrowband or medium-bandwidth operation, selected by profile.

- Default target bitrate: 8 kb/s; permitted range: 4–16 kb/s.

- Pre-encode band shaping approximately 200 Hz to 4.5 kHz for an AM-radio-like presentation.

- Light dynamic-range compression and peak limiting; no synthetic static is required.

- Optional noise gate with hysteresis, minimum silence duration, and hangover to avoid chattering.

- Container timestamps are authoritative; the audio codec never determines movie timing.

#### Silence representation

The audio analyzer detects sustained silence using RMS energy plus a peak guard. Recommended initial settings are an entry threshold near −48 dBFS, an exit threshold near −42 dBFS, a minimum silence duration of 250 ms, and a 120 ms hangover. These are encoder defaults, not normative decoder values.

- Short quiet passages may remain ordinary Opus packets with DTX enabled.

- Long qualifying silence becomes a SILN chunk carrying only timestamp and duration.

- The decoder generates exact zero-valued samples for the declared duration.

- The encoder preserves leading silence, trailing silence, and gaps; it never shortens the timeline.

- A crossfade or retained hangover around speech edges prevents clipped consonants.

Using standard Opus packets also simplifies VLC integration: the V64 demuxer can emit an ordinary Opus elementary stream while only the glyph-video track requires a custom decoder.

### 10. Reference encoder architecture

The encoder is a pipeline with strict stage boundaries so visual research can continue without destabilizing the container or decoder.

#### Stage A: source ingest

- Use FFmpeg or libavformat/libavcodec to decode common source formats.

- Read timestamps rather than assuming constant-rate source frames.

- Downmix audio to mono before analysis.

- Apply framing choices: preserve aspect, center crop, zoom, or deliberate squash.

- Resample source frames to the selected glyph cadence.

#### Stage B: Video64 analysis

- For each cell, sample the same 4×8 proxy used by ANSI Tube.

- Compute luma with the existing reference coefficients.

- Split samples around the cell mean into bright and dark masks.

- Score all 64 glyphs against both polarities using the existing Hamming, area, occupancy, centroid, and orientation feature model.

- Compute average bright and dark colors.

- Quantize both colors to V64-P256-1.

- Produce a candidate 24-bit cell token plus a visual-error score.

The current ANSI Tube reference weights may seed the encoder: normalized Hamming error × 3.2; area error × 1.4; regional occupancy error × 0.30; centroid error × 0.70; orientation error × 0.55. These weights are reference behavior, not decoder requirements.

#### Stage C: temporal rate-distortion control

This is the central compression engine. For each cell, compare the candidate token with the previously decoded token against the current source proxy.

- Estimate the visual-error reduction produced by changing the cell.

- Estimate the incremental bit cost under current run, dictionary, and command contexts.

- Apply the change only when error_reduction > lambda × estimated_bits.

- Increase lambda when the encoder exceeds the target bitrate; decrease it when under budget.

- Retain stronger entry penalties for high-frequency texture glyphs.

- Use separate hysteresis for glyph, foreground color, and background color.

- Detect scene cuts from global luma/color change and changed-cell ratio.

- Permit deliberate frame holds when the encoded improvement is negligible.

#### Stage D: frame command optimization

- Construct the changed-cell map against the keyframe or delta baseline.

- Find skip runs and repeated-token runs.

- Test filled rectangles for large uniform regions.

- Build a frequency-ranked local token dictionary.

- Compute the exact encoded byte count for literal, repeat, dictionary, and rectangle alternatives.

- Emit the minimum-cost legal command sequence.

- If a delta frame approaches keyframe cost or a scene cut is detected, emit a keyframe.

#### Stage E: audio analysis and mux

- Apply the V64-AM1 filter and dynamics profile.

- Run silence detection with hysteresis.

- Encode non-silent windows as Opus packets.

- Represent qualifying gaps as SILN chunks.

- Interleave video and audio chunks by presentation timestamp.

- Write the seek index and patch header fields when output is seekable.

#### Determinism

Given identical input bytes, encoder version, profile, and options, the reference encoder should produce identical output. Avoid unseeded dithering, unstable thread-order reductions, and platform-dependent floating-point shortcuts in the conformance path. A faster non-deterministic mode may exist separately.

### 11. Decoder and renderer architecture

The decoder is intentionally simpler than the encoder.

- Parse and validate the fixed header.

- Resolve the canonical glyph and palette assets by ID and hash.

- Maintain one cell-state array for the current frame.

- Apply keyframe or delta commands with strict bounds checking.

- Rasterize each 8×16 glyph using its foreground and background palette entries.

- Output RGBA for simple players or I420/NV12 for multimedia integration.

- Decode Opus packets through a standard library and synthesize exact silent samples for SILN spans.

- Schedule audio and video from container timestamps.

- Seek from the nearest indexed keyframe.

The decoder must never execute metadata, load remote resources, or trust file-declared sizes without caps. It should support fuzzing from the first binary-parser commit.

### 12. Implementation language and repository architecture

Recommended route: validate the format in JavaScript first, then make Rust the reference codec core with a small C ABI for VLC. This preserves the fastest reuse path from ANSI Tube while producing a portable, memory-safe decoder suitable for native applications and WebAssembly.

#### Repository layout

- spec/V64.md: normative specification.

- assets/glyphs/video64-v1.bin and .json: 1,024 bytes of masks plus names and hashes.

- assets/palettes/v64-p256-1.bin, .csv, and .json: canonical 768-byte palette and sources.

- prototype/js/: extracted ANSI Tube analyzer, proof encoder, and browser decoder.

- crates/v64-core/: Rust container parser, frame decoder, renderer, and C ABI.

- crates/v64-encoder/: Rust analysis, rate control, audio, and muxing.

- crates/v64-cli/: encode, decode, play, inspect, verify, and benchmark commands.

- apps/v64-player/: lightweight desktop player.

- plugins/vlc/: VLC demux and video-decoder modules.

- tools/palette-lab/: corpus sampling and palette optimization.

- tests/golden/: fixed bitstreams, expected cell grids, expected frame hashes, malformed files, and audio-timing fixtures.

- bench/: public-domain or self-created calibration clips and reproducible benchmark scripts.

#### Recommended command-line surface

- v64 encode input.mp4 output.v64 --profile standard

- v64 encode input.mkv output.v64 --cols 80 --fps 12 --target-kbps 40 --audio-kbps 8

- v64 play movie.v64

- v64 decode movie.v64 preview.mp4

- v64 inspect movie.v64

- v64 verify movie.v64

- v64 benchmark bench/corpus --profiles micro,tiny,standard,rich

- v64 glyph-atlas assets/glyphs/video64-v1.bin atlas.png

### 13. VLC integration

VLC is modular and loads media functionality through plugins. V64 support should therefore be implemented as two native modules built against a specific target VLC source branch.

#### Demux module

- Recognize the V64F magic and .v64 extension.

- Parse metadata, timeline, chunks, and seek index.

- Expose one custom glyph-video elementary stream using a registered private fourcc such as V64G.

- Expose the audio track as ordinary Opus packets whenever present.

- Convert SILN spans into correctly timed silent audio blocks or packetized silence compatible with VLC’s audio pipeline.

- Implement duration, position, time, and seek controls from the V64 index.

#### Video decoder module

- Accept the V64G elementary stream.

- Apply frame commands through libv64.

- Allocate pictures at columns × 8 by rows × 16.

- Render directly into an efficient VLC-supported pixel format.

- Attach presentation timestamps and frame durations.

- Reset state cleanly on discontinuity and seek.

#### Build strategy

- First prove playback with the standalone player and conformance files.

- Then build the plugin inside a pinned VLC source checkout or supported external-module workflow.

- Test Linux first because the development environment is already available; add Windows and macOS packaging only after bitstream stability.

- Treat VLC plugin ABI changes as an integration concern, not a reason to alter the V64 file format.

- Keep libv64 independent of VLC so other players, FFmpeg integrations, and web decoders can reuse it.

### 14. Profiles

Profiles are encoder presets, not separate incompatible formats.

- Smallest: 48–64 columns; aspect-derived rows; 12 fps; 2–16 colors; strongest frame holds; 4–6 kb/s audio.

- Economy Motion: 64–80 columns; aspect-derived rows; 15 fps; 8–32 colors; moderate frame holds; 6–8 kb/s audio.

- Balanced (default): 80–120 columns; aspect-derived rows; 24 fps; 16–64 colors; Standard Particle Lighting; 8 kb/s audio.

- Clearest: 120–200 columns; aspect-derived rows; 30 fps; 32–256 colors; lighter temporal retention; 10–16 kb/s audio.

All profiles use the same decoder and legal timing set. Profiles never select a frame cadence outside 0.10, 0.5, 1, 3, 6, 12, 15, 24, 30, 48, or 60 fps.

### 15. Build plan and acceptance gates

#### Milestone 0: freeze the inherited visual assets

- Create a new V64 repository.

- Extract the exact 64 names and 64×16 mask bytes from ANSI Tube core.js.

- Generate a labeled glyph-atlas PNG for human inspection.

- Write binary, JSON, and source-language representations from one canonical generator.

- Hash the canonical glyph asset and add a test that fails on accidental mutation.

- Choose and add an explicit open-source license before public distribution.

Exit gate: two independent decoders render the same atlas pixel-for-pixel from the canonical binary asset.

#### Milestone 1: JavaScript proof codec

- Refactor the ANSI Tube Video64 analyzer into a module that outputs cell tokens without rasterizing.

- Implement a minimal .v64 writer with keyframes, delta SKIP/LITERAL/REPEAT commands, and no audio.

- Implement a browser and Node decoder.

- Encode short clips and compare decoded frames against ANSI Tube’s live Video64 output.

- Measure naïve full-frame size, delta size, and repeat-frame size.

Exit gate: a one-minute test clip encodes, seeks from the beginning, decodes deterministically, and plays with stable timing.

#### Milestone 2: canonical palette and rate control

- Build Palette Lab and the calibration corpus manifest.

- Generate V64-P256-1 and freeze its hash.

- Add palette lookup tables and deterministic quantization.

- Implement per-cell rate-distortion retention, frame holds, scene-cut keyframes, local dictionaries, and filled rectangles.

- Add target-bitrate mode and bitrate feedback control.

Exit gate: the Standard profile meets its target bitrate range on the benchmark median without catastrophic identity loss or uncontrolled flicker.

#### Milestone 3: audio and final container

- Implement the V64-AM1 filter path.

- Add mono Opus encoding and decoding.

- Add DTX and explicit SILN chunks.

- Prove sample-accurate duration across leading, internal, and trailing silence.

- Add final seek index, CRC option, metadata bounds, and streaming mode.

Exit gate: a feature-length synthetic timeline retains audiovisual synchronization after linear playback and repeated random seeks.

#### Milestone 4: Rust reference implementation

- Port the normative parser, command decoder, renderer, and asset loader to Rust.

- Expose a stable C ABI.

- Port or reimplement the encoder pipeline behind golden tests.

- Add WebAssembly compilation for a browser player.

- Fuzz the container parser and frame command decoder.

Exit gate: JavaScript and Rust decoders produce identical cell states and frame hashes for every conformance file.

#### Milestone 5: ANSI Drop and standalone tools

- Build ANSI Drop with drag-and-drop queueing, an eleven-position discrete cadence control, column and palette controls, particle-lighting controls, preview, and sampled size estimator.

- Ship v64 encode, play, decode, inspect, verify, and benchmark.

- Provide progress reporting and sensible profile defaults.

- Add malformed-file diagnostics that identify the failing chunk and timestamp.

- Package Linux binaries first, followed by other operating systems.

Exit gate: a user can install one package, convert a normal movie, inspect it, play it, and transcode it back to a conventional preview without developer tools.

#### Milestone 6: VLC plugin

- Implement and test the V64 demux module.

- Implement the V64G video decoder module.

- Pass standard Opus audio through VLC’s existing decoder path.

- Implement seeking, duration, pause/resume, playback-rate changes, and end-of-stream behavior.

- Document plugin installation and compatibility by VLC release family.

Exit gate: representative V64 files open through ordinary VLC file selection, display metadata, seek correctly, and remain synchronized.

#### Milestone 7: release and ecosystem

- Publish the normative specification and conformance suite.

- Tag Video64-v1 and V64-P256-1 as immutable assets.

- Publish sample encodes with source provenance and reproducible commands.

- Register a MIME type provisionally within the project, such as video/x-v64, while evaluating formal registration later.

- Add file thumbnails, shell association, and optional FFmpeg integration only after the core format is stable.

### 16. Test and benchmark plan

#### Conformance tests

- Golden timing vectors for 0.10, 0.5, 1, 3, 6, 12, 15, 24, 30, 48, and 60 fps; rejection of every other nominal frame rate.

- All 64 glyphs, both uniform colors and contrasting foreground/background pairs.

- Every opcode at boundary values.

- Empty frames, all-void frames, all-full frames, and maximum legal grids.

- Keyframe-to-delta transitions, repeat spans, scene cuts, and seeks.

- Palette and glyph hash mismatch behavior.

- Unknown optional and mandatory chunks.

- Truncated varints, excessive lengths, integer overflow attempts, and malformed rectangles.

- Audio-only silence, speech separated by silence, leading silence, trailing silence, and discontinuities.

- Deterministic output across supported platforms.

#### Quality and compression metrics

- Total kb/s and bytes per minute.

- Video-only and audio-only bitrate.

- Changed-cell percentage per frame.

- Keyframe frequency.

- Opcode distribution and local-dictionary hit rate.

- Source-to-rendered proxy error in OKLab and luma space.

- Temporal flicker score and glyph-change frequency.

- Face, silhouette, subtitle, and motion-legibility human ratings.

- Encode speed, decode speed, memory use, and seek latency.

#### Benchmark categories

- Dialogue-heavy live action.

- Dark cinematography.

- Rapid action and handheld footage.

- 2D animation.

- 3D animation.

- Black-and-white film.

- Concert and music video.

- Screen capture and subtitles.

- Static lecture or podcast video.

- Highly saturated experimental material.

Every benchmark report should compare at least Micro, Tiny, Standard, and Rich profiles and should publish the exact encoder version and command line.

### 17. Security and robustness

- Use bounded parsing and checked arithmetic for every size, index, timestamp, and rectangle.

- Set hard limits for grid dimensions, chunk size, metadata length, dictionary entries, and index entries.

- Reject nonzero reserved bits unless an advertised compatible feature defines them.

- Never allocate from an unchecked 32-bit payload length.

- Fuzz the parser continuously with coverage guidance.

- Keep metadata inert; no scripts, remote fonts, remote images, or automatic URL retrieval.

- Treat corrupt audio as a recoverable gap when possible and corrupt video state as requiring the next keyframe.

- Provide v64 verify for full-file structural validation without rendering.

### 18. Licensing, authorship, and format governance

Video64 is an original alphabet and should carry clear authorship in the specification. The V64 repository should state that the canonical glyph masks originated in ANSI Tube and were created by Shael Riley.

The inspected ANSI Tube repository does not currently expose a root LICENSE file. Before copying code or distributing binaries, choose and add an explicit license. A permissive license such as MIT or Apache-2.0 would maximize decoder and plugin adoption; the final choice is a project-governance decision rather than a codec requirement.

- Publish the specification under a license that permits independent implementations.

- Version the file format, glyph asset, palette asset, and encoder separately.

- Never mutate an already published glyph or palette ID.

- Require a written compatibility note for every new mandatory feature.

- Keep the core decoder small enough for independent clean-room implementations.

### 19. Principal risks and mitigations

- High-motion files remain larger than hoped: Use target-bitrate rate control, adaptive frame holds, stronger temporal retention, and optional Micro/Tiny profiles.

- Dual-color cells consume too many bits: Exploit local token dictionaries; permit Monochrome-on-Black; measure before considering a lossy single-color default.

- Palette choice becomes contentious: Use a reproducible corpus, publish metrics, compare baselines, and freeze only after blind visual review.

- Temporal stability creates smearing: Cap retention duration, reduce lambda around faces/text, force updates after scene cuts, and expose quality profiles.

- Silence detector clips speech: Use hysteresis, hangover, peak guards, and conformance clips with weak consonants and room tone.

- VLC APIs change: Keep the format and libv64 independent; pin and test plugin builds by VLC release branch.

- Decoder vulnerabilities: Rust core, strict bounds, fuzzing, corpus regression tests, and optional CRC validation.

- The project overbuilds before proving compression: Complete the JavaScript no-audio proof codec and benchmark report before native player or VLC work.

### 20. Immediate implementation backlog

- Create the V64 repository and copy this document into spec/V64-design.md as the initial non-normative design.

- Write a one-purpose extraction script that reads ANSI Tube core.js and emits the 1,024-byte glyph asset plus JSON names.

- Render and manually inspect a 64-cell atlas.

- Refactor the JavaScript Video64 converter so it returns cell tokens before rasterization.

- Define the header and core frame commands in a machine-readable schema.

- Implement keyframe, delta SKIP, LITERAL, REPEAT_TOKEN, and repeat-frame encoding.

- Implement a minimal browser decoder and side-by-side source/V64 player.

- Encode five short, legally usable clips and publish size measurements.

- Add temporal rate-distortion retention and rerun the measurements.

- Only after visual compression is validated, freeze V64-P256-1 and begin audio/container completion.

### 21. Decisions adopted by this document

- The working format name is V64 and the extension is .v64.

- The canonical decoder supports all 64 ANSI Tube Video 64 Homebrew glyphs.

- Exactly eleven frame cadences are legal: 0.10, 0.5, 1, 3, 6, 12, 15, 24, 30, 48, and 60 fps; 24 fps is default and 60 fps is maximum.

- Columns and palette depth are explicit encoder controls and declared in the file.

- Palette-depth options are 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, and 256.

- The core cell model is dual-color with constrained profiles permitted.

- Particle Lighting is a native sparse-event layer with deterministic decoder expansion.

- Audio is mono, AM-grade Opus with explicit duration-only silence spans.

- ANSI Drop is the primary encoder interface and performs pre-encode size estimation.

- The normative object is the decoded cell/timing/effect stream, not one encoder matching algorithm.

- A standalone player precedes VLC integration; VLC support uses a demux module plus custom glyph-video decoder while reusing Opus.

### 22. Open decisions requiring empirical selection

- The exact 256 palette entries and their frozen hash.

- The default target bitrate and lambda curve for each profile.

- Whether the core v1 command set includes FILL_RECT immediately or reserves it for v1.1.

- The precise keyframe maximum interval.

- The final AM1 passband and default Opus bandwidth mode.

- The project license.

- The final public expansion of the acronym V64, if any.

### 23. Primary implementation references

- ANSI Tube repository: https://github.com/ShaelRiley/ansi-tube

- VideoLAN VLC developer information: https://www.videolan.org/developers/vlc.html

- VideoLAN libVLC modular architecture: https://www.videolan.org/vlc/libvlc.html

- Opus encoder controls, including bandwidth, mono forcing, bitrate, and DTX: https://www.opus-codec.org/docs/opus_api-1.6/group__opus__encoderctls.html

### Recommended next artifact

The next artifact should be a compact normative V64 v0.1 Bitstream Specification containing only exact binary layouts, required decoder behavior, canonical asset hashes, pseudocode for frame-command application, and conformance vectors. This design document should remain the architectural rationale and implementation roadmap.


