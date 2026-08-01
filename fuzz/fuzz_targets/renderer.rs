#![no_main]

use libfuzzer_sys::fuzz_target;
use v64_core::renderer::{CANONICAL_GLYPH_BYTES, checked_raster_layout, render_rgba};

const PALETTE_DEPTHS: [usize; 14] = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 256];
const MAX_FUZZ_RGBA_BYTES: usize = 1 << 20;

fuzz_target!(|data: &[u8]| {
    if data.len() < 5 {
        return;
    }
    let columns = usize::from(u16::from_le_bytes([data[0], data[1]]));
    let rows = usize::from(u16::from_le_bytes([data[2], data[3]]));
    let palette_depth = PALETTE_DEPTHS[usize::from(data[4]) % PALETTE_DEPTHS.len()];
    let Ok(layout) = checked_raster_layout(columns, rows) else {
        return;
    };
    if layout.rgba_length > MAX_FUZZ_RGBA_BYTES {
        return;
    }
    let mut cells = vec![0; layout.state_length];
    for (target, source) in cells.iter_mut().zip(data[5..].iter().copied()) {
        *target = source;
    }
    let mut palette = vec![0; palette_depth * 3];
    for (index, byte) in palette.iter_mut().enumerate() {
        *byte = data.get(5 + index).copied().unwrap_or(index as u8);
    }
    let _ = render_rgba(
        &cells,
        columns,
        rows,
        palette_depth,
        CANONICAL_GLYPH_BYTES,
        &palette,
    );
});
