#![forbid(unsafe_code)]

use std::env;
use std::error::Error;
use std::fs;
use std::path::Path;
use v64_core::V64File;

const END: u8 = 0;
const SKIP: u8 = 1;
const LITERAL: u8 = 2;
const REPEAT_TOKEN: u8 = 3;
const FILL_RECT: u8 = 4;
const DEFINE_TOKEN_DICTIONARY: u8 = 5;
const DICTIONARY_LITERAL: u8 = 6;
const MAX_DICTIONARY_ENTRIES: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
struct VideoFrame {
    timestamp: u64,
    duration: u64,
    keyframe: bool,
    repeat: bool,
    state: Vec<u8>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args_os().skip(1);
    let input = arguments.next().ok_or("missing INPUT.v64")?;
    let output = arguments.next().ok_or("missing OUTPUT.bin")?;
    if arguments.next().is_some() {
        return Err("usage: v64-golden-stream INPUT.v64 OUTPUT.bin".into());
    }
    let bytes = fs::read(&input)?;
    let file = v64_core::parse(&bytes)?;
    let timeline = decode_video_timeline(&file)?;
    fs::write(output, encode_golden_stream(&file, &timeline)?)?;
    Ok(())
}

fn decode_video_timeline(file: &V64File) -> Result<Vec<VideoFrame>, String> {
    let columns = usize::from(file.header.columns);
    let rows = usize::from(file.header.rows);
    let palette_depth = usize::from(file.header.palette_depth);
    let frame_ticks = u64::from(file.header.cadence.frame_ticks);
    let mut timeline = Vec::new();
    let mut state: Option<Vec<u8>> = None;
    let mut expected_timestamp = 0u64;

    for chunk in &file.chunks {
        if chunk.chunk_type != "VFRM" && chunk.chunk_type != "RPTF" {
            continue;
        }
        if chunk.timestamp != expected_timestamp {
            return Err(format!(
                "Discontinuous video timeline at {}; expected {expected_timestamp}",
                chunk.timestamp
            ));
        }
        if chunk.duration == 0 || chunk.duration % frame_ticks != 0 {
            return Err(format!(
                "{} duration is not a whole nominal frame span",
                chunk.chunk_type
            ));
        }

        if chunk.chunk_type == "VFRM" {
            let kind = chunk
                .payload
                .first()
                .copied()
                .ok_or_else(|| "Invalid VFRM kind".to_owned())?;
            if kind > 1 {
                return Err("Invalid VFRM kind".to_owned());
            }
            let keyframe = kind == 0;
            let decoded = apply_frame_commands(
                &chunk.payload[1..],
                state.as_deref(),
                columns,
                rows,
                palette_depth,
                keyframe,
            )?;
            timeline.push(VideoFrame {
                timestamp: chunk.timestamp,
                duration: chunk.duration,
                keyframe,
                repeat: false,
                state: decoded.clone(),
            });
            state = Some(decoded);
        } else {
            if !chunk.payload.is_empty() {
                return Err("RPTF payload must be empty".to_owned());
            }
            let prior = state
                .as_ref()
                .ok_or_else(|| "Repeat frame precedes first video frame".to_owned())?;
            timeline.push(VideoFrame {
                timestamp: chunk.timestamp,
                duration: chunk.duration,
                keyframe: false,
                repeat: true,
                state: prior.clone(),
            });
        }
        expected_timestamp = expected_timestamp
            .checked_add(chunk.duration)
            .ok_or_else(|| "Video timeline duration overflow".to_owned())?;
    }

    if timeline.is_empty() {
        return Err("File contains no video timeline".to_owned());
    }
    if expected_timestamp > file.header.duration_ticks {
        return Err("Video timeline exceeds declared duration".to_owned());
    }
    Ok(timeline)
}

