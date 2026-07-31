#[path = "../renderer.rs"]
mod renderer;

use std::env;
use std::error::Error;
use std::fs;
use std::io::{Error as IoError, ErrorKind};

fn main() -> Result<(), Box<dyn Error>> {
    let arguments = env::args().collect::<Vec<_>>();
    if arguments.len() != 8 {
        return Err(IoError::new(
            ErrorKind::InvalidInput,
            "usage: v64-renderer-golden <cells.bin> <glyphs.bin> <palette.rgb> <columns> <rows> <palette-depth> <output.rgba>",
        )
        .into());
    }

    let cells = fs::read(&arguments[1])?;
    let glyphs = fs::read(&arguments[2])?;
    let palette = fs::read(&arguments[3])?;
    let columns = parse_usize(&arguments[4], "columns")?;
    let rows = parse_usize(&arguments[5], "rows")?;
    let palette_depth = parse_usize(&arguments[6], "palette depth")?;
    let raster = renderer::render_rgba(&cells, columns, rows, palette_depth, &glyphs, &palette)
        .map_err(|message| IoError::new(ErrorKind::InvalidData, message))?;
    fs::write(&arguments[7], &raster.rgba)?;

    println!(
        "{{\"width\":{},\"height\":{},\"bytes\":{},\"fnv1a64\":\"{:016x}\"}}",
        raster.width,
        raster.height,
        raster.rgba.len(),
        renderer::fnv1a64(&raster.rgba)
    );
    Ok(())
}

fn parse_usize(value: &str, label: &str) -> Result<usize, IoError> {
    value.parse::<usize>().map_err(|_| {
        IoError::new(
            ErrorKind::InvalidInput,
            format!("invalid renderer {label}: {value}"),
        )
    })
}
