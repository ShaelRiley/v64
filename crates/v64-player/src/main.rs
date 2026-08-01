#![forbid(unsafe_code)]

use std::env;
use std::error::Error;
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use sdl2::event::{Event, WindowEvent};
use sdl2::keyboard::Keycode;
use sdl2::mouse::MouseButton;
use sdl2::pixels::{Color, PixelFormatEnum};
use sdl2::rect::Rect;
use sdl2::render::{BlendMode, Canvas};
use sdl2::video::Window;
use serde_json::json;
use v64_player::{
    MAX_PLAYER_INPUT_BYTES, PLAYER_PROFILE_VERSION, PlayerPreferences, PlayerSession, TICK_RATE,
    apply_crt_scanlines,
};

const MENU_HEIGHT: i32 = 24;
const MENU_WIDTH: i32 = 72;
const MENU_ITEM_WIDTH: u32 = 220;
const MENU_ITEM_HEIGHT: u32 = 32;
const SEEK_STEP_TICKS: i64 = 5 * TICK_RATE as i64;

#[derive(Debug)]
struct Options {
    input: PathBuf,
    preferences: PathBuf,
    headless_report: Option<PathBuf>,
    smoke_presents: Option<u32>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("v64-player: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let arguments = env::args_os().skip(1).collect::<Vec<_>>();
    if arguments.len() == 1 && (arguments[0] == "--version" || arguments[0] == "-V") {
        println!(
            "v64-player {} (player profile {})",
            env!("CARGO_PKG_VERSION"),
            PLAYER_PROFILE_VERSION
        );
        return Ok(());
    }
    let options = parse_options(&arguments)?;
    let bytes = read_bounded(&options.input)?;
    let preferences = PlayerPreferences::load(&options.preferences)?;
    let session = PlayerSession::from_bytes(&bytes, preferences)?;

    if let Some(output) = options.headless_report {
        return write_headless_report(session, &output).map_err(Into::into);
    }
    run_windowed(session, &options.preferences, options.smoke_presents).map_err(Into::into)
}

fn usage() -> &'static str {
    "usage: v64-player [--preferences PATH] [--headless-report OUTPUT.json] [--smoke-presents N] INPUT.v64"
}

fn parse_options(arguments: &[OsString]) -> Result<Options, String> {
    let mut input = None;
    let mut preferences = None;
    let mut headless_report = None;
    let mut smoke_presents = None;
    let mut index = 0usize;
    while index < arguments.len() {
        match arguments[index].to_str() {
            Some("--preferences") => {
                index += 1;
                preferences = Some(PathBuf::from(arguments.get(index).ok_or_else(|| usage())?));
            }
            Some("--headless-report") => {
                index += 1;
                headless_report = Some(PathBuf::from(arguments.get(index).ok_or_else(|| usage())?));
            }
            Some("--smoke-presents") => {
                index += 1;
                let raw = arguments
                    .get(index)
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| usage())?;
                let count = raw
                    .parse::<u32>()
                    .map_err(|_| "--smoke-presents requires an unsigned integer".to_owned())?;
                if count == 0 || count > 10_000 {
                    return Err("--smoke-presents must be between 1 and 10000".to_owned());
                }
                smoke_presents = Some(count);
            }
            Some(value) if value.starts_with('-') => return Err(usage().to_owned()),
            _ => {
                if input.replace(PathBuf::from(&arguments[index])).is_some() {
                    return Err(usage().to_owned());
                }
            }
        }
        index += 1;
    }
    let input = input.ok_or_else(|| usage().to_owned())?;
    Ok(Options {
        input,
        preferences: preferences.unwrap_or_else(default_preferences_path),
        headless_report,
        smoke_presents,
    })
}

