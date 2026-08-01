#![forbid(unsafe_code)]

use serde_json::json;
use std::env;
use std::error::Error;
use std::fs;
use v64_core::extensions::{
    AudioLimits, MAX_AURN_PACKET_COUNT, MAX_AURN_PACKET_DATA_BYTES,
    MAX_SUBTITLE_CANONICAL_ENTRIES, MAX_SUBTITLE_FRAMES, SubtitleLimits,
    decode_aurn_payload, decode_sm2,
};
use v64_core::frame::{END, FILL_RECT, REPEAT_TOKEN, apply_frame_commands};
use v64_core::grammar_b;
use v64_core::renderer::{MAX_COLUMNS, MAX_ROWS, checked_raster_layout};
use v64_core::{
    MAX_CELLS, MAX_CHUNKS, MAX_INFLATED_CHUNK, MAX_STORED_CHUNK,
    MAX_TOTAL_PAYLOAD_BYTES, ParseOptions, ResourceLimits, parse, parse_with_resource_limits,
};

const ITERATIONS: usize = 64;
const PROCEDURAL: &[u8] = include_bytes!("../../../../tests/golden/procedural.v64");

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args_os().skip(1);
    let output = arguments.next().ok_or("missing OUTPUT.json")?;
    if arguments.next().is_some() {
        return Err("usage: v64-allocation-gate OUTPUT.json".into());
    }

    let maximum_layout = checked_raster_layout(MAX_COLUMNS, MAX_ROWS)?;
    if maximum_layout.cell_count != MAX_CELLS
        || maximum_layout.state_length != 786_432
        || maximum_layout.rgba_length != 134_217_728
    {
        return Err("maximum renderer layout changed".into());
    }
    for (columns, rows) in [(usize::MAX, 2), (MAX_COLUMNS + 1, 1), (1, MAX_ROWS + 1)] {
        checked_raster_layout(columns, rows)
            .expect_err("overflowing or oversized renderer layout must fail before allocation");
    }

    let mut maximum_keyframe = vec![REPEAT_TOKEN];
    write_varuint(MAX_CELLS as u32, &mut maximum_keyframe);
    maximum_keyframe.extend_from_slice(&[63, 255, 255, END]);
    let maximum_state = apply_frame_commands(
        &maximum_keyframe,
        None,
        MAX_COLUMNS,
        MAX_ROWS,
        256,
        true,
    )?;
    if maximum_state.len() != maximum_layout.state_length {
        return Err("maximum Phase-1 state length changed".into());
    }

    let mut pathological = Vec::new();
    for _ in 0..4 {
        pathological.extend_from_slice(&[FILL_RECT, 0, 0, 1, 1, 0, 0, 0]);
    }
    pathological.push(END);
    let pathological_error = apply_frame_commands(&pathological, None, 1, 1, 2, true)
        .expect_err("non-advancing rectangles must still hit the command-count bound");
    if !pathological_error.contains("command count") {
        return Err("pathological command stream hit the wrong rejection".into());
    }

    let grammar_prior = [1, 2, 3, 4, 5, 6];
    let grammar_valid = [grammar_b::SET_GLYPH, 7, grammar_b::SET_COLOR_PAIR, 0x98, END];
    let grammar_expected = grammar_b::apply_packed_commands(
        &grammar_valid,
        Some(&grammar_prior),
        2,
        1,
        16,
        false,
    )?;
    let grammar_hostile = [grammar_b::SET_GLYPH, 7, 0xff];

    let phase_prior = vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    let phase_recovery = [1, 1, REPEAT_TOKEN, 1, 12, 13, 14, 1, 2, END];
    let phase_expected = apply_frame_commands(
        &phase_recovery,
        Some(&phase_prior),
        4,
        1,
        16,
        false,
    )?;
    let phase_hostile = [REPEAT_TOKEN, 1, 2, 3, 4, END, 0];
    for _ in 0..ITERATIONS {
        let phase_snapshot = phase_prior.clone();
        apply_frame_commands(&phase_hostile, Some(&phase_prior), 4, 1, 16, false)
            .expect_err("malformed Phase-1 stream must fail");
        if phase_prior != phase_snapshot
            || apply_frame_commands(
                &phase_recovery,
                Some(&phase_prior),
                4,
                1,
                16,
                false,
            )? != phase_expected
        {
            return Err("Phase-1 recovery changed after malformed input".into());
        }

        grammar_b::apply_packed_commands(
            &grammar_hostile,
            Some(&grammar_prior),
            2,
            1,
            16,
            false,
        )
        .expect_err("malformed Grammar B stream must fail");
        if grammar_b::apply_packed_commands(
            &grammar_valid,
            Some(&grammar_prior),
            2,
            1,
            16,
            false,
        )? != grammar_expected
        {
            return Err("Grammar B recovery changed after malformed input".into());
        }
    }

    let valid_fingerprint = fingerprint(&parse(PROCEDURAL)?);
    let total_payload_error = parse_with_resource_limits(
        PROCEDURAL,
        ParseOptions::default(),
        ResourceLimits {
            max_inflated_chunk_bytes: 1 << 20,
            max_total_payload_bytes: 1,
            max_chunks: 4_096,
        },
    )
    .expect_err("one-byte aggregate payload budget must reject the valid fixture")
    .to_string();
    let mut excessive_length = PROCEDURAL.to_vec();
    excessive_length[116..120].copy_from_slice(&u32::MAX.to_le_bytes());
    let excessive_length_error = parse(&excessive_length)
        .expect_err("excessive declared stored length must fail")
        .to_string();
    let mut excessive_chunks = PROCEDURAL.to_vec();
    excessive_chunks[112..116].copy_from_slice(&u32::MAX.to_le_bytes());
    let excessive_chunks_error = parse(&excessive_chunks)
        .expect_err("excessive declared chunk count must fail")
        .to_string();
    for _ in 0..ITERATIONS {
        if fingerprint(&parse(PROCEDURAL)?) != valid_fingerprint {
            return Err("valid parser recovery fingerprint changed".into());
        }
    }

    let valid_sm2 = valid_sm2();
    let subtitle = decode_sm2(
        &valid_sm2,
        SubtitleLimits {
            expected_frames: Some(2),
            max_frames: 2,
            max_canonical_entries: 2,
        },
    )?;
    if subtitle.frames.len() != 2 || subtitle.canonical_entries != 2 {
        return Err("valid SM2 resource accounting changed".into());
    }
    let subtitle_entry_error = decode_sm2(
        &valid_sm2,
        SubtitleLimits {
            expected_frames: Some(2),
            max_frames: 2,
            max_canonical_entries: 1,
        },
    )
    .expect_err("one-entry canonical budget must reject two decoded entries");
    let mut subtitle_bomb = valid_sm2;
    subtitle_bomb[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
    let subtitle_frame_error = decode_sm2(&subtitle_bomb, SubtitleLimits::default())
        .expect_err("excessive declared subtitle frames must fail before expansion");

    let valid_aurn = valid_aurn();
    let audio = decode_aurn_payload(&valid_aurn, 0, 600, AudioLimits::default())?;
    if audio.packets.len() != 1 || audio.packet_data_bytes != 1 {
        return Err("valid AURN accounting changed".into());
    }
    let audio_timing_error = decode_aurn_payload(&valid_aurn, 1, 600, AudioLimits::default())
        .expect_err("misaligned AURN timestamp must fail");
    let mut audio_bomb = valid_aurn;
    audio_bomb[24..28].copy_from_slice(&u32::MAX.to_le_bytes());
    let audio_packet_error = decode_aurn_payload(&audio_bomb, 0, 600, AudioLimits::default())
        .expect_err("excessive declared audio packets must fail before allocation");

    let report = json!({
        "format": "V64-ALLOCATION-REGRESSION-1",
        "iterations_per_recovery_case": ITERATIONS,
        "container": {
            "compiled_max_chunks": MAX_CHUNKS,
            "compiled_max_stored_chunk_bytes": MAX_STORED_CHUNK,
            "compiled_max_inflated_chunk_bytes": MAX_INFLATED_CHUNK,
            "compiled_max_total_payload_bytes": MAX_TOTAL_PAYLOAD_BYTES,
            "valid_recovery_fingerprint": valid_fingerprint,
            "aggregate_limit_error": total_payload_error,
            "excessive_length_error": excessive_length_error,
            "excessive_chunk_count_error": excessive_chunks_error,
        },
        "frame_state": {
            "maximum_cells": MAX_CELLS,
            "maximum_committed_state_bytes": maximum_state.len(),
            "maximum_logical_keyframe_touched_flags": MAX_CELLS,
            "pathological_command_error": pathological_error,
            "phase1_recovery": true,
            "grammar_b_recovery": true,
        },
        "renderer": {
            "maximum_width": maximum_layout.width,
            "maximum_height": maximum_layout.height,
            "maximum_rgba_bytes": maximum_layout.rgba_length,
            "overflow_and_outside_boundaries_rejected": true,
        },
        "subtitles": {
            "compiled_max_frames": MAX_SUBTITLE_FRAMES,
            "compiled_max_canonical_entries": MAX_SUBTITLE_CANONICAL_ENTRIES,
            "valid_canonical_entries": subtitle.canonical_entries,
            "entry_budget_error": subtitle_entry_error,
            "frame_declaration_error": subtitle_frame_error,
        },
        "audio": {
            "compiled_max_packets": MAX_AURN_PACKET_COUNT,
            "compiled_max_packet_data_bytes": MAX_AURN_PACKET_DATA_BYTES,
            "valid_packets": audio.packets.len(),
            "timing_error": audio_timing_error,
            "packet_declaration_error": audio_packet_error,
        },
        "wasm_accessor_boundaries": {
            "last_valid_index": 32_767,
            "first_invalid_index": 32_768,
            "invalid_sentinel": 256,
            "verified_by_workspace_tests_and_fuzz_target": true,
        },
    });
    fs::write(output, format!("{}\n", serde_json::to_string_pretty(&report)?))?;
    Ok(())
}

