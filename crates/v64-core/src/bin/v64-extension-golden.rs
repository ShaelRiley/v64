#![forbid(unsafe_code)]

use std::env;
use std::error::Error;
use std::fs;
use v64_core::extensions::{
    AudioLimits, AudioRun, SubtitleLimits, SubtitleSequence, decode_aurn_payload, decode_sm2,
};
use v64_core::{Chunk, V64File};

const SUBT_FEATURE_FLAG: u32 = 0x80;
const AURN_FEATURE_FLAG: u32 = 0x40;

#[derive(Debug, Clone, PartialEq, Eq)]
struct SubtitleChunk {
    timestamp: u64,
    duration: u64,
    sequence: SubtitleSequence,
}


#[derive(Debug, Clone, PartialEq, Eq)]
enum AudioItem {
    Run(AudioRun),
    Silence { timestamp: u64, duration: u64 },
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args_os().skip(1);
    let input = arguments.next().ok_or("missing INPUT.v64")?;
    let output = arguments.next().ok_or("missing OUTPUT.bin")?;
    if arguments.next().is_some() {
        return Err("usage: v64-extension-golden INPUT.v64 OUTPUT.bin".into());
    }

    let file = v64_core::parse(&fs::read(input)?)?;
    let bytes = encode_extension_stream(&file).map_err(|message| format!("{message}"))?;
    fs::write(output, bytes)?;
    Ok(())
}

fn encode_extension_stream(file: &V64File) -> Result<Vec<u8>, String> {
    let subtitles = decode_subtitle_timeline(file)?;
    let audio = decode_audio_timeline(file)?;
    let subtitle_count = u32::try_from(subtitles.len())
        .map_err(|_| "Subtitle chunk count exceeds uint32".to_owned())?;
    let audio_count = u32::try_from(audio.len())
        .map_err(|_| "Audio item count exceeds uint32".to_owned())?;

    let mut output = Vec::new();
    output.extend_from_slice(b"V64EXT1\0");
    output.extend_from_slice(&file.header.columns.to_le_bytes());
    output.extend_from_slice(&file.header.rows.to_le_bytes());
    output.extend_from_slice(&file.header.cadence.frame_ticks.to_le_bytes());
    output.extend_from_slice(&subtitle_count.to_le_bytes());
    output.extend_from_slice(&audio_count.to_le_bytes());

    for chunk in subtitles {
        output.extend_from_slice(&chunk.timestamp.to_le_bytes());
        output.extend_from_slice(&chunk.duration.to_le_bytes());
        output.extend_from_slice(
            &u32::try_from(chunk.sequence.frames.len())
                .map_err(|_| "Subtitle frame count exceeds uint32".to_owned())?
                .to_le_bytes(),
        );
        output.extend_from_slice(&chunk.sequence.cell_count.to_le_bytes());
        output.extend_from_slice(&chunk.sequence.palette_depth.to_le_bytes());
        output.extend_from_slice(&0u16.to_le_bytes());
        for frame in chunk.sequence.frames {
            output.extend_from_slice(
                &u32::try_from(frame.len())
                    .map_err(|_| "Subtitle entry count exceeds uint32".to_owned())?
                    .to_le_bytes(),
            );
            for entry in frame {
                output.extend_from_slice(&entry.cell_index.to_le_bytes());
                output.push(entry.foreground);
                output.push(entry.background);
                output.extend_from_slice(&entry.mask);
            }
        }
    }

    for item in audio {
        match item {
            AudioItem::Run(run) => {
                output.push(0);
                output.extend_from_slice(&[0; 3]);
                output.extend_from_slice(&run.timestamp.to_le_bytes());
                output.extend_from_slice(&run.duration.to_le_bytes());
                output.extend_from_slice(&run.pre_skip.to_le_bytes());
                output.extend_from_slice(&run.end_trim.to_le_bytes());
                output.extend_from_slice(&run.kept_samples.to_le_bytes());
                output.extend_from_slice(&run.decoded_samples.to_le_bytes());
                output.extend_from_slice(
                    &u32::try_from(run.packets.len())
                        .map_err(|_| "AURN packet count exceeds uint32".to_owned())?
                        .to_le_bytes(),
                );
                output.extend_from_slice(&run.packet_data_bytes.to_le_bytes());
                for packet in run.packets {
                    output.extend_from_slice(
                        &u16::try_from(packet.bytes.len())
                            .map_err(|_| "AURN packet length exceeds uint16".to_owned())?
                            .to_le_bytes(),
                    );
                    output.extend_from_slice(&packet.samples.to_le_bytes());
                    output.extend_from_slice(&packet.bytes);
                }
            }
            AudioItem::Silence {
                timestamp,
                duration,
            } => {
                output.push(1);
                output.extend_from_slice(&[0; 3]);
                output.extend_from_slice(&timestamp.to_le_bytes());
                output.extend_from_slice(&duration.to_le_bytes());
                output.extend_from_slice(&[0; 24]);
            }
        }
    }

    Ok(output)
}

