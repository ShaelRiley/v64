#![forbid(unsafe_code)]

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
    let baseline_fingerprint = fingerprint(&baseline);

    for _ in 0..ITERATIONS {
        let exact = parse_with_resource_limits(
            &container,
            ParseOptions::default(),
            ResourceLimits {
                max_inflated_chunk_bytes: expanded.len(),
                ..ResourceLimits::default()
            },
        )?;
        if fingerprint(&exact) != baseline_fingerprint {
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
                    ..ResourceLimits::default()
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
            if fingerprint(&recovered) != baseline_fingerprint {
                return Err(format!("valid parse changed after {name}").into());
            }
        }
        results.push(json!({
            "name": name,
            "configured_limit_bytes": limit,
            "iterations": ITERATIONS,
            "error": expected_error.ok_or("missing resource rejection error")?,
            "valid_reparse_fingerprint": baseline_fingerprint.clone(),
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
        "valid_fingerprint": baseline_fingerprint,
        "case_count": results.len(),
        "cases": results,
    });
    fs::write(
        output,
        format!("{}\n", serde_json::to_string_pretty(&report)?),
    )?;
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
    let payload_bytes = file
        .chunks
        .iter()
        .map(|chunk| chunk.payload.len())
        .sum::<usize>();
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
