#![forbid(unsafe_code)]

use std::env;
use std::error::Error;
use std::fs;

const END: u8 = 0;
const SKIP: u8 = 1;
const LITERAL: u8 = 2;
const REPEAT_TOKEN: u8 = 3;
const SET_GLYPH: u8 = 4;
const SET_FOREGROUND: u8 = 5;
const SET_BACKGROUND: u8 = 6;
const SET_COLOR_PAIR: u8 = 7;
const REPEAT_GLYPH: u8 = 8;
const REPEAT_FOREGROUND: u8 = 9;
const REPEAT_BACKGROUND: u8 = 10;
const REPEAT_COLOR_PAIR: u8 = 11;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Frame {
    timestamp: u64,
    duration: u64,
    keyframe: bool,
    repeat: bool,
    state: Vec<u8>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args_os().skip(1);
    let input = arguments.next().ok_or("missing INPUT.bin")?;
    let output = arguments.next().ok_or("missing OUTPUT.bin")?;
    if arguments.next().is_some() {
        return Err("usage: v64-grammar-b-golden INPUT.bin OUTPUT.bin".into());
    }
    let bytes = fs::read(input)?;
    let (columns, rows, frames) = decode_fixture(&bytes)?;
    fs::write(output, encode_golden_stream(columns, rows, &frames)?)?;
    Ok(())
}

fn decode_fixture(input: &[u8]) -> Result<(u16, u16, Vec<Frame>), String> {
    if input.len() < 20 || input.get(..8) != Some(b"V64GBD1\0") {
        return Err("Grammar B fixture magic mismatch".to_owned());
    }
    let columns = read_u16(input, 8)?;
    let rows = read_u16(input, 10)?;
    let palette_depth = usize::from(read_u16(input, 12)?);
    if columns == 0 || rows == 0 || palette_depth < 2 || palette_depth > 256 {
        return Err("Invalid Grammar B fixture dimensions".to_owned());
    }
    if read_u16(input, 14)? != 0 {
        return Err("Nonzero Grammar B fixture reserved field".to_owned());
    }
    let frame_count = usize::try_from(read_u32(input, 16)?)
        .map_err(|_| "Grammar B fixture frame count exceeds platform range".to_owned())?;
    let mut offset = 20usize;
    let mut prior: Option<Vec<u8>> = None;
    let mut frames = Vec::with_capacity(frame_count.min(4096));

    for _ in 0..frame_count {
        let record_end = offset
            .checked_add(24)
            .ok_or_else(|| "Grammar B fixture record overflow".to_owned())?;
        if record_end > input.len() {
            return Err("Truncated Grammar B fixture record".to_owned());
        }
        let timestamp = read_u64(input, offset)?;
        let duration = read_u64(input, offset + 8)?;
        let flags = input[offset + 16];
        if flags & !3 != 0 {
            return Err("Unknown Grammar B fixture flags".to_owned());
        }
        if input[offset + 17..offset + 20].iter().any(|byte| *byte != 0) {
            return Err("Nonzero Grammar B record reserved field".to_owned());
        }
        let command_length = usize::try_from(read_u32(input, offset + 20)?)
            .map_err(|_| "Grammar B command length exceeds platform range".to_owned())?;
        offset = record_end;
        let command_end = offset
            .checked_add(command_length)
            .ok_or_else(|| "Grammar B command range overflow".to_owned())?;
        let commands = input
            .get(offset..command_end)
            .ok_or_else(|| "Truncated Grammar B command stream".to_owned())?;
        offset = command_end;

        let keyframe = flags & 1 != 0;
        let repeat = flags & 2 != 0;
        let state = if repeat {
            if keyframe || command_length != 0 {
                return Err("Invalid Grammar B repeat record".to_owned());
            }
            prior
                .as_ref()
                .cloned()
                .ok_or_else(|| "Invalid Grammar B repeat record".to_owned())?
        } else {
            apply_packed_commands(
                commands,
                prior.as_deref(),
                usize::from(columns),
                usize::from(rows),
                palette_depth,
                keyframe,
            )?
        };
        prior = Some(state.clone());
        frames.push(Frame {
            timestamp,
            duration,
            keyframe,
            repeat,
            state,
        });
    }
    if offset != input.len() {
        return Err("Trailing Grammar B fixture bytes".to_owned());
    }
    Ok((columns, rows, frames))
}

