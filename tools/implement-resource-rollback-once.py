from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing patch point: {label}")
    return text.replace(old, new, 1)


lib_path = ROOT / "crates/v64-core/src/lib.rs"
lib = lib_path.read_text()
lib = replace_once(
    lib,
    "#![forbid(unsafe_code)]\n\nuse flate2::read::DeflateDecoder;",
    "#![forbid(unsafe_code)]\n\npub mod frame;\n\nuse flate2::read::DeflateDecoder;",
    "frame module export",
)
lib = replace_once(
    lib,
    """#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ParseOptions {
    pub expected_glyph_hash: Option<[u8; 32]>,
    pub expected_palette_hash: Option<[u8; 32]>,
}
""",
    """#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ParseOptions {
    pub expected_glyph_hash: Option<[u8; 32]>,
    pub expected_palette_hash: Option<[u8; 32]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceLimits {
    pub max_inflated_chunk_bytes: usize,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            max_inflated_chunk_bytes: MAX_INFLATED_CHUNK,
        }
    }
}
""",
    "resource limits",
)
lib = replace_once(
    lib,
    """pub fn parse(input: &[u8]) -> Result<V64File> {
    parse_with_options(input, ParseOptions::default())
}

pub fn parse_with_options(input: &[u8], options: ParseOptions) -> Result<V64File> {
    let header = parse_header(input, options)?;
""",
    """pub fn parse(input: &[u8]) -> Result<V64File> {
    parse_with_options(input, ParseOptions::default())
}

pub fn parse_with_options(input: &[u8], options: ParseOptions) -> Result<V64File> {
    parse_with_resource_limits(input, options, ResourceLimits::default())
}

pub fn parse_with_resource_limits(
    input: &[u8],
    options: ParseOptions,
    limits: ResourceLimits,
) -> Result<V64File> {
    if limits.max_inflated_chunk_bytes == 0
        || limits.max_inflated_chunk_bytes > MAX_INFLATED_CHUNK
    {
        return Err(Error::new(
            "Configured inflated-chunk limit lies outside the supported range",
        ));
    }
    let header = parse_header(input, options)?;
""",
    "resource-aware parser entry point",
)
lib = replace_once(
    lib,
    "            inflate_bounded(stored, &chunk_type)?",
    "            inflate_bounded(stored, &chunk_type, limits.max_inflated_chunk_bytes)?",
    "resource-aware inflate call",
)
lib = replace_once(
    lib,
    """fn inflate_bounded(stored: &[u8], chunk_type: &str) -> Result<Vec<u8>> {
    let decoder = DeflateDecoder::new(stored);
    let mut limited = decoder.take((MAX_INFLATED_CHUNK as u64) + 1);
""",
    """fn inflate_bounded(
    stored: &[u8],
    chunk_type: &str,
    max_inflated_chunk_bytes: usize,
) -> Result<Vec<u8>> {
    let decoder = DeflateDecoder::new(stored);
    let limit = u64::try_from(max_inflated_chunk_bytes)
        .map_err(|_| Error::new("Inflated-chunk limit exceeds u64"))?;
    let mut limited = decoder.take(limit + 1);
""",
    "bounded inflate signature",
)
lib = replace_once(
    lib,
    "    if payload.len() > MAX_INFLATED_CHUNK {",
    "    if payload.len() > max_inflated_chunk_bytes {",
    "bounded inflate comparison",
)
insert = r'''

    #[test]
    fn runtime_inflate_limit_accepts_the_boundary_and_rejects_one_byte_below() {
        use flate2::Compression;
        use flate2::write::DeflateEncoder;
        use std::io::Write;

        let expanded = vec![b'A'; 65_536];
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
        encoder
            .write_all(&expanded)
            .expect("compression should succeed");
        let compressed = encoder.finish().expect("compression should finish");
        let container = compressed_meta_container(&compressed);

        parse(&container).expect("default hard limit should accept the fixture");
        parse_with_resource_limits(
            &container,
            ParseOptions::default(),
            ResourceLimits {
                max_inflated_chunk_bytes: expanded.len(),
            },
        )
        .expect("the exact configured output boundary should be accepted");

        let error = parse_with_resource_limits(
            &container,
            ParseOptions::default(),
            ResourceLimits {
                max_inflated_chunk_bytes: expanded.len() - 1,
            },
        )
        .expect_err("one byte below the expanded size must fail closed");
        assert!(error.to_string().contains("excessive compressed META payload"));
    }

    #[test]
    fn runtime_inflate_limit_cannot_disable_or_exceed_the_hard_ceiling() {
        for limit in [0, MAX_INFLATED_CHUNK + 1] {
            let error = parse_with_resource_limits(
                PROCEDURAL,
                ParseOptions::default(),
                ResourceLimits {
                    max_inflated_chunk_bytes: limit,
                },
            )
            .expect_err("invalid resource limits must fail before parsing");
            assert!(error.to_string().contains("outside the supported range"));
        }
    }

    fn compressed_meta_container(compressed: &[u8]) -> Vec<u8> {
        let index_payload = 0u32.to_le_bytes();
        let index_offset = HEADER_SIZE + CHUNK_HEADER_SIZE + compressed.len();
        let mut container = vec![0u8; HEADER_SIZE];
        container[..MAGIC.len()].copy_from_slice(&MAGIC);
        container[8] = 0;
        container[9] = 1;
        write_test_u16(&mut container, 10, u16::try_from(HEADER_SIZE).unwrap());
        write_test_u16(&mut container, 16, 1);
        write_test_u16(&mut container, 18, 1);
        container[20] = 7;
        container[21] = 0;
        write_test_u32(&mut container, 24, TICK_RATE);
        write_test_u64(&mut container, 28, 2_500);
        write_test_u64(&mut container, 100, u64::try_from(index_offset).unwrap());
        write_test_u32(
            &mut container,
            108,
            u32::try_from(CHUNK_HEADER_SIZE + index_payload.len()).unwrap(),
        );
        write_test_u32(&mut container, 112, 2);
        write_test_u32(
            &mut container,
            116,
            u32::try_from(compressed.len().max(index_payload.len())).unwrap(),
        );
        write_test_u32(&mut container, 120, 1);
        write_test_u32(&mut container, 124, 1);
        append_test_chunk(&mut container, b"META", FLAG_CRC | FLAG_DEFLATE, compressed);
        append_test_chunk(&mut container, b"INDX", FLAG_CRC, &index_payload);
        container
    }

    fn append_test_chunk(
        container: &mut Vec<u8>,
        chunk_type: &[u8; 4],
        flags: u32,
        stored: &[u8],
    ) {
        let offset = container.len();
        container.resize(offset + CHUNK_HEADER_SIZE, 0);
        container[offset..offset + 4].copy_from_slice(chunk_type);
        write_test_u32(container, offset + 4, flags);
        write_test_u32(
            container,
            offset + 24,
            u32::try_from(stored.len()).unwrap(),
        );
        write_test_u32(container, offset + 28, crc32(stored));
        container.extend_from_slice(stored);
    }

    fn write_test_u16(bytes: &mut [u8], offset: usize, value: u16) {
        bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn write_test_u32(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn write_test_u64(bytes: &mut [u8], offset: usize, value: u64) {
        bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }
'''
closing = lib.rfind("\n}")
if closing < 0:
    raise SystemExit("missing lib test-module closing brace")