fn decode_subtitle_timeline(file: &V64File) -> Result<Vec<SubtitleChunk>, String> {
    let chunks: Vec<&Chunk> = file
        .chunks
        .iter()
        .filter(|chunk| chunk.chunk_type == "SUBT")
        .collect();
    let feature_declared = file.header.feature_flags & SUBT_FEATURE_FLAG != 0;
    if feature_declared != !chunks.is_empty() {
        return Err("SUBT feature flag and chunk presence disagree".to_owned());
    }
    if chunks.is_empty() {
        return Ok(Vec::new());
    }

    let frame_ticks = u64::from(file.header.cadence.frame_ticks);
    let expected_cells = u32::from(file.header.columns)
        .checked_mul(u32::from(file.header.rows))
        .ok_or_else(|| "SUBT cell count overflow".to_owned())?;
    let mut decoded = Vec::with_capacity(chunks.len());
    for chunk in chunks {
        if chunk.duration == 0
            || chunk.timestamp % frame_ticks != 0
            || chunk.duration % frame_ticks != 0
        {
            return Err("SUBT timestamp and duration must be whole nominal frame spans".to_owned());
        }
        let end = chunk
            .timestamp
            .checked_add(chunk.duration)
            .ok_or_else(|| "SUBT timestamp overflow".to_owned())?;
        if end > file.header.duration_ticks {
            return Err("SUBT chunk exceeds the declared file duration".to_owned());
        }
        let expected_frames = usize::try_from(chunk.duration / frame_ticks)
            .map_err(|_| "SUBT frame count exceeds platform range".to_owned())?;
        let sequence = decode_sm2(
            &chunk.payload,
            SubtitleLimits {
                expected_frames: Some(expected_frames),
                ..SubtitleLimits::default()
            },
        )?;
        if sequence.cell_count != expected_cells {
            return Err("SUBT cell count disagrees with the V64 grid".to_owned());
        }
        if sequence.palette_depth != file.header.palette_depth {
            return Err("SUBT palette depth disagrees with the V64 header".to_owned());
        }
        if u64::try_from(sequence.frames.len()).ok() != Some(chunk.duration / frame_ticks) {
            return Err("SUBT frame count disagrees with chunk duration".to_owned());
        }
        decoded.push(SubtitleChunk {
            timestamp: chunk.timestamp,
            duration: chunk.duration,
            sequence,
        });
    }
    decoded.sort_by_key(|chunk| (chunk.timestamp, chunk.timestamp + chunk.duration));
    let mut previous_end = 0u64;
    for (index, chunk) in decoded.iter().enumerate() {
        if index > 0 && chunk.timestamp < previous_end {
            return Err("SUBT chunks overlap".to_owned());
        }
        previous_end = chunk.timestamp + chunk.duration;
    }
    Ok(decoded)
}

fn decode_audio_timeline(file: &V64File) -> Result<Vec<AudioItem>, String> {
    let chunks: Vec<&Chunk> = file
        .chunks
        .iter()
        .filter(|chunk| chunk.chunk_type == "AURN" || chunk.chunk_type == "SILN")
        .collect();
    let has_runs = chunks.iter().any(|chunk| chunk.chunk_type == "AURN");
    let feature_declared = file.header.feature_flags & AURN_FEATURE_FLAG != 0;
    if feature_declared != has_runs {
        return Err("AURN feature flag and chunk presence disagree".to_owned());
    }
    if !has_runs {
        return Ok(Vec::new());
    }

    let mut timeline = Vec::with_capacity(chunks.len());
    let mut expected_timestamp = 0u64;
    for chunk in chunks {
        if chunk.timestamp != expected_timestamp {
            return Err(format!(
                "Discontinuous audio timeline at {}; expected {expected_timestamp}",
                chunk.timestamp
            ));
        }
        if chunk.duration == 0 {
            return Err(format!("{} audio duration must be nonzero", chunk.chunk_type));
        }
        if chunk.chunk_type == "AURN" {
            timeline.push(AudioItem::Run(decode_aurn_chunk(chunk)?));
        } else {
            if !chunk.payload.is_empty() {
                return Err("SILN payload must be empty".to_owned());
            }
            timeline.push(AudioItem::Silence {
                timestamp: chunk.timestamp,
                duration: chunk.duration,
            });
        }
        expected_timestamp = expected_timestamp
            .checked_add(chunk.duration)
            .ok_or_else(|| "Audio timeline duration overflow".to_owned())?;
    }
    if expected_timestamp != file.header.duration_ticks {
        return Err("Audio timeline does not cover the declared file duration".to_owned());
    }
    Ok(timeline)
}

fn decode_aurn_chunk(chunk: &Chunk) -> Result<AudioRun, String> {
    decode_aurn_payload(
        &chunk.payload,
        chunk.timestamp,
        chunk.duration,
        AudioLimits::default(),
    )
}
