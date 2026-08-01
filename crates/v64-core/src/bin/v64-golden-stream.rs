#![forbid(unsafe_code)]

use std::env;
use std::error::Error;
use std::fs;
use v64_core::decoder::Decoder;

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args_os().skip(1);
    let input = arguments.next().ok_or("missing INPUT.v64")?;
    let output = arguments.next().ok_or("missing OUTPUT.bin")?;
    if arguments.next().is_some() {
        return Err("usage: v64-golden-stream INPUT.v64 OUTPUT.bin".into());
    }
    let bytes = fs::read(input)?;
    let mut decoder = Decoder::from_bytes(&bytes)?;
    fs::write(output, encode_golden_stream(&mut decoder)?)?;
    Ok(())
}

fn encode_golden_stream(decoder: &mut Decoder) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut output = Vec::new();
    output.extend_from_slice(b"V64GOLD1");
    output.extend_from_slice(&decoder.header().columns.to_le_bytes());
    output.extend_from_slice(&decoder.header().rows.to_le_bytes());
    output.extend_from_slice(&decoder.video_record_count().to_le_bytes());
    let mut records = 0u32;
    while let Some(info) = decoder.advance()? {
        let state = decoder
            .current_state()
            .ok_or("decoder advanced without exposing state")?;
        output.extend_from_slice(&info.timestamp.to_le_bytes());
        output.extend_from_slice(&info.duration.to_le_bytes());
        output.push(u8::from(info.keyframe));
        output.push(u8::from(info.repeat));
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(&u32::try_from(state.len())?.to_le_bytes());
        output.extend_from_slice(state);
        records = records
            .checked_add(1)
            .ok_or("video record count overflow")?;
    }
    if records != decoder.video_record_count() {
        return Err("decoded record count disagrees with container".into());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use v64_core::frame::{END, SKIP, apply_frame_commands};

    const PROCEDURAL: &[u8] = include_bytes!("../../../../tests/golden/procedural.v64");

    #[test]
    fn stable_decoder_produces_the_phase1_golden_stream() {
        let mut decoder = Decoder::from_bytes(PROCEDURAL).expect("container should parse");
        let stream = encode_golden_stream(&mut decoder).expect("stream should encode");
        assert_eq!(&stream[..8], b"V64GOLD1");
        assert_eq!(
            decoder.current_frame(),
            None,
            "the stream must consume the complete timeline"
        );
        assert!(stream.len() > 16);
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
}