lib = lib[:closing] + insert + lib[closing:]
lib_path.write_text(lib)

frame_path = ROOT / "crates/v64-core/src/frame.rs"
frame_path.write_text(r'''pub const END: u8 = 0;
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
''')

stream_path = ROOT / "crates/v64-core/src/bin/v64-golden-stream.rs"
stream = stream_path.read_text()
stream = replace_once(
    stream,
    "use v64_core::V64File;",
    "use v64_core::V64File;\nuse v64_core::frame::{END, SKIP, apply_frame_commands};",
    "shared frame decoder import",
)
stream = replace_once(
    stream,
    """const END: u8 = 0;
const SKIP: u8 = 1;
const LITERAL: u8 = 2;
const REPEAT_TOKEN: u8 = 3;
const FILL_RECT: u8 = 4;
const DEFINE_TOKEN_DICTIONARY: u8 = 5;
const DICTIONARY_LITERAL: u8 = 6;
const MAX_DICTIONARY_ENTRIES: usize = 64;

""",
    "",
    "local frame constants",
)
stream, count = re.subn(
    r"\nfn apply_frame_commands\([\s\S]*?\nfn encode_golden_stream",
    "\nfn encode_golden_stream",
    stream,
    count=1,
)
if count != 1:
    raise SystemExit("failed to remove the duplicated frame decoder")
