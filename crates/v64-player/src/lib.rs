#![forbid(unsafe_code)]

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

use v64_core::decoder::{Decoder, DecoderConfig, FrameInfo};
use v64_core::extensions::{ExtensionSummary, validate_extension_timelines};
use v64_core::renderer::{CANONICAL_GLYPH_BYTES, Raster, fnv1a64, render_rgba};
use v64_core::{ParseOptions, ResourceLimits};

pub const PLAYER_PROFILE_VERSION: u32 = 1;
pub const TICK_RATE: u64 = 60_000;
pub const MAX_PLAYER_INPUT_BYTES: usize = v64_core::MAX_TOTAL_PAYLOAD_BYTES;
pub const MAX_PLAYER_CHUNKS: u32 = 1_000_000;
pub const MAX_PLAYER_INFLATED_CHUNK_BYTES: usize = 256 * 1024 * 1024;
pub const DEFAULT_SCANLINE_STRENGTH_PERCENT: u8 = 18;
pub const DEFAULT_SCANLINE_PERIOD: i64 = 2;
pub const DEFAULT_SCANLINE_PHASE: i64 = 1;

pub const NORMATIVE_PALETTE_BYTES: &[u8; 768] =
    include_bytes!("../../../assets/palettes/v64-p256-1.rgb");
pub const LEGACY_PROOF_PALETTE_BYTES: &[u8; 768] =
    include_bytes!("../../../assets/palettes/v64-p256-candidate-1.rgb");