fn default_preferences_path() -> PathBuf {
    if let Some(path) = env::var_os("V64_PLAYER_CONFIG") {
        return PathBuf::from(path);
    }
    #[cfg(target_os = "windows")]
    if let Some(directory) = env::var_os("APPDATA") {
        return PathBuf::from(directory)
            .join("Video64")
            .join("player.conf");
    }
    #[cfg(target_os = "macos")]
    if let Some(directory) = env::var_os("HOME") {
        return PathBuf::from(directory)
            .join("Library")
            .join("Application Support")
            .join("Video64")
            .join("player.conf");
    }
    if let Some(directory) = env::var_os("XDG_CONFIG_HOME") {
        return PathBuf::from(directory).join("v64").join("player.conf");
    }
    env::var_os("HOME").map_or_else(
        || PathBuf::from("v64-player.conf"),
        |directory| {
            PathBuf::from(directory)
                .join(".config")
                .join("v64")
                .join("player.conf")
        },
    )
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, Box<dyn Error>> {
    let limit = u64::try_from(MAX_PLAYER_INPUT_BYTES)?;
    let mut reader = File::open(path)?.take(limit + 1);
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes)?;
    if bytes.len() > MAX_PLAYER_INPUT_BYTES {
        return Err(format!("input exceeds the player limit of {MAX_PLAYER_INPUT_BYTES} bytes").into());
    }
    Ok(bytes)
}

fn write_headless_report(mut session: PlayerSession, output: &Path) -> Result<(), String> {
    let frame_ticks = u64::from(session.frame_ticks());
    let seek_order = [0u64, 8, 23, 8, 0];
    let mut seek_hashes = Vec::new();
    for frame in seek_order {
        session.seek(frame * frame_ticks)?;
        seek_hashes.push(format!(
            "{:016x}",
            session
                .unfiltered_raster_hash()
                .ok_or_else(|| "Seek conformance produced no raster".to_owned())?
        ));
    }
    let first = session
        .raster()
        .ok_or_else(|| "Headless conformance produced no raster".to_owned())?;
    let scanlined = apply_crt_scanlines(&first.rgba, first.width, first.height, 7, true)?;
    let scanline_hash = format!("{:016x}", v64_core::renderer::fnv1a64(&scanlined));
    let unfiltered_hash = format!("{:016x}", v64_core::renderer::fnv1a64(&first.rgba));

    session.toggle_pause();
    session.advance_wall_clock(1_000_000_000)?;
    let paused_position = session.position_ticks();
    session.toggle_pause();
    session.slower();
    session.advance_wall_clock(1_000_000_000)?;
    let half_rate_position = session.position_ticks();
    session.faster();
    session.faster();
    session.advance_wall_clock(500_000_000)?;
    let double_rate_position = session.position_ticks();

    session.seek(session.duration_ticks())?;
    let eof = session.at_eof() && session.raster().is_none();
    session.seek(0)?;
    let eof_recovery_hash = format!(
        "{:016x}",
        session
            .unfiltered_raster_hash()
            .ok_or_else(|| "EOF recovery produced no raster".to_owned())?
    );
    let extensions = session.extensions();
    let report = json!({
        "format": "V64-NATIVE-PLAYER-1",
        "playerProfileVersion": PLAYER_PROFILE_VERSION,
        "bounded": {
            "maxInputBytes": MAX_PLAYER_INPUT_BYTES,
            "maxChunks": v64_player::MAX_PLAYER_CHUNKS,
            "maxInflatedChunkBytes": v64_player::MAX_PLAYER_INFLATED_CHUNK_BYTES,
        },
        "video": {
            "columns": session.columns(),
            "rows": session.rows(),
            "frameTicks": session.frame_ticks(),
            "durationTicks": session.duration_ticks(),
            "records": session.video_record_count(),
        },
        "controls": {
            "pausedPositionTicks": paused_position,
            "halfRatePositionTicks": half_rate_position,
            "doubleRatePositionTicks": double_rate_position,
            "eof": eof,
            "eofRecoveryHash": eof_recovery_hash,
            "repeatedSeekOrder": seek_order,
            "repeatedSeekHashes": seek_hashes,
        },
        "scanlines": {
            "defaultEnabled": PlayerPreferences::default().crt_scanlines,
            "menuPath": "View/CRT Scanlines",
            "keyboardToggle": "C",
            "strength": 0.18,
            "period": 2,
            "phase": 1,
            "viewportY": 7,
            "unfilteredFnv1a64": unfiltered_hash,
            "filteredFnv1a64": scanline_hash,
        },
        "extensions": {
            "subtitleChunks": extensions.subtitle_chunks,
            "subtitleFrames": extensions.subtitle_frames,
            "subtitleEntries": extensions.subtitle_entries,
            "audioRuns": extensions.audio_runs,
            "silenceRuns": extensions.silence_runs,
            "audioPackets": extensions.audio_packets,
            "validatedBeforePlayback": true,
        },
    });
    let encoded = format!(
        "{}\n",
        serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?
    );
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(output, encoded).map_err(|error| error.to_string())
}