fn apply_packed_commands(
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
    let palette_bits = palette_index_bits(palette_depth)?;
    let token_bits = 6usize + 2 * palette_bits;
    let command_limit = cell_count
        .checked_mul(2)
        .and_then(|value| value.checked_add(1))
        .ok_or_else(|| "Frame command-count overflow".to_owned())?;
    let mut command_count = 0usize;
    let mut offset = 0usize;
    let mut cursor = 0usize;
    let mut ended = false;

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

        if opcode == SKIP {
            let count = usize::try_from(read_varuint(command_bytes, &mut offset)?)
                .map_err(|_| "Packed skip advances beyond grid".to_owned())?;
            require_progress(cursor, count, cell_count, "Packed skip advances beyond grid")?;
            cursor += count;
            continue;
        }

        if opcode == LITERAL {
            let count = usize::try_from(read_varuint(command_bytes, &mut offset)?)
                .map_err(|_| "Packed token command advances beyond grid".to_owned())?;
            require_progress(cursor, count, cell_count, "Packed token command advances beyond grid")?;
            let used_bits = count
                .checked_mul(token_bits)
                .ok_or_else(|| "Packed literal is too large".to_owned())?;
            let payload = read_packed_payload(command_bytes, &mut offset, used_bits)?;
            let mut bit = 0usize;
            for index in 0..count {
                let glyph = read_packed_value(payload, bit, 6);
                bit += 6;
                let foreground = read_packed_value(payload, bit, palette_bits);
                bit += palette_bits;
                let background = read_packed_value(payload, bit, palette_bits);
                bit += palette_bits;
                validate_token(glyph, foreground, background, palette_depth)?;
                write_token(
                    &mut state,
                    cursor + index,
                    glyph,
                    foreground,
                    background,
                )?;
            }
            require_zero_padding(payload, used_bits)?;
            cursor += count;
            continue;
        }

        if opcode == REPEAT_TOKEN {
            let count = usize::try_from(read_varuint(command_bytes, &mut offset)?)
                .map_err(|_| "Packed token command advances beyond grid".to_owned())?;
            require_progress(cursor, count, cell_count, "Packed token command advances beyond grid")?;
            let payload = read_packed_payload(command_bytes, &mut offset, token_bits)?;
            let glyph = read_packed_value(payload, 0, 6);
            let foreground = read_packed_value(payload, 6, palette_bits);
            let background = read_packed_value(payload, 6 + palette_bits, palette_bits);
            validate_token(glyph, foreground, background, palette_depth)?;
            require_zero_padding(payload, token_bits)?;
            for index in 0..count {
                write_token(
                    &mut state,
                    cursor + index,
                    glyph,
                    foreground,
                    background,
                )?;
            }
            cursor += count;
            continue;
        }

        let repeating = matches!(
            opcode,
            REPEAT_GLYPH | REPEAT_FOREGROUND | REPEAT_BACKGROUND | REPEAT_COLOR_PAIR
        );
        let count = if repeating {
            usize::try_from(read_varuint(command_bytes, &mut offset)?)
                .map_err(|_| "Packed component command advances beyond grid".to_owned())?
        } else {
            1
        };
        require_progress(
            cursor,
            count,
            cell_count,
            "Packed component command advances beyond grid",
        )?;

        let glyph_component = matches!(opcode, SET_GLYPH | REPEAT_GLYPH);
        let pair_component = matches!(opcode, SET_COLOR_PAIR | REPEAT_COLOR_PAIR);
        if !matches!(
            opcode,
            SET_GLYPH
                | SET_FOREGROUND
                | SET_BACKGROUND
                | SET_COLOR_PAIR
                | REPEAT_GLYPH
                | REPEAT_FOREGROUND
                | REPEAT_BACKGROUND
                | REPEAT_COLOR_PAIR
        ) {
            return Err(format!("Unknown mandatory packed opcode 0x{opcode:02x}"));
        }
        let used_bits = if glyph_component {
            6
        } else if pair_component {
            2 * palette_bits
        } else {
            palette_bits
        };
        let payload = read_packed_payload(command_bytes, &mut offset, used_bits)?;
        let first_width = if glyph_component { 6 } else { palette_bits };
        let first = read_packed_value(payload, 0, first_width);
        let second = pair_component.then(|| read_packed_value(payload, palette_bits, palette_bits));
        require_zero_padding(payload, used_bits)?;
        if glyph_component {
            if first >= 64 {
                return Err("Glyph index exceeds canonical set".to_owned());
            }
        } else if first >= palette_depth || second.is_some_and(|value| value >= palette_depth) {
            return Err("Palette index exceeds declared depth".to_owned());
        }

        for index in 0..count {
            let target = (cursor + index)
                .checked_mul(3)
                .ok_or_else(|| "Cell offset overflow".to_owned())?;
            match opcode {
                SET_GLYPH | REPEAT_GLYPH => state[target] = u8::try_from(first).unwrap(),
                SET_FOREGROUND | REPEAT_FOREGROUND => {
                    state[target + 1] = u8::try_from(first).unwrap();
                }
                SET_BACKGROUND | REPEAT_BACKGROUND => {
                    state[target + 2] = u8::try_from(first).unwrap();
                }
                SET_COLOR_PAIR | REPEAT_COLOR_PAIR => {
                    state[target + 1] = u8::try_from(first).unwrap();
                    state[target + 2] = u8::try_from(second.unwrap()).unwrap();
                }
                _ => unreachable!(),
            }
        }
        cursor += count;
    }

    if !ended {
        return Err("Packed command stream has no END".to_owned());
    }
    if offset != command_bytes.len() {
        return Err("Trailing bytes after packed frame END".to_owned());
    }
    Ok(state)
}