stream_path.write_text(stream)

resource_gate = ROOT / "crates/v64-core/src/bin/v64-resource-gate.rs"
resource_gate.write_text(r'''#![forbid(unsafe_code)]

use flate2::Compression;
use flate2::write::DeflateEncoder;
use serde_json::json;
use std::env;
use std::error::Error;
use std::fs;
use std::io::Write;
use v64_core::{
    CHUNK_HEADER_SIZE, HEADER_SIZE, MAGIC, MAX_INFLATED_CHUNK, ParseOptions, ResourceLimits,
    TICK_RATE, V64File, parse, parse_with_resource_limits,
};

const ITERATIONS: usize = 64;
const EXPANDED_BYTES: usize = 65_536;

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args_os().skip(1);
    let output = arguments.next().ok_or("missing OUTPUT.json")?;
    if arguments.next().is_some() {
        return Err("usage: v64-resource-gate OUTPUT.json".into());
    }

    let expanded = vec![b'A'; EXPANDED_BYTES];
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(&expanded)?;
    let compressed = encoder.finish()?;
    let container = build_container(&compressed)?;
    let baseline = parse(&container)?;
    let fingerprint = fingerprint(&baseline);

    for _ in 0..ITERATIONS {
        let exact = parse_with_resource_limits(
            &container,
            ParseOptions::default(),
            ResourceLimits {
                max_inflated_chunk_bytes: expanded.len(),
            },
        )?;
        if fingerprint(&exact) != fingerprint {
            return Err("exact-boundary parse changed the valid fingerprint".into());
        }
    }

    let cases = [
        ("one_byte_below_expanded_size", expanded.len() - 1),
        ("zero_disables_nothing", 0),
        ("above_compiled_hard_ceiling", MAX_INFLATED_CHUNK + 1),
    ];
    let mut results = Vec::new();
    for (name, limit) in cases {
        let mut expected_error = None;
        for _ in 0..ITERATIONS {
            let error = parse_with_resource_limits(
                &container,
                ParseOptions::default(),
                ResourceLimits {
                    max_inflated_chunk_bytes: limit,
                },
            )
            .expect_err("configured hostile limit must fail")
            .to_string();
            if let Some(expected) = &expected_error {
                if expected != &error {
                    return Err(format!("{name} produced nondeterministic errors").into());
                }
            } else {
                expected_error = Some(error);
            }
            let recovered = parse(&container)?;
            if fingerprint(&recovered) != fingerprint {
                return Err(format!("valid parse changed after {name}").into());
            }
        }
        results.push(json!({
            "name": name,
            "configured_limit_bytes": limit,
            "iterations": ITERATIONS,
            "error": expected_error.ok_or("missing resource rejection error")?,
            "valid_reparse_fingerprint": fingerprint,
        }));
    }

    let ratio_milli = expanded
        .len()
        .checked_mul(1_000)
        .ok_or("expansion ratio overflow")?
        / compressed.len();
    let report = json!({
        "format": "V64-RUST-RESOURCE-GATE-1",
        "license": "MIT",
        "copyright": "Copyright (c) 2026 Shael Riley",
        "iterations": ITERATIONS,
        "stored_bytes": compressed.len(),
        "inflated_bytes": expanded.len(),
        "expansion_ratio_milli": ratio_milli,
        "compiled_hard_ceiling_bytes": MAX_INFLATED_CHUNK,
        "exact_boundary_accepted": true,
        "valid_fingerprint": fingerprint,
        "case_count": results.len(),
        "cases": results,
    });
    fs::write(output, format!("{}\n", serde_json::to_string_pretty(&report)?))?;
    Ok(())
}

fn build_container(compressed: &[u8]) -> Result<Vec<u8>, Box<dyn Error>> {
    let index_payload = 0u32.to_le_bytes();
    let index_offset = HEADER_SIZE + CHUNK_HEADER_SIZE + compressed.len();
    let mut bytes = vec![0u8; HEADER_SIZE];
    bytes[..MAGIC.len()].copy_from_slice(&MAGIC);
    bytes[8] = 0;
    bytes[9] = 1;
    write_u16(&mut bytes, 10, u16::try_from(HEADER_SIZE)?);
    write_u16(&mut bytes, 16, 1);
    write_u16(&mut bytes, 18, 1);
    bytes[20] = 7;
    bytes[21] = 0;
    write_u32(&mut bytes, 24, TICK_RATE);
    write_u64(&mut bytes, 28, 2_500);
    write_u64(&mut bytes, 100, u64::try_from(index_offset)?);
    write_u32(
        &mut bytes,
        108,
        u32::try_from(CHUNK_HEADER_SIZE + index_payload.len())?,
    );
    write_u32(&mut bytes, 112, 2);
    write_u32(
        &mut bytes,
        116,
        u32::try_from(compressed.len().max(index_payload.len()))?,
    );
    write_u32(&mut bytes, 120, 1);
    write_u32(&mut bytes, 124, 1);
    append_chunk(&mut bytes, b"META", 3, compressed)?;
    append_chunk(&mut bytes, b"INDX", 1, &index_payload)?;
    Ok(bytes)
}

fn append_chunk(
    bytes: &mut Vec<u8>,
    chunk_type: &[u8; 4],
    flags: u32,
    stored: &[u8],
) -> Result<(), Box<dyn Error>> {
    let offset = bytes.len();
    bytes.resize(offset + CHUNK_HEADER_SIZE, 0);
    bytes[offset..offset + 4].copy_from_slice(chunk_type);
    write_u32(bytes, offset + 4, flags);
    write_u32(bytes, offset + 24, u32::try_from(stored.len())?);
    write_u32(bytes, offset + 28, crc32(stored));
    bytes.extend_from_slice(stored);
    Ok(())
}

fn fingerprint(file: &V64File) -> String {
    let payload_bytes = file.chunks.iter().map(|chunk| chunk.payload.len()).sum::<usize>();
    format!(
        "{}:{}:{}:{}",
        file.header.duration_ticks,
        file.chunks.len(),
        file.index.len(),
        payload_bytes
    )
}

fn write_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn write_u64(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = 0u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}
''')