fn run_windowed(
    mut session: PlayerSession,
    preference_path: &Path,
    smoke_presents: Option<u32>,
) -> Result<(), String> {
    let initial = session
        .raster()
        .ok_or_else(|| "Video timeline has no first raster".to_owned())?;
    let source_width = u32::try_from(initial.width)
        .map_err(|_| "Player source width exceeds uint32".to_owned())?;
    let source_height = u32::try_from(initial.height)
        .map_err(|_| "Player source height exceeds uint32".to_owned())?;
    let window_width = source_width.saturating_mul(2).clamp(640, 1280);
    let window_height = source_height
        .saturating_mul(2)
        .saturating_add(MENU_HEIGHT as u32)
        .clamp(480, 800);

    let sdl = sdl2::init().map_err(|error| error.to_string())?;
    let video = sdl.video().map_err(|error| error.to_string())?;
    let window = video
        .window("Video 64", window_width, window_height)
        .position_centered()
        .resizable()
        .build()
        .map_err(|error| error.to_string())?;
    let mut canvas = window
        .into_canvas()
        .software()
        .build()
        .map_err(|error| error.to_string())?;
    canvas.set_blend_mode(BlendMode::Blend);
    let texture_creator = canvas.texture_creator();
    let mut texture = texture_creator
        .create_texture_streaming(PixelFormatEnum::RGBA32, source_width, source_height)
        .map_err(|error| error.to_string())?;
    update_texture(&mut texture, &session)?;
    let mut event_pump = sdl.event_pump().map_err(|error| error.to_string())?;
    let mut menu_open = false;
    let mut last_clock = Instant::now();
    let mut presented = 0u32;

    'running: loop {
        let now = Instant::now();
        let elapsed = now.saturating_duration_since(last_clock);
        last_clock = now;
        let elapsed_ns = u64::try_from(elapsed.as_nanos()).unwrap_or(u64::MAX);
        if session.advance_wall_clock(elapsed_ns)? {
            if session.raster().is_some() {
                update_texture(&mut texture, &session)?;
            }
        }

        for event in event_pump.poll_iter() {
            match event {
                Event::Quit { .. }
                | Event::KeyDown {
                    keycode: Some(Keycode::Escape),
                    ..
                } => break 'running,
                Event::KeyDown {
                    keycode: Some(Keycode::Space),
                    repeat: false,
                    ..
                } => session.toggle_pause(),
                Event::KeyDown {
                    keycode: Some(Keycode::C),
                    repeat: false,
                    ..
                } => toggle_scanlines(&mut session, preference_path)?,
                Event::KeyDown {
                    keycode: Some(Keycode::Left),
                    repeat: false,
                    ..
                } => {
                    session.seek_relative(-SEEK_STEP_TICKS)?;
                    update_texture(&mut texture, &session)?;
                }
                Event::KeyDown {
                    keycode: Some(Keycode::Right),
                    repeat: false,
                    ..
                } => {
                    session.seek_relative(SEEK_STEP_TICKS)?;
                    if session.raster().is_some() {
                        update_texture(&mut texture, &session)?;
                    }
                }
                Event::KeyDown {
                    keycode: Some(Keycode::Home),
                    repeat: false,
                    ..
                } => {
                    session.seek(0)?;
                    update_texture(&mut texture, &session)?;
                }
                Event::KeyDown {
                    keycode: Some(Keycode::End),
                    repeat: false,
                    ..
                } => session.seek(session.duration_ticks())?,
                Event::KeyDown {
                    keycode: Some(Keycode::Up),
                    repeat: false,
                    ..
                } => session.faster(),
                Event::KeyDown {
                    keycode: Some(Keycode::Down),
                    repeat: false,
                    ..
                } => session.slower(),
                Event::MouseButtonDown {
                    mouse_btn: MouseButton::Left,
                    x,
                    y,
                    ..
                } if y < MENU_HEIGHT && x < MENU_WIDTH => menu_open = !menu_open,
                Event::MouseButtonDown {
                    mouse_btn: MouseButton::Left,
                    x,
                    y,
                    ..
                } if menu_open
                    && (MENU_HEIGHT..MENU_HEIGHT + MENU_ITEM_HEIGHT as i32).contains(&y)
                    && (0..MENU_ITEM_WIDTH as i32).contains(&x) =>
                {
                    toggle_scanlines(&mut session, preference_path)?;
                    menu_open = false;
                }
                Event::Window {
                    win_event: WindowEvent::FocusLost,
                    ..
                } => menu_open = false,
                _ => {}
            }
        }

        draw(&mut canvas, &texture, &session, menu_open)?;
        presented = presented.saturating_add(1);
        if smoke_presents.is_some_and(|limit| presented >= limit) {
            break;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    Ok(())
}

fn update_texture(
    texture: &mut sdl2::render::Texture<'_>,
    session: &PlayerSession,
) -> Result<(), String> {
    let raster = session
        .raster()
        .ok_or_else(|| "Current playback position has no raster".to_owned())?;
    texture
        .update(None, &raster.rgba, raster.width * 4)
        .map_err(|error| error.to_string())
}

fn toggle_scanlines(session: &mut PlayerSession, preference_path: &Path) -> Result<(), String> {
    session.toggle_scanlines();
    session.preferences().save(preference_path)
}

fn draw(
    canvas: &mut Canvas<Window>,
    texture: &sdl2::render::Texture<'_>,
    session: &PlayerSession,
    menu_open: bool,
) -> Result<(), String> {
    let (window_width, window_height) = canvas.output_size().map_err(|error| error.to_string())?;
    canvas.set_draw_color(Color::RGB(10, 12, 16));
    canvas.clear();
    canvas.set_draw_color(Color::RGB(35, 39, 48));
    canvas
        .fill_rect(Rect::new(0, 0, window_width, MENU_HEIGHT as u32))
        .map_err(|error| error.to_string())?;
    canvas.set_draw_color(if menu_open {
        Color::RGB(70, 78, 94)
    } else {
        Color::RGB(50, 56, 68)
    });
    canvas
        .fill_rect(Rect::new(0, 0, MENU_WIDTH as u32, MENU_HEIGHT as u32))
        .map_err(|error| error.to_string())?;
    draw_text(canvas, 8, 5, "VIEW", Color::RGB(235, 238, 244))?;

    if let Some(raster) = session.raster() {
        let viewport = Rect::new(
            0,
            MENU_HEIGHT,
            window_width,
            window_height.saturating_sub(MENU_HEIGHT as u32),
        );
        let destination = letterbox(
            u32::try_from(raster.width).map_err(|_| "Raster width exceeds uint32".to_owned())?,
            u32::try_from(raster.height).map_err(|_| "Raster height exceeds uint32".to_owned())?,
            viewport,
        )?;
        canvas
            .copy(texture, None, Some(destination))
            .map_err(|error| error.to_string())?;
        if session.preferences().crt_scanlines {
            canvas.set_draw_color(Color::RGBA(0, 0, 0, 46));
            canvas.set_clip_rect(Some(destination));
            let bottom = destination
                .y()
                .saturating_add(i32::try_from(destination.height()).unwrap_or(i32::MAX));
            for y in destination.y()..bottom {
                if i64::from(y).rem_euclid(2) == 1 {
                    canvas
                        .draw_line(
                            (destination.x(), y),
                            (
                                destination.x().saturating_add(
                                    i32::try_from(destination.width()).unwrap_or(i32::MAX) - 1,
                                ),
                                y,
                            ),
                        )
                        .map_err(|error| error.to_string())?;
                }
            }
            canvas.set_clip_rect(None);
        }
    }

    if menu_open {
        canvas.set_draw_color(Color::RGBA(26, 30, 38, 245));
        canvas
            .fill_rect(Rect::new(
                0,
                MENU_HEIGHT,
                MENU_ITEM_WIDTH,
                MENU_ITEM_HEIGHT,
            ))
            .map_err(|error| error.to_string())?;
        let label = if session.preferences().crt_scanlines {
            "CRT SCANLINES  ON"
        } else {
            "CRT SCANLINES  OFF"
        };
        draw_text(
            canvas,
            10,
            MENU_HEIGHT + 9,
            label,
            Color::RGB(240, 242, 247),
        )?;
    }

    let state = if session.at_eof() {
        "EOF"
    } else if session.paused() {
        "PAUSED"
    } else {
        "PLAYING"
    };
    let title = format!(
        "Video 64 — {} — {} — {} / {}",
        state,
        session.rate().label(),
        format_time(session.position_ticks()),
        format_time(session.duration_ticks())
    );
    canvas
        .window_mut()
        .set_title(&title)
        .map_err(|error| error.to_string())?;
    canvas.present();
    Ok(())
}

fn letterbox(source_width: u32, source_height: u32, viewport: Rect) -> Result<Rect, String> {
    if source_width == 0 || source_height == 0 || viewport.width() == 0 || viewport.height() == 0 {
        return Err("Cannot fit an empty playback viewport".to_owned());
    }
    let width_limited = u64::from(viewport.width()) * u64::from(source_height)
        <= u64::from(viewport.height()) * u64::from(source_width);
    let (width, height) = if width_limited {
        let height = u64::from(viewport.width())
            .checked_mul(u64::from(source_height))
            .ok_or_else(|| "Playback viewport multiplication overflow".to_owned())?
            / u64::from(source_width);
        (viewport.width(), u32::try_from(height.max(1)).map_err(|_| "Viewport height overflow")?)
    } else {
        let width = u64::from(viewport.height())
            .checked_mul(u64::from(source_width))
            .ok_or_else(|| "Playback viewport multiplication overflow".to_owned())?
            / u64::from(source_height);
        (u32::try_from(width.max(1)).map_err(|_| "Viewport width overflow")?, viewport.height())
    };
    let x = viewport.x().saturating_add(
        i32::try_from((viewport.width() - width) / 2).map_err(|_| "Viewport x overflow")?,
    );
    let y = viewport.y().saturating_add(
        i32::try_from((viewport.height() - height) / 2).map_err(|_| "Viewport y overflow")?,
    );
    Ok(Rect::new(x, y, width, height))
}

fn format_time(ticks: u64) -> String {
    let seconds = ticks / TICK_RATE;
    format!("{:02}:{:02}", seconds / 60, seconds % 60)
}

fn draw_text(
    canvas: &mut Canvas<Window>,
    x: i32,
    y: i32,
    text: &str,
    color: Color,
) -> Result<(), String> {
    canvas.set_draw_color(color);
    let mut cursor = x;
    for character in text.chars() {
        let rows = glyph_rows(character);
        for (row, bits) in rows.iter().copied().enumerate() {
            for column in 0..5u8 {
                if bits & (0x10 >> column) == 0 {
                    continue;
                }
                canvas
                    .fill_rect(Rect::new(
                        cursor + i32::from(column) * 2,
                        y + i32::try_from(row).unwrap_or(0) * 2,
                        2,
                        2,
                    ))
                    .map_err(|error| error.to_string())?;
            }
        }
        cursor = cursor.saturating_add(12);
    }
    Ok(())
}

fn glyph_rows(character: char) -> [u8; 7] {
    match character.to_ascii_uppercase() {
        'A' => [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
        'C' => [0x0f, 0x10, 0x10, 0x10, 0x10, 0x10, 0x0f],
        'E' => [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
        'F' => [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
        'I' => [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1f],
        'L' => [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
        'N' => [0x11, 0x19, 0x19, 0x15, 0x13, 0x13, 0x11],
        'O' => [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
        'R' => [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
        'S' => [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
        'T' => [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
        'V' => [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
        'W' => [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
        _ => [0; 7],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn option_parser_is_bounded_and_unambiguous() {
        let options = parse_options(&[
            "--preferences".into(),
            "prefs.conf".into(),
            "--headless-report".into(),
            "report.json".into(),
            "input.v64".into(),
        ])
        .unwrap();
        assert_eq!(options.input, PathBuf::from("input.v64"));
        assert_eq!(options.preferences, PathBuf::from("prefs.conf"));
        assert!(parse_options(&["a.v64".into(), "b.v64".into()]).is_err());
        assert!(parse_options(&["--smoke-presents".into(), "0".into(), "a.v64".into()]).is_err());
    }

    #[test]
    fn letterbox_uses_checked_integer_aspect_ratio() {
        assert_eq!(
            letterbox(320, 176, Rect::new(0, 24, 640, 456)).unwrap(),
            Rect::new(0, 76, 640, 352)
        );
        assert!(letterbox(0, 1, Rect::new(0, 0, 1, 1)).is_err());
    }
}