fn apply_frame_commands(
    command_bytes: &[u8],
    prior: Option<&[u8]>,
    columns: usize,
    rows: usize,
    palette_depth: usize,
    keyframe: bool,
) -> Result<Vec<u8>, String> {
    let cell_count = columns
        .checked_mul(rows)
        .ok_or_else(|| "Cell count overflow".to_owned())?;
    let state_length = cell_count
        .checked_mul(3)
        .ok_or_else(|| "Cell-state length overflow".to_owned())?;
    let mut state = if keyframe {
        vec![0; state_length]
    } else {
        let prior = prior.ok_or_else(|| "Delta frame has no valid prior state".to_owned())?;
        if prior.len() != state_length {
            return Err("Delta frame has no valid prior state".to_owned());
        }
        prior.to_vec()
    };
    let mut touched = keyframe.then(|| vec![false; cell_count]);
    let mut cursor = 0usize;
    let mut offset = 0usize;
    let mut dictionary: Option<Vec<[u8; 3]>> = None;
    let mut ended = false;
    let command_limit = cell_count
        .checked_mul(2)
        .and_then(|value| value.checked_add(1))
        .ok_or_else(|| "Frame command-count overflow".to_owned())?;
    let mut command_count = 0usize;

    while offset < command_bytes.len() {
        command_count += 1;
        if command_count > command_limit {
            return Err("Frame command count exceeds bound".to_owned());
        }
        let opcode = command_bytes[offset];
        offset += 1;
        if opcode == END {
            ended = true;
            break;
        }

        match opcode {
            SKIP => {
                let count = read_varuint(command_bytes, &mut offset)?;
                let count = usize::try_from(count)
                    .map_err(|_| "Invalid skip run".to_owned())?;
                if count == 0 || cursor.checked_add(count).is_none_or(|end| end > cell_count) {
                    return Err("Invalid skip run".to_owned());
                }
                cursor += count;
            }
            LITERAL => {
                let count = read_varuint(command_bytes, &mut offset)?;
                let count = usize::try_from(count)
                    .map_err(|_| "Invalid literal run".to_owned())?;
                if count == 0 || cursor.checked_add(count).is_none_or(|end| end > cell_count) {
                    return Err("Invalid literal run".to_owned());
                }
                for _ in 0..count {
                    let token = read_token(command_bytes, &mut offset, palette_depth)?;
                    write_sequential(&mut state, touched.as_mut(), &mut cursor, cell_count, token)?;
                }
            }
            REPEAT_TOKEN => {
                let count = read_varuint(command_bytes, &mut offset)?;
                let count = usize::try_from(count)
                    .map_err(|_| "Invalid repeated-token run".to_owned())?;
                if count == 0 || cursor.checked_add(count).is_none_or(|end| end > cell_count) {
                    return Err("Invalid repeated-token run".to_owned());
                }
                let token = read_token(command_bytes, &mut offset, palette_depth)?;
                for _ in 0..count {
                    write_sequential(&mut state, touched.as_mut(), &mut cursor, cell_count, token)?;
                }
            }
            FILL_RECT => {
                let x = usize::try_from(read_varuint(command_bytes, &mut offset)?)
                    .map_err(|_| "Rectangle lies outside frame".to_owned())?;
                let y = usize::try_from(read_varuint(command_bytes, &mut offset)?)
                    .map_err(|_| "Rectangle lies outside frame".to_owned())?;
                let width = usize::try_from(read_varuint(command_bytes, &mut offset)?)
                    .map_err(|_| "Rectangle lies outside frame".to_owned())?;
                let height = usize::try_from(read_varuint(command_bytes, &mut offset)?)
                    .map_err(|_| "Rectangle lies outside frame".to_owned())?;
                if width == 0
                    || height == 0
                    || x.checked_add(width).is_none_or(|right| right > columns)
                    || y.checked_add(height).is_none_or(|bottom| bottom > rows)
                {
                    return Err("Rectangle lies outside frame".to_owned());
                }
                let token = read_token(command_bytes, &mut offset, palette_depth)?;
                for py in y..y + height {
                    for px in x..x + width {
                        let cell = py * columns + px;
                        write_cell(&mut state, touched.as_mut(), cell, token);
                    }
                }
            }
            DEFINE_TOKEN_DICTIONARY => {
                let count = usize::try_from(read_varuint(command_bytes, &mut offset)?)
                    .map_err(|_| "Invalid token dictionary length".to_owned())?;
                if count == 0 || count > MAX_DICTIONARY_ENTRIES {
                    return Err("Invalid token dictionary length".to_owned());
                }
                let mut entries = Vec::with_capacity(count);
                for _ in 0..count {
                    entries.push(read_token(command_bytes, &mut offset, palette_depth)?);
                }
                dictionary = Some(entries);
            }
            DICTIONARY_LITERAL => {
                let entries = dictionary
                    .as_ref()
                    .ok_or_else(|| "Dictionary literal precedes dictionary definition".to_owned())?;
                let count = usize::try_from(read_varuint(command_bytes, &mut offset)?)
                    .map_err(|_| "Invalid dictionary literal".to_owned())?;
                if count == 0
                    || cursor.checked_add(count).is_none_or(|end| end > cell_count)
                    || offset.checked_add(count).is_none_or(|end| end > command_bytes.len())
                {
                    return Err("Invalid dictionary literal".to_owned());
                }
                for _ in 0..count {
                    let dictionary_id = usize::from(command_bytes[offset]);
                    offset += 1;
                    let token = entries
                        .get(dictionary_id)
                        .copied()
                        .ok_or_else(|| "Dictionary index out of range".to_owned())?;
                    write_sequential(&mut state, touched.as_mut(), &mut cursor, cell_count, token)?;
                }
            }
            _ => {
                return Err(format!("Unknown mandatory frame opcode 0x{opcode:02x}"));
            }
        }
    }

    if !ended {
        return Err("Frame command stream has no END".to_owned());
    }
    if offset != command_bytes.len() {
        return Err("Trailing bytes after frame END".to_owned());
    }
    if touched
        .as_ref()
        .is_some_and(|cells| cells.iter().any(|touched| !touched))
    {
        return Err("Keyframe does not define every cell".to_owned());
    }
    Ok(state)
}

