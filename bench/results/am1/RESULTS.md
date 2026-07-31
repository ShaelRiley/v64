# AM1 audio, container, and playback results

## Decision

The deterministic AM1 audio-run, container, and repeated-seek playback gates passed.

Checked workflow: `30596274425`  
Checked code head: `c5f76b05789e64645c3d532f819dbfd107e33858`  
Artifact: `am1-deterministic-fixture`, ID `8780245153`

## Deterministic source

- Mono PCM16 WAV
- 48 kHz
- 96,000 samples / two seconds
- WAV bytes: **192,044**
- WAV SHA-256: `cb98b4184e0c5f69ab296b80c94b71b9896f5e44cff6e76dd0ec6d957f237c89`

## Hysteretic silence

Detector profile:

- entry threshold: **−48 dB**
- exit threshold: **−42 dB**
- window: **10 ms**
- minimum silence: **120 ms**
- exit hangover: **40 ms**

Detected exact spans:

- samples `12000..31200`, ticks `15000..39000`;
- samples `69600..96000`, ticks `87000..120000`.

An 80 ms quiet pause is deliberately retained as audio. `SILN` spans have empty payloads and synthesize exact zero PCM without shortening the timeline.

## Standard Opus runs

AM1 uses mono 48 kHz standard Opus packets, VOIP application, 20 ms frames, constrained VBR, and 8 kbit/s for the current default experiment.

Run 0:

- 13 packets / 12,000 kept samples;
- pre-skip 312, end trim 168;
- packet stream 279 bytes;
- `AURN` payload 337 bytes;
- packet-stream SHA-256 `f22ce5e8bc6c25ac65dac4da1e79d4cf3b292874b75333b7d0dff04198ea93be`.

Run 1:

- 41 packets / 38,400 kept samples;
- pre-skip 312, end trim 648;
- packet stream 801 bytes;
- `AURN` payload 915 bytes;
- packet-stream SHA-256 `d1bc7fe8999fe1252f634a6d4f2511d7e1dcf340fd5e117d72d2e6e12471449c`.

Encoded runs plus explicit silence account for exactly **96,000 samples**.

## V64 container

The checked fixture contains 48 video frames, two `AURN` chunks, two `SILN` chunks, and one keyframe index.

- V64 bytes: **1,732**
- V64 SHA-256: `a61b40502b4fd4a079dcb4bef050c7c33b9a854a6126ad350d8800b2d454b469`
- Header feature flags: `91`
- Duration: **120,000 ticks**
- Verified chunks: **9**

The verifier rejects packet-length disagreement, Opus-TOC duration disagreement, trim/accounting mismatch, inexact sample boundaries, audio gaps, incomplete duration coverage, and feature-bit mismatch.

## Playback and seeking

The proof decoder reconstructs deterministic Ogg framing only as an FFmpeg/libopus transport. V64 stores standard packet bytes and AURN accounting, not Ogg.

- Decoded PCM: **96,000 samples / 192,000 bytes**
- PCM SHA-256: `b7c875b16fb4673f806477679470b3d6fcde1c92df331a0ba4983c3c33da99a5`
- Explicit silence regions are exact zero samples.
- Five independent seek windows, including audio/silence boundaries, match exact slices of the full decode byte-for-byte.

## Next gate

Implement the AM1 preprocessing path and compare matched 4, 8, 12, and 16 kbit/s Opus outputs using objective measurements and blinded listening before freezing the encoder default.