const CANONICAL_GLYPH_HASH: [u8; 32] = [
    0x9a, 0x75, 0x06, 0x27, 0x11, 0x50, 0x4d, 0xc9, 0xb2, 0xd4, 0x73, 0xcd, 0xc2, 0x61, 0xe0, 0xa8,
    0xe3, 0x4f, 0xf3, 0x49, 0xed, 0x9a, 0x8e, 0x1d, 0xc2, 0x93, 0x46, 0x7e, 0x92, 0x15, 0xda, 0x2b,
];
const NORMATIVE_PALETTE_HASH: [u8; 32] = [
    0xc0, 0x3d, 0x23, 0x14, 0x1e, 0xb3, 0x3b, 0x80, 0xd7, 0x9d, 0x1a, 0x7f, 0x31, 0x67, 0xee, 0xb1,
    0x8c, 0xcf, 0x1f, 0x4f, 0x0c, 0x0f, 0x81, 0x57, 0x2f, 0x26, 0x9a, 0xbd, 0x51, 0x31, 0x71, 0x05,
];
const LEGACY_PROOF_PALETTE_HASH: [u8; 32] = [
    0xf2, 0xb6, 0xae, 0x13, 0x2b, 0xc2, 0x69, 0xe1, 0x7e, 0x66, 0x37, 0x81, 0x84, 0xe6, 0x6f, 0x2d,
    0xfd, 0xf0, 0xa0, 0x79, 0xff, 0x02, 0x81, 0xfa, 0x69, 0x85, 0x81, 0x44, 0x25, 0x2f, 0xef, 0xb2,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlaybackRate {
    pub numerator: u32,
    pub denominator: u32,
}

impl PlaybackRate {
    pub const HALF: Self = Self {
        numerator: 1,
        denominator: 2,
    };
    pub const NORMAL: Self = Self {
        numerator: 1,
        denominator: 1,
    };
    pub const DOUBLE: Self = Self {
        numerator: 2,
        denominator: 1,
    };

    pub fn label(self) -> &'static str {
        match self {
            Self::HALF => "0.5x",
            Self::NORMAL => "1x",
            Self::DOUBLE => "2x",
            _ => "custom",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlayerPreferences {
    pub crt_scanlines: bool,
}

impl Default for PlayerPreferences {
    fn default() -> Self {
        Self {
            crt_scanlines: true,
        }
    }
}

impl PlayerPreferences {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > 4_096 {
            return Err("Player preference file exceeds 4096 bytes".to_owned());
        }
        let text = std::str::from_utf8(bytes)
            .map_err(|_| "Player preference file is not UTF-8".to_owned())?;
        let mut value = None;
        for line in text.lines() {
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let parsed = match line {
                "crt_scanlines=true" => true,
                "crt_scanlines=false" => false,
                _ => return Err("Unknown or invalid player preference".to_owned()),
            };
            if value.replace(parsed).is_some() {
                return Err("Duplicate crt_scanlines player preference".to_owned());
            }
        }
        Ok(Self {
            crt_scanlines: value.unwrap_or(true),
        })
    }

    pub fn load(path: &Path) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let mut reader = File::open(path)
            .map_err(|error| error.to_string())?
            .take(4_097);
        let mut bytes = Vec::new();
        reader
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        Self::parse(&bytes)
    }

    pub fn save(self, path: &Path) -> Result<(), String> {
        let parent = path
            .parent()
            .ok_or_else(|| "Player preference path has no parent".to_owned())?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let temporary = path.with_extension("tmp");
        let result = (|| -> Result<(), String> {
            let mut output = File::create(&temporary).map_err(|error| error.to_string())?;
            writeln!(output, "crt_scanlines={}", self.crt_scanlines)
                .map_err(|error| error.to_string())?;
            output.flush().map_err(|error| error.to_string())?;
            output.sync_all().map_err(|error| error.to_string())?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    }
}

#[derive(Debug)]
pub struct PlayerSession {
    decoder: Decoder,
    current: Option<FrameInfo>,
    raster: Option<Raster>,
    position_ticks: u64,
    paused: bool,
    rate: PlaybackRate,
    clock_remainder: u128,
    preferences: PlayerPreferences,
    extensions: ExtensionSummary,
    palette: &'static [u8; 768],
    palette_name: &'static str,
}

impl PlayerSession {
    pub fn from_bytes(bytes: &[u8], preferences: PlayerPreferences) -> Result<Self, String> {
        let config = DecoderConfig {
            parse_options: ParseOptions {
                expected_glyph_hash: Some(CANONICAL_GLYPH_HASH),
                expected_palette_hash: None,
            },
            resource_limits: ResourceLimits {
                max_inflated_chunk_bytes: MAX_PLAYER_INFLATED_CHUNK_BYTES,
                max_total_payload_bytes: MAX_PLAYER_INPUT_BYTES,
                max_chunks: MAX_PLAYER_CHUNKS,
            },
        };
        let decoder =
            Decoder::from_bytes_with_config(bytes, config).map_err(|error| error.to_string())?;
        let (palette, palette_name) = match decoder.header().palette_hash {
            NORMATIVE_PALETTE_HASH => (NORMATIVE_PALETTE_BYTES, "V64-P256-1"),
            LEGACY_PROOF_PALETTE_HASH => {
                (LEGACY_PROOF_PALETTE_BYTES, "V64-P256-CANDIDATE-1")
            }
            _ => return Err("Player does not recognize the declared palette hash".to_owned()),
        };
        let extensions = validate_extension_timelines(decoder.file())?;
        let mut session = Self {
            decoder,
            current: None,
            raster: None,
            position_ticks: 0,
            paused: false,
            rate: PlaybackRate::NORMAL,
            clock_remainder: 0,
            preferences,
            extensions,
            palette,
            palette_name,
        };
        session.seek(0)?;
        Ok(session)
    }

    pub fn duration_ticks(&self) -> u64 {
        self.decoder.header().duration_ticks
    }

    pub fn frame_ticks(&self) -> u32 {
        self.decoder.header().cadence.frame_ticks
    }

    pub fn video_record_count(&self) -> u32 {
        self.decoder.video_record_count()
    }

    pub fn columns(&self) -> u16 {
        self.decoder.header().columns
    }

    pub fn rows(&self) -> u16 {
        self.decoder.header().rows
    }

    pub fn position_ticks(&self) -> u64 {
        self.position_ticks
    }

    pub fn current_frame(&self) -> Option<FrameInfo> {
        self.current
    }

    pub fn raster(&self) -> Option<&Raster> {
        self.raster.as_ref()
    }

    pub fn paused(&self) -> bool {
        self.paused
    }

    pub fn rate(&self) -> PlaybackRate {
        self.rate
    }

    pub fn preferences(&self) -> PlayerPreferences {
        self.preferences
    }

    pub fn extensions(&self) -> ExtensionSummary {
        self.extensions
    }

    pub fn palette_name(&self) -> &'static str {
        self.palette_name
    }

    pub fn at_eof(&self) -> bool {
        self.position_ticks == self.duration_ticks()
    }

    pub fn toggle_pause(&mut self) {
        self.paused = !self.paused;
        self.clock_remainder = 0;
    }

    pub fn set_rate(&mut self, rate: PlaybackRate) -> Result<(), String> {
        if ![
            PlaybackRate::HALF,
            PlaybackRate::NORMAL,
            PlaybackRate::DOUBLE,
        ]
        .contains(&rate)
        {
            return Err("Unsupported playback rate".to_owned());
        }
        self.rate = rate;
        self.clock_remainder = 0;
        Ok(())
    }

    pub fn slower(&mut self) {
        self.rate = match self.rate {
            PlaybackRate::DOUBLE => PlaybackRate::NORMAL,
            _ => PlaybackRate::HALF,
        };
        self.clock_remainder = 0;
    }

    pub fn faster(&mut self) {
        self.rate = match self.rate {
            PlaybackRate::HALF => PlaybackRate::NORMAL,
            _ => PlaybackRate::DOUBLE,
        };
        self.clock_remainder = 0;
    }

    pub fn set_scanlines(&mut self, enabled: bool) {
        self.preferences.crt_scanlines = enabled;
    }

    pub fn toggle_scanlines(&mut self) {
        self.preferences.crt_scanlines = !self.preferences.crt_scanlines;
    }

    pub fn seek_relative(&mut self, delta_ticks: i64) -> Result<(), String> {
        let target = if delta_ticks.is_negative() {
            self.position_ticks
                .saturating_sub(delta_ticks.unsigned_abs())
        } else {
            self.position_ticks
                .saturating_add(delta_ticks.unsigned_abs())
                .min(self.duration_ticks())
        };
        self.seek(target)
    }

    pub fn seek(&mut self, target: u64) -> Result<(), String> {
        if target > self.duration_ticks() {
            return Err("Seek target exceeds the declared duration".to_owned());
        }
        self.clock_remainder = 0;
        if target == self.duration_ticks() {
            self.position_ticks = target;
            self.current = None;
            self.raster = None;
            return Ok(());
        }

        if self.current.is_some_and(|current| {
            current.timestamp <= target
                && target < current.timestamp.saturating_add(current.duration)
        }) {
            self.position_ticks = target;
            return Ok(());
        }

        let can_advance = self.current.is_some_and(|current| {
            target >= current.timestamp.saturating_add(current.duration)
                && target >= self.position_ticks
        });
        if !can_advance {
            self.decoder.reset_video();
            self.current = None;
            self.raster = None;
        }

        loop {
            let info = self
                .decoder
                .advance()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "Video timeline ended before the seek target".to_owned())?;
            let end = info
                .timestamp
                .checked_add(info.duration)
                .ok_or_else(|| "Video frame end overflow".to_owned())?;
            self.current = Some(info);
            if target < end {
                break;
            }
        }
        self.position_ticks = target;
        self.refresh_raster()
    }

    pub fn advance_wall_clock(&mut self, elapsed_nanoseconds: u64) -> Result<bool, String> {
        if self.paused || self.at_eof() || elapsed_nanoseconds == 0 {
            return Ok(false);
        }
        let numerator = u128::from(elapsed_nanoseconds)
            .checked_mul(u128::from(TICK_RATE))
            .and_then(|value| value.checked_mul(u128::from(self.rate.numerator)))
            .and_then(|value| value.checked_add(self.clock_remainder))
            .ok_or_else(|| "Playback clock overflow".to_owned())?;
        let denominator = 1_000_000_000u128
            .checked_mul(u128::from(self.rate.denominator))
            .ok_or_else(|| "Playback clock denominator overflow".to_owned())?;
        let elapsed_ticks = numerator / denominator;
        self.clock_remainder = numerator % denominator;
        if elapsed_ticks == 0 {
            return Ok(false);
        }
        let target = self
            .position_ticks
            .saturating_add(u64::try_from(elapsed_ticks).unwrap_or(u64::MAX))
            .min(self.duration_ticks());
        let prior_frame = self.current;
        let remainder = self.clock_remainder;
        self.seek(target)?;
        self.clock_remainder = remainder;
        Ok(self.current != prior_frame)
    }

    pub fn unfiltered_raster_hash(&self) -> Option<u64> {
        self.raster.as_ref().map(|raster| fnv1a64(&raster.rgba))
    }

    fn refresh_raster(&mut self) -> Result<(), String> {
        let state = self
            .decoder
            .current_state()
            .ok_or_else(|| "Decoder exposed no state for the current frame".to_owned())?;
        self.raster = Some(render_rgba(
            state,
            usize::from(self.decoder.header().columns),
            usize::from(self.decoder.header().rows),
            usize::from(self.decoder.header().palette_depth),
            CANONICAL_GLYPH_BYTES,
            self.palette,
        )?);
        Ok(())
    }
}

pub fn apply_crt_scanlines(
    rgba: &[u8],
    width: usize,
    height: usize,
    viewport_y: i64,
    enabled: bool,
) -> Result<Vec<u8>, String> {
    let expected = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Playback effect size overflow".to_owned())?;
    if width == 0 || height == 0 || rgba.len() != expected {
        return Err("Playback effect requires a complete RGBA image".to_owned());
    }
    let mut output = rgba.to_vec();
    if !enabled {
        return Ok(output);
    }
    for y in 0..height {
        let y_i64 = i64::try_from(y).map_err(|_| "Playback viewport height overflow".to_owned())?;
        if (viewport_y + y_i64).rem_euclid(DEFAULT_SCANLINE_PERIOD) != DEFAULT_SCANLINE_PHASE {
            continue;
        }
        let start = y
            .checked_mul(width)
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| "Playback effect row overflow".to_owned())?;
        let end = start
            .checked_add(width * 4)
            .ok_or_else(|| "Playback effect row overflow".to_owned())?;
        for pixel in output[start..end].chunks_exact_mut(4) {
            for channel in &mut pixel[..3] {
                *channel = ((u16::from(*channel) * 82 + 50) / 100) as u8;
            }
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROCEDURAL: &[u8] = include_bytes!("../../../tests/golden/procedural.v64");

    #[test]
    fn first_launch_defaults_to_scanlines_and_preferences_round_trip() {
        assert!(PlayerPreferences::default().crt_scanlines);
        assert!(PlayerPreferences::parse(b"").unwrap().crt_scanlines);
        assert!(
            !PlayerPreferences::parse(b"crt_scanlines=false\n")
                .unwrap()
                .crt_scanlines
        );
        assert!(PlayerPreferences::parse(b"crt_scanlines=maybe\n").is_err());
        assert!(PlayerPreferences::parse(b"crt_scanlines=true\ncrt_scanlines=false\n").is_err());
    }

    #[test]
    fn session_seeks_repeatedly_and_has_stable_eof() {
        let mut session = PlayerSession::from_bytes(PROCEDURAL, PlayerPreferences::default())
            .expect("golden player session should open");
        let first = session.unfiltered_raster_hash().unwrap();
        let frame = u64::from(session.frame_ticks());
        session.seek(frame * 8).unwrap();
        let eighth = session.unfiltered_raster_hash().unwrap();
        assert_ne!(first, eighth);
        session.seek(0).unwrap();
        assert_eq!(session.unfiltered_raster_hash(), Some(first));
        session.seek(frame * 8).unwrap();
        assert_eq!(session.unfiltered_raster_hash(), Some(eighth));
        session.seek(session.duration_ticks()).unwrap();
        assert!(session.at_eof());
        assert!(session.raster().is_none());
        session.seek(0).unwrap();
        assert_eq!(session.unfiltered_raster_hash(), Some(first));
    }

    #[test]
    fn pause_and_fixed_rates_control_the_integer_clock() {
        let mut session = PlayerSession::from_bytes(PROCEDURAL, PlayerPreferences::default())
            .expect("golden player session should open");
        session.toggle_pause();
        assert!(!session.advance_wall_clock(1_000_000_000).unwrap());
        assert_eq!(session.position_ticks(), 0);
        session.toggle_pause();
        session.set_rate(PlaybackRate::HALF).unwrap();
        session.advance_wall_clock(1_000_000_000).unwrap();
        assert_eq!(session.position_ticks(), 30_000);
        session.set_rate(PlaybackRate::DOUBLE).unwrap();
        session.advance_wall_clock(500_000_000).unwrap();
        assert_eq!(session.position_ticks(), 90_000);
    }

    #[test]
    fn scanlines_are_presentation_only_and_viewport_anchored() {
        let rgba = [100, 101, 255, 255, 25, 50, 75, 255];
        let disabled = apply_crt_scanlines(&rgba, 1, 2, 0, false).unwrap();
        let enabled = apply_crt_scanlines(&rgba, 1, 2, 0, true).unwrap();
        assert_eq!(disabled, rgba);
        assert_eq!(&enabled[..4], &rgba[..4]);
        assert_eq!(&enabled[4..], &[21, 41, 62, 255]);
        let shifted = apply_crt_scanlines(&rgba, 1, 2, 1, true).unwrap();
        assert_eq!(&shifted[..4], &[82, 83, 209, 255]);
        assert_eq!(&shifted[4..], &rgba[4..]);
        assert_eq!(rgba, [100, 101, 255, 255, 25, 50, 75, 255]);
    }
}
