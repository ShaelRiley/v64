#![forbid(unsafe_code)]

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
    fs::write(
        output,
        format!("{}\n", serde_json::to_string_pretty(&report)?),
    )?;
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join("")
}
