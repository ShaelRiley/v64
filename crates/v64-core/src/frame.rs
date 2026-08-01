pub const END: u8 = 0;
pub const SKIP: u8 = 1;
pub const LITERAL: u8 = 2;
pub const REPEAT_TOKEN: u8 = 3;
pub const FILL_RECT: u8 = 4;
pub const DEFINE_TOKEN_DICTIONARY: u8 = 5;
pub const DICTIONARY_LITERAL: u8 = 6;
const MAX_DICTIONARY_ENTRIES: usize = 64;

pub fn apply_frame_commands(
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
    if columns == 0
        || rows == 0
        || columns > usize::from(crate::MAX_COLUMNS)
        || rows > usize::from(crate::MAX_ROWS)
        || cell_count > crate::MAX_CELLS
    {
        return Err("Invalid or oversized frame grid".to_owned());
    }
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
                let count = usize::try_from(read_varuint(command_bytes, &mut offset)?)
                    .map_err(|_| "Invalid skip run".to_owned())?;
                if count == 0 || cursor.checked_add(count).is_none_or(|end| end > cell_count) {
                    return Err("Invalid skip run".to_owned());
                }
                cursor += count;
            }
            LITERAL => {
                let count = usize::try_from(read_varuint(command_bytes, &mut offset)?)
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
                let count = usize::try_from(read_varuint(command_bytes, &mut offset)?)
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
                        write_cell(&mut state, touched.as_mut(), py * columns + px, token);
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
                let entries = dictionary.as_ref().ok_or_else(|| {
                    "Dictionary literal precedes dictionary definition".to_owned()
                })?;
                let count = usize::try_from(read_varuint(command_bytes, &mut offset)?)
                    .map_err(|_| "Invalid dictionary literal".to_owned())?;
                if count == 0
                    || cursor.checked_add(count).is_none_or(|end| end > cell_count)
                    || offset
                        .checked_add(count)
                        .is_none_or(|end| end > command_bytes.len())
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
            _ => return Err(format!("Unknown mandatory frame opcode 0x{opcode:02x}")),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_partial_updates_do_not_mutate_the_prior_state() {
        let prior = vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        let vectors = [
            vec![LITERAL, 1, 1, 2, 3, 0xff],
            vec![REPEAT_TOKEN, 1, 2, 3, 4, END, 0],
            vec![FILL_RECT, 0, 0, 1, 1, 3, 4, 5, SKIP, 0],
            vec![
                DEFINE_TOKEN_DICTIONARY,
                1,
                4,
                5,
                6,
                DICTIONARY_LITERAL,
                2,
                0,
                1,
                END,
            ],
            vec![LITERAL, 2, 5, 6, 7, 8, 9],
        ];
        let recovery = [SKIP, 1, REPEAT_TOKEN, 1, 12, 13, 14, SKIP, 2, END];
        let mut expected = prior.clone();
        expected[3..6].copy_from_slice(&[12, 13, 14]);

        for vector in vectors {
            let snapshot = prior.clone();
            apply_frame_commands(&vector, Some(&prior), 4, 1, 16, false)
                .expect_err("the malformed vector must fail");
            assert_eq!(prior, snapshot);
            let recovered = apply_frame_commands(&recovery, Some(&prior), 4, 1, 16, false)
                .expect("a valid delta must decode after every failure");
            assert_eq!(recovered, expected);
        }
    }
}
