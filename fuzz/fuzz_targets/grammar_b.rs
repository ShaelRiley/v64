#![no_main]

use libfuzzer_sys::fuzz_target;
use v64_core::grammar_b::apply_packed_commands;

fuzz_target!(|data: &[u8]| {
    if data.len() < 6 {
        return;
    }
    let columns = usize::from(u16::from_le_bytes([data[0], data[1]]));
    let rows = usize::from(u16::from_le_bytes([data[2], data[3]]));
    let palette_depth = usize::from(data[4]).saturating_add(2).min(256);
    let keyframe = data[5] & 1 != 0;
    let prior = columns
        .checked_mul(rows)
        .filter(|cells| columns <= 512 && rows <= 512 && *cells <= 262_144)
        .and_then(|cells| cells.checked_mul(3))
        .map(|length| vec![0; length]);
    let commands = &data[6..data.len().min(65_542)];
    let _ = apply_packed_commands(
        commands,
        (!keyframe).then_some(prior.as_deref()).flatten(),
        columns,
        rows,
        palette_depth,
        keyframe,
    );
});