rollback_gate = ROOT / "crates/v64-core/src/bin/v64-frame-rollback-gate.rs"
rollback_gate.write_text(r'''#![forbid(unsafe_code)]

use serde_json::json;
use std::env;
use std::error::Error;
use std::fs;
use v64_core::frame::{
    DEFINE_TOKEN_DICTIONARY, DICTIONARY_LITERAL, END, FILL_RECT, LITERAL, REPEAT_TOKEN, SKIP,
    apply_frame_commands,
};

const ITERATIONS: usize = 64;

struct Vector {
    name: &'static str,
    commands: Vec<u8>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args_os().skip(1);
    let output = arguments.next().ok_or("missing OUTPUT.json")?;
    if arguments.next().is_some() {
        return Err("usage: v64-frame-rollback-gate OUTPUT.json".into());
    }

    let prior = vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    let recovery = [SKIP, 1, REPEAT_TOKEN, 1, 12, 13, 14, SKIP, 2, END];
    let mut expected_recovery = prior.clone();
    expected_recovery[3..6].copy_from_slice(&[12, 13, 14]);
    let vectors = vec![
        Vector {
            name: "literal_then_unknown_opcode",
            commands: vec![LITERAL, 1, 1, 2, 3, 0xff],
        },
        Vector {
            name: "repeat_then_trailing_bytes",
            commands: vec![REPEAT_TOKEN, 1, 2, 3, 4, END, 0],
        },
        Vector {
            name: "rectangle_then_zero_skip",
            commands: vec![FILL_RECT, 0, 0, 1, 1, 3, 4, 5, SKIP, 0],
        },
        Vector {
            name: "dictionary_partial_then_bad_index",
            commands: vec![
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
        },
        Vector {
            name: "literal_partial_then_truncated_token",
            commands: vec![LITERAL, 2, 5, 6, 7, 8, 9],
        },
    ];

    let mut results = Vec::new();
    for vector in vectors {
        let mut expected_error = None;
        for _ in 0..ITERATIONS {
            let snapshot = prior.clone();
            let error = apply_frame_commands(&vector.commands, Some(&prior), 4, 1, 16, false)
                .expect_err("rollback vector must fail");
            if prior != snapshot {
                return Err(format!("{} mutated the prior state", vector.name).into());
            }
            if let Some(expected) = &expected_error {
                if expected != &error {
                    return Err(format!("{} produced nondeterministic errors", vector.name).into());
                }
            } else {
                expected_error = Some(error);
            }
            let recovered = apply_frame_commands(&recovery, Some(&prior), 4, 1, 16, false)?;
            if recovered != expected_recovery {
                return Err(format!("{} contaminated the next valid delta", vector.name).into());
            }
        }
        results.push(json!({
            "name": vector.name,
            "command_bytes": vector.commands.len(),
            "iterations": ITERATIONS,
            "error": expected_error.ok_or("missing rollback rejection error")?,
            "prior_state_hex": hex(&prior),
            "recovery_state_hex": hex(&expected_recovery),
        }));
    }

    let report = json!({
        "format": "V64-RUST-FRAME-ROLLBACK-GATE-1",
        "license": "MIT",
        "copyright": "Copyright (c) 2026 Shael Riley",
        "case_count": results.len(),
        "iterations_per_case": ITERATIONS,
        "prior_state_immutable": true,
        "valid_delta_recovery_after_each_failure": true,
        "cases": results,
    });
    fs::write(output, format!("{}\n", serde_json::to_string_pretty(&report)?))?;
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
''')