fn palette_index_bits(palette_depth: usize) -> Result<usize, String> {
    if !(2..=256).contains(&palette_depth) {
        return Err("Palette depth must be an integer from 2 through 256".to_owned());
    }
    Ok(usize::BITS as usize - (palette_depth - 1).leading_zeros() as usize)
}

fn require_progress(cursor: usize, count: usize, cell_count: usize, message: &str) -> Result<(), String> {
    if count == 0 || cursor.checked_add(count).is_none_or(|end| end > cell_count) {
        return Err(message.to_owned());
    }
    Ok(())
}

fn read_packed_payload<'a>(
    bytes: &'a [u8],
    offset: &mut usize,
    used_bits: usize,
) -> Result<&'a [u8], String> {
    let byte_length = used_bits
        .checked_add(7)
        .ok_or_else(|| "Packed command payload overflow".to_owned())?
        / 8;
    let end = offset
        .checked_add(byte_length)
        .ok_or_else(|| "Packed command payload overflow".to_owned())?;
    let payload = bytes
        .get(*offset..end)
        .ok_or_else(|| "Truncated packed command payload".to_owned())?;
    *offset = end;
    Ok(payload)
}

fn read_packed_value(bytes: &[u8], bit_start: usize, width: usize) -> usize {
    let mut value = 0usize;
    for bit in 0..width {
        let absolute_bit = bit_start + bit;
        if bytes[absolute_bit >> 3] & (1 << (absolute_bit & 7)) != 0 {
            value |= 1usize << bit;
        }
    }
    value
}

fn require_zero_padding(bytes: &[u8], used_bits: usize) -> Result<(), String> {
    for bit in used_bits..bytes.len() * 8 {
        if bytes[bit >> 3] & (1 << (bit & 7)) != 0 {
            return Err("Nonzero packed padding bits".to_owned());
        }
    }
    Ok(())
}

fn validate_token(
    glyph: usize,
    foreground: usize,
    background: usize,
    palette_depth: usize,
) -> Result<(), String> {
    if glyph >= 64 {
        return Err("Glyph index exceeds canonical set".to_owned());
    }
    if foreground >= palette_depth || background >= palette_depth {
        return Err("Palette index exceeds declared depth".to_owned());
    }
    Ok(())
}

fn write_token(
    state: &mut [u8],
    cell: usize,
    glyph: usize,
    foreground: usize,
    background: usize,
) -> Result<(), String> {
    let target = cell
        .checked_mul(3)
        .ok_or_else(|| "Cell offset overflow".to_owned())?;
    state[target] = u8::try_from(glyph).map_err(|_| "Glyph conversion overflow".to_owned())?;
    state[target + 1] =
        u8::try_from(foreground).map_err(|_| "Palette conversion overflow".to_owned())?;
    state[target + 2] =
        u8::try_from(background).map_err(|_| "Palette conversion overflow".to_owned())?;
    Ok(())
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
            if value == 0 {
                return Err("Zero-progress command".to_owned());
            }
            return Ok(value);
        }
        shift += 7;
    }
    Err("Varuint exceeds five bytes".to_owned())
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| "Truncated Grammar B fixture integer".to_owned())?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "Truncated Grammar B fixture integer".to_owned())?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, String> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| "Truncated Grammar B fixture integer".to_owned())?;
    Ok(u64::from_le_bytes([
        value[0], value[1], value[2], value[3], value[4], value[5], value[6], value[7],
    ]))
}

fn encode_golden_stream(columns: u16, rows: u16, frames: &[Frame]) -> Result<Vec<u8>, String> {
    let frame_count = u32::try_from(frames.len())
        .map_err(|_| "Golden frame count exceeds uint32".to_owned())?;
    let mut output = Vec::new();
    output.extend_from_slice(b"V64GOLD1");
    output.extend_from_slice(&columns.to_le_bytes());
    output.extend_from_slice(&rows.to_le_bytes());
    output.extend_from_slice(&frame_count.to_le_bytes());
    for frame in frames {
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

    #[test]
    fn direct_decoder_handles_component_updates() {
        let prior = vec![1, 2, 3, 4, 5, 6];
        let commands = [SET_GLYPH, 7, SET_COLOR_PAIR, 8, 9, END];
        let state = apply_packed_commands(&commands, Some(&prior), 2, 1, 16, false)
            .expect("component updates should decode");
        assert_eq!(state, vec![7, 2, 3, 4, 8, 9]);
    }

    #[test]
    fn direct_decoder_rejects_padding_and_trailing_bytes() {
        let error = apply_packed_commands(&[SET_GLYPH, 0x40, END], Some(&[0, 0, 0]), 1, 1, 16, false)
            .expect_err("padding must be zero");
        assert!(error.contains("padding"));

        let error = apply_packed_commands(&[END, 0], None, 1, 1, 16, true)
            .expect_err("trailing bytes must fail");
        assert!(error.contains("Trailing bytes"));
    }
}
