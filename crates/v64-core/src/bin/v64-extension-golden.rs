#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use std::env;
use std::error::Error;
use std::fs;
use v64_core::{Chunk, V64File};

const SUBT_FEATURE_FLAG: u32 = 0x80;
const AURN_FEATURE_FLAG: u32 = 0x40;
const SM2_HEADER_BYTES: usize = 16;
const SM2_MASK_ROWS: usize = 16;
const AURN_HEADER_BYTES: usize = 32;
const AURN_DESCRIPTOR_BYTES: usize = 4;
const AURN_SAMPLE_RATE: u64 = 48_000;
const TICK_RATE: u64 = 60_000;
const MAX_AURN_PACKET_COUNT: usize = 65_535;
const MAX_AURN_PACKET_BYTES: usize = 1_275;

#[derive(Debug, Clone, PartialEq, Eq)]
struct SubtitleEntry {
    cell_index: u32,
    foreground: u8,
    background: u8,
    mask: [u8; SM2_MASK_ROWS],
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SubtitleSequence {
    cell_count: u32,
    palette_depth: u16,
    frames: Vec<Vec<SubtitleEntry>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SubtitleChunk {
    timestamp: u64,
    duration: u64,
    sequence: SubtitleSequence,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AudioPacket {
    samples: u16,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AudioRun {
    timestamp: u64,
    duration: u64,
    pre_skip: u32,
    end_trim: u32,
    kept_samples: u32,
    decoded_samples: u32,
    packet_data_bytes: u32,
    packets: Vec<AudioPacket>,
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
        let sequence = decode_sm2(&chunk.payload)?;
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

fn decode_sm2(bytes: &[u8]) -> Result<SubtitleSequence, String> {
    if bytes.len() < SM2_HEADER_BYTES || bytes.get(0..4) != Some(b"SM2\0") {
        return Err("Invalid SM2 sequence header".to_owned());
    }
    let cell_count = read_u32(bytes, 4)?;
    let frame_count = read_u32(bytes, 8)?;
    let palette_depth = read_u16(bytes, 12)?;
    if cell_count == 0 || frame_count == 0 || !(2..=256).contains(&palette_depth) {
        return Err("Invalid SM2 sequence counts".to_owned());
    }
    if read_u16(bytes, 14)? != 0 {
        return Err("Invalid SM2 reserved field".to_owned());
    }

    let target_frames = usize::try_from(frame_count)
        .map_err(|_| "SM2 frame count exceeds platform range".to_owned())?;
    let mut offset = SM2_HEADER_BYTES;
    let mut frames = Vec::with_capacity(target_frames.min(4096));
    let mut current: BTreeMap<u32, SubtitleEntry> = BTreeMap::new();

    while frames.len() < target_frames {
        let opcode = *bytes
            .get(offset)
            .ok_or_else(|| "Truncated SM2 command stream".to_owned())?;
        offset += 1;
        match opcode {
            0x00 => {
                if frames.is_empty() {
                    return Err("SM2 repeat precedes the first plane".to_owned());
                }
                let span = usize::try_from(read_varuint(bytes, &mut offset)?)
                    .map_err(|_| "Invalid SM2 repeat span".to_owned())?;
                if span == 0 || frames.len().checked_add(span).is_none_or(|end| end > target_frames) {
                    return Err("Invalid SM2 repeat span".to_owned());
                }
                let plane = current.values().cloned().collect::<Vec<_>>();
                for _ in 0..span {
                    frames.push(plane.clone());
                }
            }
            0x01 => {
                let count = read_varuint(bytes, &mut offset)?;
                if count > cell_count {
                    return Err("SM2 full plane exceeds cell count".to_owned());
                }
                let entries = read_sm2_entries(
                    bytes,
                    &mut offset,
                    count,
                    cell_count,
                    palette_depth,
                )?;
                current = entries
                    .iter()
                    .cloned()
                    .map(|entry| (entry.cell_index, entry))
                    .collect();
                frames.push(entries);
            }
            0x02 => {
                if frames.is_empty() {
                    return Err("SM2 delta precedes the first plane".to_owned());
                }
                let removal_count = read_varuint(bytes, &mut offset)?;
                let mut previous = -1i64;
                for _ in 0..removal_count {
                    let delta = read_varuint(bytes, &mut offset)?;
                    if delta == 0 {
                        return Err("SM2 removal made no progress".to_owned());
                    }
                    let cell = previous
                        .checked_add(i64::from(delta))
                        .ok_or_else(|| "Invalid SM2 removal".to_owned())?;
                    let cell = u32::try_from(cell)
                        .map_err(|_| "Invalid SM2 removal".to_owned())?;
                    if cell >= cell_count || current.remove(&cell).is_none() {
                        return Err("Invalid SM2 removal".to_owned());
                    }
                    previous = i64::from(cell);
                }
                let upsert_count = read_varuint(bytes, &mut offset)?;
                let upserts = read_sm2_entries(
                    bytes,
                    &mut offset,
                    upsert_count,
                    cell_count,
                    palette_depth,
                )?;
                for entry in upserts {
                    current.insert(entry.cell_index, entry);
                }
                frames.push(current.values().cloned().collect());
            }
            _ => return Err(format!("Unknown SM2 opcode {opcode}")),
        }
    }

    if offset != bytes.len() {
        return Err("Trailing SM2 sequence bytes".to_owned());
    }
    Ok(SubtitleSequence {
        cell_count,
        palette_depth,
        frames,
    })
}

fn read_sm2_entries(
    bytes: &[u8],
    offset: &mut usize,
    count: u32,
    cell_count: u32,
    palette_depth: u16,
) -> Result<Vec<SubtitleEntry>, String> {
    let count = usize::try_from(count)
        .map_err(|_| "SM2 entry count exceeds platform range".to_owned())?;
    let mut entries = Vec::with_capacity(count.min(4096));
    let mut previous = -1i64;
    for _ in 0..count {
        let delta = read_varuint(bytes, offset)?;
        if delta == 0 {
            return Err("SM2 entry made no progress".to_owned());
        }
        let cell = previous
            .checked_add(i64::from(delta))
            .ok_or_else(|| "Truncated or out-of-bounds SM2 entry".to_owned())?;
        let cell_index = u32::try_from(cell)
            .map_err(|_| "Truncated or out-of-bounds SM2 entry".to_owned())?;
        let end = offset
            .checked_add(18)
            .ok_or_else(|| "Truncated or out-of-bounds SM2 entry".to_owned())?;
        if cell_index >= cell_count || end > bytes.len() {
            return Err("Truncated or out-of-bounds SM2 entry".to_owned());
        }
        let foreground = bytes[*offset];
        let background = bytes[*offset + 1];
        if u16::from(foreground) >= palette_depth || u16::from(background) >= palette_depth {
            return Err("SM2 palette index exceeds active depth".to_owned());
        }
        let mask: [u8; SM2_MASK_ROWS] = bytes[*offset + 2..end]
            .try_into()
            .map_err(|_| "Truncated or out-of-bounds SM2 entry".to_owned())?;
        *offset = end;
        entries.push(SubtitleEntry {
            cell_index,
            foreground,
            background,
            mask,
        });
        previous = i64::from(cell_index);
    }
    Ok(entries)
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
    let payload = &chunk.payload;
    if payload.len() < AURN_HEADER_BYTES {
        return Err("Truncated AURN header".to_owned());
    }
    if payload[0] != 1
        || payload[1] != 1
        || read_u16(payload, 2)? != 0
        || read_u32(payload, 4)? != 48_000
    {
        return Err("Unsupported AURN profile".to_owned());
    }
    let pre_skip = read_u32(payload, 8)?;
    let end_trim = read_u32(payload, 12)?;
    let kept_samples = read_u32(payload, 16)?;
    let decoded_samples = read_u32(payload, 20)?;
    let packet_count = usize::try_from(read_u32(payload, 24)?)
        .map_err(|_| "AURN packet count exceeds platform range".to_owned())?;
    let packet_data_bytes = read_u32(payload, 28)?;
    if kept_samples == 0
        || packet_count == 0
        || packet_count > MAX_AURN_PACKET_COUNT
        || packet_data_bytes == 0
    {
        return Err("Invalid AURN counts".to_owned());
    }
    let descriptor_bytes = packet_count
        .checked_mul(AURN_DESCRIPTOR_BYTES)
        .ok_or_else(|| "AURN payload-length disagreement".to_owned())?;
    let packet_start = AURN_HEADER_BYTES
        .checked_add(descriptor_bytes)
        .ok_or_else(|| "AURN payload-length disagreement".to_owned())?;
    let expected_length = packet_start
        .checked_add(
            usize::try_from(packet_data_bytes)
                .map_err(|_| "AURN payload-length disagreement".to_owned())?,
        )
        .ok_or_else(|| "AURN payload-length disagreement".to_owned())?;
    if expected_length != payload.len() {
        return Err("AURN payload-length disagreement".to_owned());
    }

    let mut packets = Vec::with_capacity(packet_count);
    let mut descriptor_offset = AURN_HEADER_BYTES;
    let mut packet_offset = packet_start;
    let mut inferred_decoded_samples = 0u32;
    for _ in 0..packet_count {
        let length = usize::from(read_u16(payload, descriptor_offset)?);
        let declared_samples = read_u16(payload, descriptor_offset + 2)?;
        if length == 0 || length > MAX_AURN_PACKET_BYTES {
            return Err("Invalid AURN packet length".to_owned());
        }
        let end = packet_offset
            .checked_add(length)
            .ok_or_else(|| "Invalid AURN packet length".to_owned())?;
        let packet = payload
            .get(packet_offset..end)
            .ok_or_else(|| "Invalid AURN packet length".to_owned())?;
        let inferred_samples = opus_packet_samples(packet)?;
        if declared_samples != inferred_samples {
            return Err("AURN packet duration disagrees with the Opus TOC".to_owned());
        }
        inferred_decoded_samples = inferred_decoded_samples
            .checked_add(u32::from(inferred_samples))
            .ok_or_else(|| "AURN decoded-sample total mismatch".to_owned())?;
        packets.push(AudioPacket {
            samples: inferred_samples,
            bytes: packet.to_vec(),
        });
        descriptor_offset += AURN_DESCRIPTOR_BYTES;
        packet_offset = end;
    }
    if packet_offset != payload.len() || inferred_decoded_samples != decoded_samples {
        return Err("AURN decoded-sample total mismatch".to_owned());
    }
    if pre_skip
        .checked_add(kept_samples)
        .and_then(|value| value.checked_add(end_trim))
        != Some(decoded_samples)
    {
        return Err("AURN trim and kept-sample accounting mismatch".to_owned());
    }
    let expected_duration = samples_to_ticks(kept_samples)?;
    if chunk.duration != expected_duration {
        return Err("AURN chunk duration disagrees with kept samples".to_owned());
    }
    ticks_to_samples(chunk.timestamp)?;

    Ok(AudioRun {
        timestamp: chunk.timestamp,
        duration: chunk.duration,
        pre_skip,
        end_trim,
        kept_samples,
        decoded_samples,
        packet_data_bytes,
        packets,
    })
}

fn opus_packet_samples(packet: &[u8]) -> Result<u16, String> {
    let toc = *packet.first().ok_or_else(|| "Empty Opus packet".to_owned())?;
    let config = toc >> 3;
    let samples_per_frame = if config < 12 {
        [480u16, 960, 1920, 2880][usize::from(config & 3)]
    } else if config < 16 {
        [480u16, 960][usize::from(config & 1)]
    } else {
        [120u16, 240, 480, 960][usize::from(config & 3)]
    };
    let code = toc & 3;
    let frames = match code {
        0 => 1u16,
        1 | 2 => 2u16,
        _ => u16::from(
            *packet
                .get(1)
                .ok_or_else(|| "Truncated Opus frame-count byte".to_owned())?
                & 0x3f,
        ),
    };
    let total = frames
        .checked_mul(samples_per_frame)
        .ok_or_else(|| "Invalid Opus packet duration".to_owned())?;
    if frames == 0 || total > 5_760 {
        return Err("Invalid Opus packet duration".to_owned());
    }
    Ok(total)
}

fn samples_to_ticks(samples: u32) -> Result<u64, String> {
    let numerator = u64::from(samples)
        .checked_mul(TICK_RATE)
        .ok_or_else(|| "AURN sample count is not exactly representable on the V64 timeline".to_owned())?;
    if numerator % AURN_SAMPLE_RATE != 0 {
        return Err("AURN sample count is not exactly representable on the V64 timeline".to_owned());
    }
    Ok(numerator / AURN_SAMPLE_RATE)
}

fn ticks_to_samples(ticks: u64) -> Result<u64, String> {
    let numerator = ticks
        .checked_mul(AURN_SAMPLE_RATE)
        .ok_or_else(|| "AURN timestamp is not aligned to a 48 kHz sample boundary".to_owned())?;
    if numerator % TICK_RATE != 0 {
        return Err("AURN timestamp is not aligned to a 48 kHz sample boundary".to_owned());
    }
    Ok(numerator / TICK_RATE)
}

fn read_varuint(bytes: &[u8], offset: &mut usize) -> Result<u32, String> {
    let mut value = 0u64;
    let mut multiplier = 1u64;
    for _ in 0..5 {
        let byte = *bytes
            .get(*offset)
            .ok_or_else(|| "Truncated SM2 varuint".to_owned())?;
        *offset += 1;
        value = value
            .checked_add(u64::from(byte & 0x7f) * multiplier)
            .ok_or_else(|| "Oversized SM2 varuint".to_owned())?;
        if byte & 0x80 == 0 {
            return u32::try_from(value).map_err(|_| "Oversized SM2 varuint".to_owned());
        }
        multiplier = multiplier
            .checked_mul(128)
            .ok_or_else(|| "SM2 varuint exceeds five bytes".to_owned())?;
    }
    Err("SM2 varuint exceeds five bytes".to_owned())
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| "Truncated integer field".to_owned())?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "Truncated integer field".to_owned())?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_sm2_full_and_repeat_planes() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"SM2\0");
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&[0x01, 0x01, 0x01, 0x01, 0x00]);
        bytes.extend_from_slice(&[0xaa; 16]);
        bytes.extend_from_slice(&[0x00, 0x01]);
        let sequence = decode_sm2(&bytes).expect("SM2 should decode");
        assert_eq!(sequence.frames.len(), 2);
        assert_eq!(sequence.frames[0], sequence.frames[1]);
        assert_eq!(sequence.frames[0][0].cell_index, 0);
    }

    #[test]
    fn infers_opus_packet_duration_from_toc() {
        assert_eq!(opus_packet_samples(&[0x00]).unwrap(), 480);
        assert_eq!(opus_packet_samples(&[0x01]).unwrap(), 960);
        assert!(opus_packet_samples(&[0x03]).is_err());
    }

    #[test]
    fn converts_exact_sample_and_tick_boundaries() {
        assert_eq!(samples_to_ticks(480).unwrap(), 600);
        assert_eq!(ticks_to_samples(600).unwrap(), 480);
        assert!(samples_to_ticks(1).is_err());
        assert!(ticks_to_samples(1).is_err());
    }
}
