#![forbid(unsafe_code)]

use serde_json::{Value, json};
use std::env;
use std::error::Error;
use std::fs;
use v64_core::{
    CHUNK_HEADER_SIZE, HEADER_SIZE, MAX_CHUNKS, MAX_JS_SAFE_INTEGER, MAX_STORED_CHUNK,
    V64File, parse,
};

const ITERATIONS: usize = 64;

struct HostileCase {
    name: &'static str,
    bytes: Vec<u8>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args_os().skip(1);
    let input_path = arguments.next().ok_or("missing INPUT.v64")?;
    let output_path = arguments.next().ok_or("missing OUTPUT.json")?;
    if arguments.next().is_some() {
        return Err("usage: v64-hostile-gate INPUT.v64 OUTPUT.json".into());
    }

    let valid = fs::read(input_path)?;
    let baseline_file = parse(&valid)?;
    let baseline_fingerprint = fingerprint(&baseline_file);
    let cases = build_cases(&valid)?;
    if cases.len() < 24 {
        return Err(format!("hostile corpus is unexpectedly small: {}", cases.len()).into());
    }

    let mut results = Vec::with_capacity(cases.len());
    for case in cases {
        let mut expected_error = None;
        for _ in 0..ITERATIONS {
            let error = match parse(&case.bytes) {
                Ok(_) => {
                    return Err(format!(
                        "hostile case {} unexpectedly parsed successfully",
                        case.name
                    )
                    .into());
                }
                Err(error) => error.to_string(),
            };
            if let Some(expected) = &expected_error {
                if expected != &error {
                    return Err(format!(
                        "hostile case {} produced nondeterministic errors: {expected:?} then {error:?}",
                        case.name
                    )
                    .into());
                }
            } else {
                expected_error = Some(error);
            }
        }

        let recovered = parse(&valid)?;
        if fingerprint(&recovered) != baseline_fingerprint {
            return Err(format!(
                "valid parser state changed after hostile case {}",
                case.name
            )
            .into());
        }

        results.push(json!({
            "name": case.name,
            "input_bytes": case.bytes.len(),
            "iterations": ITERATIONS,
            "error": expected_error.ok_or("missing rejection error")?,
            "valid_reparse_fingerprint": baseline_fingerprint,
        }));
    }

    let report = json!({
        "format": "V64-RUST-HOSTILE-GATE-1",
        "license": "MIT",
        "copyright": "Copyright (c) 2026 Shael Riley",
        "valid_input_bytes": valid.len(),
        "valid_fingerprint": baseline_fingerprint,
        "case_count": results.len(),
        "iterations_per_case": ITERATIONS,
        "cases": results,
        "scope": {
            "deterministic_rejection": true,
            "valid_reparse_after_each_case": true,
            "process_time_and_rss_measured_by_workflow": true,
            "decompression_expansion_limit_finalized": false,
            "transactional_frame_rollback_corpus_complete": false
        }
    });
    fs::write(output_path, format!("{}\n", serde_json::to_string_pretty(&report)?))?;
    Ok(())
}

fn fingerprint(file: &V64File) -> String {
    let stored_bytes = file
        .chunks
        .iter()
        .map(|chunk| u64::from(chunk.stored_length))
        .sum::<u64>();
    let payload_bytes = file
        .chunks
        .iter()
        .map(|chunk| u64::try_from(chunk.payload.len()).unwrap_or(u64::MAX))
        .sum::<u64>();
    format!(
        "{}:{}:{}:{}:{}:{}x{}",
        file.header.duration_ticks,
        file.chunks.len(),
        file.index.len(),
        stored_bytes,
        payload_bytes,
        file.header.columns,
        file.header.rows
    )
}

