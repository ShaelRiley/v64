#![no_main]

use libfuzzer_sys::fuzz_target;
use v64_core::frame::apply_frame_commands;

const PALETTE_DEPTHS: [usize; 14] = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 256];

fuzz_target!(|data: &[u8]| {
    if data.len() < 6 {
        return;
    }
    let columns = usize::from(u16::from_le_bytes([data[0], data[1]]));
    let rows = usize::from(u16::from_le_bytes([data[2], data[3]]));
    let palette_depth = PALETTE_DEPTHS[usize::from(data[4]) % PALETTE_DEPTHS.len()];
    let keyframe = data[5] & 1 != 0;
    let prior = columns
        .checked_mul(rows)
        .filter(|cells| columns <= 512 && rows <= 512 && *cells <= 262_144)
        .and_then(|cells| cells.checked_mul(3))
        .map(|length| vec![0; length]);
    let commands = &data[6..data.len().min(65_542)];
    let _ = apply_frame_commands(
        commands,
        (!keyframe).then_some(prior.as_deref()).flatten(),
        columns,
        rows,
        palette_depth,
        keyframe,
    );
});