fn write_varuint(mut value: u32, output: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        output.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn valid_sm2() -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"SM2\0");
    bytes.extend_from_slice(&2u32.to_le_bytes());
    bytes.extend_from_slice(&2u32.to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&0u16.to_le_bytes());
    bytes.extend_from_slice(&[0x01, 0x01, 0x01, 0x01, 0x00]);
    bytes.extend_from_slice(&[0xaa; 16]);
    bytes.extend_from_slice(&[0x00, 0x01]);
    bytes
}

fn valid_aurn() -> Vec<u8> {
    let mut payload = vec![0; 37];
    payload[0] = 1;
    payload[1] = 1;
    payload[4..8].copy_from_slice(&48_000u32.to_le_bytes());
    payload[16..20].copy_from_slice(&480u32.to_le_bytes());
    payload[20..24].copy_from_slice(&480u32.to_le_bytes());
    payload[24..28].copy_from_slice(&1u32.to_le_bytes());
    payload[28..32].copy_from_slice(&1u32.to_le_bytes());
    payload[32..34].copy_from_slice(&1u16.to_le_bytes());
    payload[34..36].copy_from_slice(&480u16.to_le_bytes());
    payload[36] = 0;
    payload
}

fn fingerprint(file: &v64_core::V64File) -> String {
    format!(
        "{}:{}:{}:{}x{}",
        file.header.duration_ticks,
        file.chunks.len(),
        file.index.len(),
        file.header.columns,
        file.header.rows
    )
}