fn build_cases(valid: &[u8]) -> Result<Vec<HostileCase>, Box<dyn Error>> {
    if valid.len() < HEADER_SIZE + CHUNK_HEADER_SIZE {
        return Err("valid fixture is too small for hostile mutations".into());
    }

    let mut cases = Vec::new();
    cases.push(HostileCase {
        name: "truncated_header",
        bytes: valid[..HEADER_SIZE - 1].to_vec(),
    });
    cases.push(mutate(valid, "bad_magic", |bytes| bytes[0] ^= 0xff));
    cases.push(mutate(valid, "unsupported_major_version", |bytes| {
        bytes[8] = 1;
    }));
    cases.push(mutate(valid, "unsupported_header_size", |bytes| {
        write_u16(bytes, 10, 64);
    }));
    cases.push(mutate(valid, "unknown_header_feature", |bytes| {
        let flags = read_u32(bytes, 12).unwrap_or(0);
        write_u32(bytes, 12, flags | 0x8000_0000);
    }));
    cases.push(mutate(valid, "zero_columns", |bytes| {
        write_u16(bytes, 16, 0);
    }));
    cases.push(mutate(valid, "oversized_columns", |bytes| {
        write_u16(bytes, 16, 513);
    }));
    cases.push(mutate(valid, "invalid_cadence", |bytes| bytes[20] = 0xff));
    cases.push(mutate(valid, "invalid_palette_depth", |bytes| {
        bytes[21] = 0xff;
    }));
    cases.push(mutate(valid, "unsupported_glyph_coding", |bytes| {
        bytes[22] = 1;
    }));
    cases.push(mutate(valid, "nonzero_reserved_header", |bytes| {
        bytes[23] = 1;
    }));
    cases.push(mutate(valid, "invalid_tick_rate", |bytes| {
        write_u32(bytes, 24, 1);
    }));
    cases.push(mutate(valid, "unsafe_duration", |bytes| {
        write_u64(bytes, 28, MAX_JS_SAFE_INTEGER + 1);
    }));
    cases.push(mutate(valid, "index_before_header", |bytes| {
        write_u64(bytes, 100, 0);
    }));
    cases.push(mutate(valid, "index_outside_file", |bytes| {
        write_u64(bytes, 100, u64::try_from(valid.len()).unwrap_or(u64::MAX) + 1);
    }));
    cases.push(mutate(valid, "oversized_index_length", |bytes| {
        write_u32(bytes, 108, u32::MAX);
    }));
    cases.push(mutate(valid, "zero_chunk_count", |bytes| {
        write_u32(bytes, 112, 0);
    }));
    cases.push(mutate(valid, "excessive_chunk_count", |bytes| {
        write_u32(bytes, 112, MAX_CHUNKS + 1);
    }));
    cases.push(mutate(valid, "declared_maximum_too_large", |bytes| {
        write_u32(
            bytes,
            116,
            u32::try_from(MAX_STORED_CHUNK).unwrap_or(u32::MAX) + 1,
        );
    }));
    cases.push(mutate(valid, "unknown_glyph_asset", |bytes| {
        write_u32(bytes, 120, 2);
    }));
    cases.push(mutate(valid, "unknown_palette_asset", |bytes| {
        write_u32(bytes, 124, 2);
    }));
    cases.push(mutate(valid, "unknown_mandatory_chunk", |bytes| {
        bytes[HEADER_SIZE..HEADER_SIZE + 4].copy_from_slice(b"ZZZZ");
    }));
    cases.push(mutate(valid, "unknown_chunk_flags", |bytes| {
        let flags = read_u32(bytes, HEADER_SIZE + 4).unwrap_or(0);
        write_u32(bytes, HEADER_SIZE + 4, flags | 0x8000_0000);
    }));
    cases.push(mutate(valid, "unsafe_chunk_timestamp", |bytes| {
        write_u64(bytes, HEADER_SIZE + 8, MAX_JS_SAFE_INTEGER + 1);
    }));
    cases.push(mutate(valid, "oversized_stored_length", |bytes| {
        write_u32(bytes, HEADER_SIZE + 24, u32::MAX);
    }));
    cases.push(HostileCase {
        name: "truncated_chunk_header",
        bytes: valid[..HEADER_SIZE + CHUNK_HEADER_SIZE - 1].to_vec(),
    });
    cases.push(HostileCase {
        name: "truncated_file_tail",
        bytes: valid[..valid.len() - 1].to_vec(),
    });
    let mut trailing = valid.to_vec();
    trailing.push(0);
    cases.push(HostileCase {
        name: "trailing_bytes",
        bytes: trailing,
    });

    if let Some(payload_offset) = find_crc_payload(valid) {
        cases.push(mutate(valid, "crc_payload_corruption", |bytes| {
            bytes[payload_offset] ^= 0x01;
        }));
    }

    Ok(cases)
}

fn mutate(
    valid: &[u8],
    name: &'static str,
    operation: impl FnOnce(&mut [u8]),
) -> HostileCase {
    let mut bytes = valid.to_vec();
    operation(&mut bytes);
    HostileCase { name, bytes }
}

fn find_crc_payload(input: &[u8]) -> Option<usize> {
    let chunk_count = usize::try_from(read_u32(input, 112)?).ok()?;
    let mut offset = HEADER_SIZE;
    for _ in 0..chunk_count.min(100_000) {
        let header_end = offset.checked_add(CHUNK_HEADER_SIZE)?;
        if header_end > input.len() {
            return None;
        }
        let flags = read_u32(input, offset + 4)?;
        let stored_length = usize::try_from(read_u32(input, offset + 24)?).ok()?;
        let payload_end = header_end.checked_add(stored_length)?;
        if payload_end > input.len() {
            return None;
        }
        if flags & 1 != 0 && stored_length > 0 {
            return Some(header_end);
        }
        offset = payload_end;
    }
    None
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(offset..offset + 4)?.try_into().ok()?))
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
