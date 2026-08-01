#![forbid(unsafe_code)]

use std::env;
use std::error::Error;
use std::fs;
use v64_core::grammar_b::apply_packed_commands;

#[cfg(test)]
use v64_core::grammar_b::{END, SET_COLOR_PAIR, SET_GLYPH};

type DecodeResult<T> = Result<T, String>;

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
    let input = fs::read(input)?;
    let (columns, rows, frames) = decode_fixture(&input)?;
    fs::write(output, encode_golden_stream(columns, rows, &frames)?)?;
    Ok(())
}

fn decode_fixture(input: &[u8]) -> DecodeResult<(u16, u16, Vec<Frame>)> {
    if input.len() < 20 || input.get(..8) != Some(b"V64GBD1\0") {
        return Err("Grammar B fixture magic mismatch".to_owned());
    }
    let columns = read_u16(input, 8)?;
    let rows = read_u16(input, 10)?;
    let palette_depth = usize::from(read_u16(input, 12)?);
    if columns == 0 || rows == 0 || !(2..=256).contains(&palette_depth) {
        return Err("Invalid Grammar B fixture dimensions".to_owned());
    }
    if read_u16(input, 14)? != 0 {
        return Err("Nonzero Grammar B fixture reserved field".to_owned());
    }
    let count = usize::try_from(read_u32(input, 16)?)
        .map_err(|_| "Grammar B frame count exceeds platform range".to_owned())?;
    let mut offset = 20usize;
    let mut prior: Option<Vec<u8>> = None;
    let mut frames = Vec::with_capacity(count.min(4096));

    for _ in 0..count {
        let record_end = offset
            .checked_add(24)
            .ok_or_else(|| "Grammar B record range overflow".to_owned())?;
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
            if keyframe || !commands.is_empty() {
                return Err("Invalid Grammar B repeat record".to_owned());
            }
            prior
                .clone()
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

fn read_u16(bytes: &[u8], offset: usize) -> DecodeResult<u16> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| "Truncated Grammar B fixture integer".to_owned())?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> DecodeResult<u32> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "Truncated Grammar B fixture integer".to_owned())?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn read_u64(bytes: &[u8], offset: usize) -> DecodeResult<u64> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| "Truncated Grammar B fixture integer".to_owned())?;
    Ok(u64::from_le_bytes([
        value[0], value[1], value[2], value[3], value[4], value[5], value[6], value[7],
    ]))
}

fn encode_golden_stream(columns: u16, rows: u16, frames: &[Frame]) -> DecodeResult<Vec<u8>> {
    let count = u32::try_from(frames.len())
        .map_err(|_| "Golden frame count exceeds uint32".to_owned())?;
    let mut output = Vec::new();
    output.extend_from_slice(b"V64GOLD1");
    output.extend_from_slice(&columns.to_le_bytes());
    output.extend_from_slice(&rows.to_le_bytes());
    output.extend_from_slice(&count.to_le_bytes());
    for frame in frames {
        output.extend_from_slice(&frame.timestamp.to_le_bytes());
        output.extend_from_slice(&frame.duration.to_le_bytes());
        output.push(u8::from(frame.keyframe));
        output.push(u8::from(frame.repeat));
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(
            &u32::try_from(frame.state.len())
                .map_err(|_| "Golden state length exceeds uint32".to_owned())?
                .to_le_bytes(),
        );
        output.extend_from_slice(&frame.state);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_component_updates() {
        let prior = vec![1, 2, 3, 4, 5, 6];
        let commands = [SET_GLYPH, 7, SET_COLOR_PAIR, 0x98, END];
        let state = apply_packed_commands(&commands, Some(&prior), 2, 1, 16, false)
            .expect("component updates should decode");
        assert_eq!(state, vec![7, 2, 3, 4, 8, 9]);
    }

    #[test]
    fn rejects_padding_and_trailing_bytes() {
        let error = apply_packed_commands(
            &[SET_GLYPH, 0x40, END],
            Some(&[0, 0, 0]),
            1,
            1,
            16,
            false,
        )
        .expect_err("padding must be zero");
        assert!(error.contains("padding"));

        let error = apply_packed_commands(&[END, 0], None, 1, 1, 16, true)
            .expect_err("trailing bytes must fail");
        assert!(error.contains("Trailing bytes"));
    }
}