fn read_varuint(bytes: &[u8], offset: &mut usize) -> Result<u32, String> {
    let start = *offset;
    let mut value = 0u32;
    let mut shift = 0u32;
    for index in 0..5usize {
        let byte = bytes
            .get(*offset)
            .copied()
            .ok_or_else(|| "Truncated varuint".to_owned())?;
        *offset += 1;
        if index == 4 && byte & 0xf0 != 0 {
            return Err("Varuint exceeds uint32".to_owned());
        }
        value |= u32::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            let encoded_length = if value < (1 << 7) {
                1
            } else if value < (1 << 14) {
                2
            } else if value < (1 << 21) {
                3
            } else if value < (1 << 28) {
                4
            } else {
                5
            };
            if *offset - start != encoded_length {
                return Err("Non-canonical varuint".to_owned());
            }
            return Ok(value);
        }
        shift += 7;
    }
    Err("Varuint exceeds five bytes".to_owned())
}

fn read_token(bytes: &[u8], offset: &mut usize, palette_depth: usize) -> Result<[u8; 3], String> {
    let end = offset
        .checked_add(3)
        .ok_or_else(|| "Truncated cell token".to_owned())?;
    let token: [u8; 3] = bytes
        .get(*offset..end)
        .ok_or_else(|| "Truncated cell token".to_owned())?
        .try_into()
        .map_err(|_| "Truncated cell token".to_owned())?;
    if token[0] >= 64 {
        return Err(format!("Glyph index {} exceeds canonical set", token[0]));
    }
    if usize::from(token[1]) >= palette_depth || usize::from(token[2]) >= palette_depth {
        return Err("Palette index exceeds declared depth".to_owned());
    }
    *offset = end;
    Ok(token)
}

