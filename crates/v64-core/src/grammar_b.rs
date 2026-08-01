pub const END: u8 = 0;
pub const SKIP: u8 = 1;
pub const LITERAL: u8 = 2;
pub const REPEAT_TOKEN: u8 = 3;
pub const SET_GLYPH: u8 = 4;
pub const SET_FOREGROUND: u8 = 5;
pub const SET_BACKGROUND: u8 = 6;
pub const SET_COLOR_PAIR: u8 = 7;
pub const REPEAT_GLYPH: u8 = 8;
pub const REPEAT_FOREGROUND: u8 = 9;
pub const REPEAT_BACKGROUND: u8 = 10;
pub const REPEAT_COLOR_PAIR: u8 = 11;

/// Applies one direct Grammar B command stream transactionally.
///
/// The returned vector is the only committed state. The caller's prior state is
/// borrowed and therefore cannot be modified by a malformed partial stream.
pub fn apply_packed_commands(
    bytes: &[u8],
    prior: Option<&[u8]>,
    columns: usize,
    rows: usize,
    palette_depth: usize,
    keyframe: bool,
) -> Result<Vec<u8>, String> {
    let cells = columns
        .checked_mul(rows)
        .ok_or_else(|| "Cell count overflow".to_owned())?;
    if columns == 0
        || rows == 0
        || columns > usize::from(crate::MAX_COLUMNS)
        || rows > usize::from(crate::MAX_ROWS)
        || cells > crate::MAX_CELLS
    {
        return Err("Invalid or oversized Grammar B grid".to_owned());
    }
    let state_length = cells
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
    let palette_bits = palette_bits(palette_depth)?;
    let token_bits = 6 + 2 * palette_bits;
    let command_limit = cells
        .checked_mul(2)
        .and_then(|value| value.checked_add(1))
        .ok_or_else(|| "Frame command-count overflow".to_owned())?;
    let mut offset = 0usize;
    let mut cursor = 0usize;
    let mut command_count = 0usize;
    let mut ended = false;

    while offset < bytes.len() {
        command_count += 1;
        if command_count > command_limit {
            return Err("Frame command count exceeds bound".to_owned());
        }
        let opcode = bytes[offset];
        offset += 1;
        if opcode == END {
            ended = true;
            break;
        }
        if opcode == SKIP {
            let count = read_count(bytes, &mut offset)?;
            require_range(cursor, count, cells, "Packed skip advances beyond grid")?;
            cursor += count;
            continue;
        }
        if opcode == LITERAL {
            let count = read_count(bytes, &mut offset)?;
            require_range(
                cursor,
                count,
                cells,
                "Packed token command advances beyond grid",
            )?;
            let used_bits = count
                .checked_mul(token_bits)
                .ok_or_else(|| "Packed literal is too large".to_owned())?;
            let payload = read_payload(bytes, &mut offset, used_bits)?;
            let mut bit = 0usize;
            for index in 0..count {
                let glyph = read_bits(payload, bit, 6);
                bit += 6;
                let foreground = read_bits(payload, bit, palette_bits);
                bit += palette_bits;
                let background = read_bits(payload, bit, palette_bits);
                bit += palette_bits;
                write_token(
                    &mut state,
                    cursor + index,
                    glyph,
                    foreground,
                    background,
                    palette_depth,
                )?;
            }
            require_zero_padding(payload, used_bits)?;
            cursor += count;
            continue;
        }
        if opcode == REPEAT_TOKEN {
            let count = read_count(bytes, &mut offset)?;
            require_range(
                cursor,
                count,
                cells,
                "Packed token command advances beyond grid",
            )?;
            let payload = read_payload(bytes, &mut offset, token_bits)?;
            let glyph = read_bits(payload, 0, 6);
            let foreground = read_bits(payload, 6, palette_bits);
            let background = read_bits(payload, 6 + palette_bits, palette_bits);
            require_zero_padding(payload, token_bits)?;
            for index in 0..count {
                write_token(
                    &mut state,
                    cursor + index,
                    glyph,
                    foreground,
                    background,
                    palette_depth,
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
            read_count(bytes, &mut offset)?
        } else {
            1
        };
        require_range(
            cursor,
            count,
            cells,
            "Packed component command advances beyond grid",
        )?;
        let glyph = matches!(opcode, SET_GLYPH | REPEAT_GLYPH);
        let pair = matches!(opcode, SET_COLOR_PAIR | REPEAT_COLOR_PAIR);
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
        let used_bits = if glyph {
            6
        } else if pair {
            palette_bits * 2
        } else {
            palette_bits
        };
        let payload = read_payload(bytes, &mut offset, used_bits)?;
        let first = read_bits(payload, 0, if glyph { 6 } else { palette_bits });
        let second = pair.then(|| read_bits(payload, palette_bits, palette_bits));
        require_zero_padding(payload, used_bits)?;
        if glyph {
            if first >= 64 {
                return Err("Glyph index exceeds canonical set".to_owned());
            }
        } else if first >= palette_depth || second.is_some_and(|value| value >= palette_depth) {
            return Err("Palette index exceeds declared depth".to_owned());
        }
        for index in 0..count {
            let target = (cursor + index) * 3;
            match opcode {
                SET_GLYPH | REPEAT_GLYPH => state[target] = first as u8,
                SET_FOREGROUND | REPEAT_FOREGROUND => state[target + 1] = first as u8,
                SET_BACKGROUND | REPEAT_BACKGROUND => state[target + 2] = first as u8,
                SET_COLOR_PAIR | REPEAT_COLOR_PAIR => {
                    state[target + 1] = first as u8;
                    state[target + 2] = second.expect("color-pair opcodes set a second value") as u8;
                }
                _ => unreachable!(),
            }
        }
        cursor += count;
    }
    if !ended {
        return Err("Packed command stream has no END".to_owned());
    }
    if offset != bytes.len() {
        return Err("Trailing bytes after packed frame END".to_owned());
    }
    Ok(state)
}

fn palette_bits(depth: usize) -> Result<usize, String> {
    if !(2..=256).contains(&depth) {
        return Err("Palette depth must be an integer from 2 through 256".to_owned());
    }
    Ok(usize::BITS as usize - (depth - 1).leading_zeros() as usize)
}

fn read_count(bytes: &[u8], offset: &mut usize) -> Result<usize, String> {
    let value = read_varuint(bytes, offset)?;
    if value == 0 {
        return Err("Zero-progress command".to_owned());
    }
    usize::try_from(value).map_err(|_| "Command count exceeds platform range".to_owned())
}

fn require_range(cursor: usize, count: usize, cells: usize, message: &str) -> Result<(), String> {
    if cursor.checked_add(count).is_none_or(|end| end > cells) {
        return Err(message.to_owned());
    }
    Ok(())
}

fn read_payload<'a>(bytes: &'a [u8], offset: &mut usize, bits: usize) -> Result<&'a [u8], String> {
    let length = bits
        .checked_add(7)
        .ok_or_else(|| "Packed payload length overflow".to_owned())?
        / 8;
    let end = offset
        .checked_add(length)
        .ok_or_else(|| "Packed payload range overflow".to_owned())?;
    let payload = bytes
        .get(*offset..end)
        .ok_or_else(|| "Truncated packed command payload".to_owned())?;
    *offset = end;
    Ok(payload)
}

fn read_bits(bytes: &[u8], start: usize, width: usize) -> usize {
    let mut value = 0usize;
    for bit in 0..width {
        let absolute = start + bit;
        if bytes[absolute >> 3] & (1 << (absolute & 7)) != 0 {
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

fn write_token(
    state: &mut [u8],
    cell: usize,
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
    let target = cell
        .checked_mul(3)
        .ok_or_else(|| "Cell offset overflow".to_owned())?;
    state[target] = glyph as u8;
    state[target + 1] = foreground as u8;
    state[target + 2] = background as u8;
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
            let canonical = match value {
                0..=0x7f => 1,
                0x80..=0x3fff => 2,
                0x4000..=0x1f_ffff => 3,
                0x20_0000..=0x0fff_ffff => 4,
                _ => 5,
            };
            if *offset - start != canonical {
                return Err("Non-canonical varuint".to_owned());
            }
            return Ok(value);
        }
        shift += 7;
    }
    Err("Varuint exceeds five bytes".to_owned())
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
    fn rejects_oversized_grid_before_allocation() {
        assert!(apply_packed_commands(&[END], None, usize::MAX, 2, 16, true).is_err());
        assert!(apply_packed_commands(&[END], None, 513, 1, 16, true).is_err());
    }
}