permanent_workflow = ROOT / ".github/workflows/rust-resource-rollback.yml"
permanent_workflow.write_text(r'''name: V64 Rust resource and rollback gate

on:
  pull_request:
    paths:
      - ".github/workflows/rust-resource-rollback.yml"
      - "Cargo.toml"
      - "Cargo.lock"
      - "crates/v64-core/**"
      - "bench/results/rust-resource-rollback/**"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: v64-rust-resource-rollback-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  resource-rollback:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - name: Check out pull-request head
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha || github.sha }}

      - name: Install pinned Rust toolchain
        shell: bash
        run: |
          set -euo pipefail
          rustup toolchain install 1.85.0 --profile minimal
          rustup default 1.85.0
          rustc --version
          cargo --version

      - name: Check formatting
        run: cargo fmt --all -- --check

      - name: Test all Rust targets
        run: cargo test --locked --workspace --all-targets

      - name: Test optimized Rust targets
        run: cargo test --locked --workspace --all-targets --release

      - name: Run resource gate twice
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p target/resource-rollback
          cargo run --locked --release --bin v64-resource-gate -- target/resource-rollback/resource-a.json
          cargo run --locked --release --bin v64-resource-gate -- target/resource-rollback/resource-b.json
          cmp target/resource-rollback/resource-a.json target/resource-rollback/resource-b.json

      - name: Run frame rollback gate twice
        shell: bash
        run: |
          set -euo pipefail
          cargo run --locked --release --bin v64-frame-rollback-gate -- target/resource-rollback/rollback-a.json
          cargo run --locked --release --bin v64-frame-rollback-gate -- target/resource-rollback/rollback-b.json
          cmp target/resource-rollback/rollback-a.json target/resource-rollback/rollback-b.json

      - name: Validate and hash reports
        shell: bash
        run: |
          set -euo pipefail
          python3 - <<'PY'
          import json
          from pathlib import Path
          resource = json.loads(Path("target/resource-rollback/resource-a.json").read_text())
          rollback = json.loads(Path("target/resource-rollback/rollback-a.json").read_text())
          assert resource["format"] == "V64-RUST-RESOURCE-GATE-1"
          assert resource["exact_boundary_accepted"] is True
          assert resource["case_count"] == 3
          assert rollback["format"] == "V64-RUST-FRAME-ROLLBACK-GATE-1"
          assert rollback["case_count"] == 5
          assert rollback["prior_state_immutable"] is True
          assert rollback["valid_delta_recovery_after_each_failure"] is True
          PY
          sha256sum \
            target/resource-rollback/resource-a.json \
            target/resource-rollback/rollback-a.json \
            | tee target/resource-rollback/SHA256SUMS

      - name: Upload hardening evidence
        uses: actions/upload-artifact@v4
        with:
          name: v64-rust-resource-rollback
          path: target/resource-rollback
          if-no-files-found: error
          retention-days: 30
''')