fn write_sequential(
    state: &mut [u8],
    touched: Option<&mut Vec<bool>>,
    cursor: &mut usize,
    cell_count: usize,
    token: [u8; 3],
) -> Result<(), String> {
    if *cursor >= cell_count {
        return Err("Frame command advances beyond grid".to_owned());
    }
    write_cell(state, touched, *cursor, token);
    *cursor += 1;
    Ok(())
}

fn write_cell(state: &mut [u8], touched: Option<&mut Vec<bool>>, cell: usize, token: [u8; 3]) {
    let offset = cell * 3;
    state[offset..offset + 3].copy_from_slice(&token);
    if let Some(touched) = touched {
        touched[cell] = true;
    }
}

fn encode_golden_stream(file: &V64File, timeline: &[VideoFrame]) -> Result<Vec<u8>, String> {
    let frame_count = u32::try_from(timeline.len())
        .map_err(|_| "Golden frame count exceeds uint32".to_owned())?;
    let mut output = Vec::new();
    output.extend_from_slice(b"V64GOLD1");
    output.extend_from_slice(&file.header.columns.to_le_bytes());
    output.extend_from_slice(&file.header.rows.to_le_bytes());
    output.extend_from_slice(&frame_count.to_le_bytes());
    for frame in timeline {
        output.extend_from_slice(&frame.timestamp.to_le_bytes());
        output.extend_from_slice(&frame.duration.to_le_bytes());
        output.push(u8::from(frame.keyframe));
        output.push(u8::from(frame.repeat));
        output.extend_from_slice(&0u16.to_le_bytes());
        let state_length = u32::try_from(frame.state.len())
            .map_err(|_| "Golden state length exceeds uint32".to_owned())?;
        output.extend_from_slice(&state_length.to_le_bytes());
        output.extend_from_slice(&frame.state);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROCEDURAL: &[u8] = include_bytes!("../../../../tests/golden/procedural.v64");

    #[test]
    fn decodes_the_phase1_golden_timeline() {
        let file = v64_core::parse(PROCEDURAL).expect("container should parse");
        let timeline = decode_video_timeline(&file).expect("video timeline should decode");
        assert!(!timeline.is_empty());
        assert!(timeline[0].keyframe);
        assert_eq!(
            timeline[0].state.len(),
            usize::from(file.header.columns) * usize::from(file.header.rows) * 3
        );
        assert_eq!(
            timeline.last().unwrap().timestamp + timeline.last().unwrap().duration,
            file.header.duration_ticks
        );
    }

    #[test]
    fn rejects_noncanonical_and_trailing_commands_transactionally() {
        let prior = vec![7u8; 6];
        let snapshot = prior.clone();
        let error = apply_frame_commands(&[SKIP, 0x81, 0x00, END], Some(&prior), 2, 1, 16, false)
            .expect_err("noncanonical varuint must fail");
        assert!(error.contains("Non-canonical"));
        assert_eq!(prior, snapshot);

        let error = apply_frame_commands(&[END, 0], None, 1, 1, 16, true)
            .expect_err("trailing bytes must fail");
        assert!(error.contains("Trailing bytes"));
    }

    #[test]
    fn golden_stream_has_stable_framing() {
        let file = v64_core::parse(PROCEDURAL).expect("container should parse");
        let timeline = decode_video_timeline(&file).expect("video timeline should decode");
        let stream = encode_golden_stream(&file, &timeline).expect("stream should encode");
        assert_eq!(&stream[..8], b"V64GOLD1");
        assert!(stream.len() > 16);
    }

    #[test]
    fn output_path_is_not_required_to_exist_before_encoding() {
        let path = Path::new("target/test-golden-stream.bin");
        let file = v64_core::parse(PROCEDURAL).expect("container should parse");
        let timeline = decode_video_timeline(&file).expect("video timeline should decode");
        let stream = encode_golden_stream(&file, &timeline).expect("stream should encode");
        assert!(!stream.is_empty());
        let _ = path;
    }
}
