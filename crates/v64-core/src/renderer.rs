pub const CELL_WIDTH: usize = 8;
pub const CELL_HEIGHT: usize = 16;
pub const GLYPH_COUNT: usize = 64;
pub const GLYPH_BYTES_PER_CELL: usize = CELL_HEIGHT;
pub const MAX_COLUMNS: usize = 512;
pub const MAX_ROWS: usize = 512;
pub const MAX_CELLS: usize = 262_144;

const LEGAL_PALETTE_DEPTHS: [usize; 14] = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 256];

pub const CANONICAL_GLYPH_BYTES: &[u8; GLYPH_COUNT * GLYPH_BYTES_PER_CELL] =
    include_bytes!("../../../assets/glyphs/video64-v1.bin");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Raster {
    pub width: usize,
    pub height: usize,
    pub rgba: Vec<u8>,
}

pub fn render_rgba(
    cells: &[u8],
    columns: usize,
    rows: usize,
    palette_depth: usize,
    glyph_bytes: &[u8],
    palette_bytes: &[u8],
) -> Result<Raster, String> {
    if columns == 0 || rows == 0 || columns > MAX_COLUMNS || rows > MAX_ROWS {
        return Err("Invalid or oversized renderer grid".to_owned());
    }
    let cell_count = columns
        .checked_mul(rows)
        .ok_or_else(|| "Renderer cell-count overflow".to_owned())?;
    if cell_count > MAX_CELLS {
        return Err("Invalid or oversized renderer grid".to_owned());
    }
    let expected_cells = cell_count
        .checked_mul(3)
        .ok_or_else(|| "Renderer cell-state length overflow".to_owned())?;
    if cells.len() != expected_cells {
        return Err("Cell state length does not match renderer grid".to_owned());
    }
    if glyph_bytes.len() != GLYPH_COUNT * GLYPH_BYTES_PER_CELL {
        return Err("Canonical glyph asset has the wrong byte length".to_owned());
    }
    if !LEGAL_PALETTE_DEPTHS.contains(&palette_depth) {
        return Err("Unsupported renderer palette depth".to_owned());
    }
    let required_palette_bytes = palette_depth
        .checked_mul(3)
        .ok_or_else(|| "Renderer palette length overflow".to_owned())?;
    if palette_bytes.len() < required_palette_bytes {
        return Err("Palette asset is shorter than the declared depth".to_owned());
    }

    let width = columns
        .checked_mul(CELL_WIDTH)
        .ok_or_else(|| "Renderer width overflow".to_owned())?;
    let height = rows
        .checked_mul(CELL_HEIGHT)
        .ok_or_else(|| "Renderer height overflow".to_owned())?;
    let output_length = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Renderer output length overflow".to_owned())?;
    let mut rgba = vec![0; output_length];

    for cell in 0..cell_count {
        let token_offset = cell * 3;
        let glyph = usize::from(cells[token_offset]);
        let foreground = usize::from(cells[token_offset + 1]);
        let background = usize::from(cells[token_offset + 2]);
        if glyph >= GLYPH_COUNT {
            return Err(format!("Glyph index exceeds canonical set at cell {cell}"));
        }
        if foreground >= palette_depth || background >= palette_depth {
            return Err(format!("Palette index exceeds declared depth at cell {cell}"));
        }

        let cell_x = cell % columns;
        let cell_y = cell / columns;
        let foreground_offset = foreground * 3;
        let background_offset = background * 3;
        let glyph_offset = glyph * GLYPH_BYTES_PER_CELL;

        for pixel_y in 0..CELL_HEIGHT {
            let mask = glyph_bytes[glyph_offset + pixel_y];
            let raster_y = cell_y * CELL_HEIGHT + pixel_y;
            for pixel_x in 0..CELL_WIDTH {
                let color_offset = if mask & (0x80 >> pixel_x) != 0 {
                    foreground_offset
                } else {
                    background_offset
                };
                let raster_x = cell_x * CELL_WIDTH + pixel_x;
                let output_offset = (raster_y * width + raster_x) * 4;
                rgba[output_offset..output_offset + 3]
                    .copy_from_slice(&palette_bytes[color_offset..color_offset + 3]);
                rgba[output_offset + 3] = 255;
            }
        }
    }

    Ok(Raster {
        width,
        height,
        rgba,
    })
}

pub fn conformance_palette() -> Vec<u8> {
    let mut palette = Vec::with_capacity(256 * 3);
    for index in 0u16..256 {
        let value = index as u8;
        palette.push(value);
        palette.push(value.wrapping_mul(73).wrapping_add(19));
        palette.push(value.wrapping_mul(151).wrapping_add(47));
    }
    palette
}

pub fn conformance_cells() -> Vec<u8> {
    let mut cells = Vec::with_capacity(GLYPH_COUNT * 3);
    for glyph in 0u8..GLYPH_COUNT as u8 {
        cells.push(glyph);
        cells.push(glyph.wrapping_mul(37).wrapping_add(3));
        cells.push(glyph.wrapping_mul(91).wrapping_add(17));
    }
    cells
}

pub fn conformance_raster() -> Result<Raster, String> {
    render_rgba(
        &conformance_cells(),
        8,
        8,
        256,
        CANONICAL_GLYPH_BYTES,
        &conformance_palette(),
    )
}

pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_foreground_background_and_alpha_exactly() {
        let mut glyphs = vec![0; GLYPH_COUNT * GLYPH_BYTES_PER_CELL];
        glyphs[0] = 0x80;
        let palette = [1, 2, 3, 10, 20, 30];
        let raster = render_rgba(&[0, 1, 0], 1, 1, 2, &glyphs, &palette)
            .expect("one-cell raster must render");
        assert_eq!(raster.width, 8);
        assert_eq!(raster.height, 16);
        assert_eq!(&raster.rgba[0..4], &[10, 20, 30, 255]);
        assert_eq!(&raster.rgba[4..8], &[1, 2, 3, 255]);
        assert_eq!(&raster.rgba[8 * 4..8 * 4 + 4], &[1, 2, 3, 255]);
        assert!(raster.rgba.chunks_exact(4).all(|pixel| pixel[3] == 255));
    }

    #[test]
    fn rejects_invalid_assets_dimensions_and_tokens() {
        let palette = conformance_palette();
        assert!(render_rgba(&[], 0, 1, 256, CANONICAL_GLYPH_BYTES, &palette).is_err());
        assert!(render_rgba(&[0, 0, 0], 1, 1, 256, &[], &palette).is_err());
        assert!(render_rgba(&[64, 0, 0], 1, 1, 256, CANONICAL_GLYPH_BYTES, &palette).is_err());
        assert!(render_rgba(&[0, 16, 0], 1, 1, 16, CANONICAL_GLYPH_BYTES, &palette).is_err());
        assert!(render_rgba(&[0, 0, 0], 1, 1, 5, CANONICAL_GLYPH_BYTES, &palette).is_err());
    }

    #[test]
    fn conformance_fixture_is_repeatable_and_complete() {
        let first = conformance_raster().expect("conformance raster must render");
        let second = conformance_raster().expect("conformance raster must render twice");
        assert_eq!(first, second);
        assert_eq!(first.width, 64);
        assert_eq!(first.height, 128);
        assert_eq!(first.rgba.len(), 32_768);
        assert_ne!(fnv1a64(&first.rgba), 0);
    }
}
