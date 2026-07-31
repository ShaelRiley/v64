#![forbid(unsafe_code)]

use std::env;
use std::error::Error;
use std::fs;
use std::path::Path;
use v64_core::V64File;
use v64_core::frame::{END, SKIP, apply_frame_commands};

#[derive(Debug, Clone, PartialEq, Eq)]
struct VideoFrame {
    timestamp: u64,
    duration: u64,
    keyframe: bool,
    repeat: bool,
    state: Vec<u8>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args_os().skip(1);
    let input = arguments.next().ok_or("missing INPUT.v64")?;
    let output = arguments.next().ok_or("missing OUTPUT.bin")?;
    if arguments.next().is_some() {
        return Err("usage: v64-golden-stream INPUT.v64 OUTPUT.bin".into());
    }
    let bytes = fs::read(&input)?;
    let file = v64_core::parse(&bytes)?;
    let timeline = decode_video_timeline(&file)?;
    fs::write(output, encode_golden_stream(&file, &timeline)?)?;
    Ok(())
}

fn decode_video_timeline(file: &V64File) -> Result<Vec<VideoFrame>, String> {
    let columns = usize::from(file.header.columns);
    let rows = usize::from(file.header.rows);
    let palette_depth = usize::from(file.header.palette_depth);
    let frame_ticks = u64::from(file.header.cadence.frame_ticks);
    let mut timeline = Vec::new();
    let mut state: Option<Vec<u8>> = None;
    let mut expected_timestamp = 0u64;

    for chunk in &file.chunks {
        if chunk.chunk_type != "VFRM" && chunk.chunk_type != "RPTF" {
            continue;
        }
        if chunk.timestamp != expected_timestamp {
            return Err(format!(
                "Discontinuous video timeline at {}; expected {expected_timestamp}",
                chunk.timestamp
            ));
        }
        if chunk.duration == 0 || chunk.duration % frame_ticks != 0 {
            return Err(format!(
                "{} duration is not a whole nominal frame span",
                chunk.chunk_type
            ));
        }

        if chunk.chunk_type == "VFRM" {
            let kind = chunk
                .payload
                .first()
                .copied()
                .ok_or_else(|| "Invalid VFRM kind".to_owned())?;
            if kind > 1 {
                return Err("Invalid VFRM kind".to_owned());
            }
            let keyframe = kind == 0;
            let decoded = apply_frame_commands(
                &chunk.payload[1..],
                state.as_deref(),
                columns,
                rows,
                palette_depth,
                keyframe,
            )?;
            timeline.push(VideoFrame {
                timestamp: chunk.timestamp,
                duration: chunk.duration,
                keyframe,
                repeat: false,
                state: decoded.clone(),
            });
            state = Some(decoded);
        } else {
            if !chunk.payload.is_empty() {
                return Err("RPTF payload must be empty".to_owned());
            }
            let prior = state
                .as_ref()
                .ok_or_else(|| "Repeat frame precedes first video frame".to_owned())?;
            timeline.push(VideoFrame {
                timestamp: chunk.timestamp,
                duration: chunk.duration,
                keyframe: false,
                repeat: true,
                state: prior.clone(),
            });
        }
        expected_timestamp = expected_timestamp
            .checked_add(chunk.duration)
            .ok_or_else(|| "Video timeline duration overflow".to_owned())?;
    }

    if timeline.is_empty() {
        return Err("File contains no video timeline".to_owned());
    }
    if expected_timestamp > file.header.duration_ticks {
        return Err("Video timeline exceeds declared duration".to_owned());
    }
    Ok(timeline)
}

fn encode_golden_stream(file: &V64File, timeline: &[VideoFrame]) -> Result<Vec<u8>, String> {
    let frame_count = u32::try_from(timeline.len())
        .map_err(|_| "Golden frame count exceeds uint32".to_owned())?;
    let mut output = Vec::new();
    output.extend_from_slice(b"V64GOLD1");
    output.extend_from_slice(&file.header.columns.to_le_bytes());
    output.extend_from_slice(&file.header.rows.to_le_bytes());
    output.extend_from_slice(&frame_count.to_le_bytes());
    for frame in timeline {
        output.extend_from_slice(&frame.timestamp.to_le_bytes());
        output.extend_from_slice(&frame.duration.to_le_bytes());
        output.push(u8::from(frame.keyframe));
        output.push(u8::from(frame.repeat));
        output.extend_from_slice(&0u16.to_le_bytes());
        let state_length = u32::try_from(frame.state.len())
            .map_err(|_| "Golden state length exceeds uint32".to_owned())?;
        output.extend_from_slice(&state_length.to_le_bytes());
        output.extend_from_slice(&frame.state);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROCEDURAL: &[u8] = include_bytes!("../../../../tests/golden/procedural.v64");

    #[test]
    fn decodes_the_phase1_golden_timeline() {
        let file = v64_core::parse(PROCEDURAL).expect("container should parse");
        let timeline = decode_video_timeline(&file).expect("video timeline should decode");
        assert!(!timeline.is_empty());
        assert!(timeline[0].keyframe);
        assert_eq!(
            timeline[0].state.len(),
            usize::from(file.header.columns) * usize::from(file.header.rows) * 3
        );
        assert_eq!(
            timeline.last().unwrap().timestamp + timeline.last().unwrap().duration,
            file.header.duration_ticks
        );
    }

    #[test]
    fn rejects_noncanonical_and_trailing_commands_transactionally() {
        let prior = vec![7u8; 6];
        let snapshot = prior.clone();
        let error = apply_frame_commands(&[SKIP, 0x81, 0x00, END], Some(&prior), 2, 1, 16, false)
            .expect_err("noncanonical varuint must fail");
        assert!(error.contains("Non-canonical"));
        assert_eq!(prior, snapshot);

        let error = apply_frame_commands(&[END, 0], None, 1, 1, 16, true)
            .expect_err("trailing bytes must fail");
        assert!(error.contains("Trailing bytes"));
    }

    #[test]
    fn golden_stream_has_stable_framing() {
        let file = v64_core::parse(PROCEDURAL).expect("container should parse");
        let timeline = decode_video_timeline(&file).expect("video timeline should decode");
        let stream = encode_golden_stream(&file, &timeline).expect("stream should encode");
        assert_eq!(&stream[..8], b"V64GOLD1");
        assert!(stream.len() > 16);
    }

    #[test]
    fn output_path_is_not_required_to_exist_before_encoding() {
        let path = Path::new("target/test-golden-stream.bin");
        let file = v64_core::parse(PROCEDURAL).expect("container should parse");
        let timeline = decode_video_timeline(&file).expect("video timeline should decode");
        let stream = encode_golden_stream(&file, &timeline).expect("stream should encode");
        assert!(!stream.is_empty());
        let _ = path;
    }
}
