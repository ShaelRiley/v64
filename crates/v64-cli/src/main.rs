#![forbid(unsafe_code)]

use serde_json::json;
use std::collections::BTreeMap;
use std::env;
use std::error::Error;
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use v64_core::decoder::{DECODER_API_VERSION, Decoder};

const MAX_CLI_INPUT_BYTES: usize = v64_core::MAX_TOTAL_PAYLOAD_BYTES;

fn main() {
    if let Err(error) = run() {
        eprintln!("v64: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args_os();
    let _program = arguments.next();
    let Some(command) = arguments.next() else {
        return Err(usage().into());
    };

    if command == "--version" || command == "-V" {
        println!(
            "v64 {} (decoder API {})",
            env!("CARGO_PKG_VERSION"),
            DECODER_API_VERSION
        );
        return Ok(());
    }

    match command.to_str() {
        Some("inspect") => {
            let input = one_path(arguments, "v64 inspect INPUT.v64")?;
            inspect(&input)
        }
        Some("verify") => {
            let input = one_path(arguments, "v64 verify INPUT.v64")?;
            verify(&input)
        }
        Some("state-stream") => {
            let input = arguments
                .next()
                .ok_or("usage: v64 state-stream INPUT.v64 OUTPUT.bin")?;
            let output = arguments
                .next()
                .ok_or("usage: v64 state-stream INPUT.v64 OUTPUT.bin")?;
            if arguments.next().is_some() {
                return Err("usage: v64 state-stream INPUT.v64 OUTPUT.bin".into());
            }
            state_stream(Path::new(&input), Path::new(&output))
        }
        _ => Err(usage().into()),
    }
}

fn usage() -> &'static str {
    "usage: v64 <inspect|verify|state-stream> ..."
}

fn one_path(
    mut arguments: impl Iterator<Item = OsString>,
    command_usage: &'static str,
) -> Result<PathBuf, Box<dyn Error>> {
    let input = arguments.next().ok_or(command_usage)?;
    if arguments.next().is_some() {
        return Err(command_usage.into());
    }
    Ok(PathBuf::from(input))
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, Box<dyn Error>> {
    let file = File::open(path)?;
    let limit = u64::try_from(MAX_CLI_INPUT_BYTES)?;
    let mut reader = file.take(limit + 1);
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes)?;
    if bytes.len() > MAX_CLI_INPUT_BYTES {
        return Err(
            format!("input exceeds the stable CLI limit of {MAX_CLI_INPUT_BYTES} bytes").into(),
        );
    }
    Ok(bytes)
}

fn inspect(path: &Path) -> Result<(), Box<dyn Error>> {
    let bytes = read_bounded(path)?;
    let file = v64_core::parse(&bytes)?;
    let mut distribution = BTreeMap::<String, u32>::new();
    for chunk in &file.chunks {
        *distribution.entry(chunk.chunk_type.clone()).or_default() += 1;
    }
    let report = json!({
        "format": "V64-CLI-INSPECT-1",
        "decoderApiVersion": DECODER_API_VERSION,
        "fileBytes": bytes.len(),
        "version": {
            "major": file.header.version_major,
            "minor": file.header.version_minor,
        },
        "columns": file.header.columns,
        "rows": file.header.rows,
        "cadenceId": file.header.cadence.id,
        "frameTicks": file.header.cadence.frame_ticks,
        "paletteDepth": file.header.palette_depth,
        "durationTicks": file.header.duration_ticks,
        "chunkCount": file.header.chunk_count,
        "videoRecords": file.chunks.iter()
            .filter(|chunk| chunk.chunk_type == "VFRM" || chunk.chunk_type == "RPTF")
            .count(),
        "indexEntries": file.index.len(),
        "chunks": distribution,
    });
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn verify(path: &Path) -> Result<(), Box<dyn Error>> {
    let bytes = read_bounded(path)?;
    let mut decoder = Decoder::from_bytes(&bytes)?;
    let mut records = 0u32;
    let mut keyframes = 0u32;
    let mut repeats = 0u32;
    let mut final_timestamp = 0u64;
    let mut state_hash = 0xcbf2_9ce4_8422_2325u64;
    while let Some(info) = decoder.advance()? {
        let state = decoder
            .current_state()
            .ok_or("decoder advanced without exposing state")?;
        for byte in state {
            state_hash ^= u64::from(*byte);
            state_hash = state_hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        records = records
            .checked_add(1)
            .ok_or("video record count overflow")?;
        keyframes = keyframes
            .checked_add(u32::from(info.keyframe))
            .ok_or("keyframe count overflow")?;
        repeats = repeats
            .checked_add(u32::from(info.repeat))
            .ok_or("repeat count overflow")?;
        final_timestamp = info
            .timestamp
            .checked_add(info.duration)
            .ok_or("timeline end overflow")?;
    }
    let report = json!({
        "format": "V64-CLI-VERIFY-1",
        "decoderApiVersion": DECODER_API_VERSION,
        "valid": true,
        "columns": decoder.header().columns,
        "rows": decoder.header().rows,
        "durationTicks": decoder.header().duration_ticks,
        "videoRecords": records,
        "keyframes": keyframes,
        "repeats": repeats,
        "finalVideoTimestamp": final_timestamp,
        "stateStreamFnv1a64": format!("{state_hash:016x}"),
    });
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn state_stream(input: &Path, output: &Path) -> Result<(), Box<dyn Error>> {
    let bytes = read_bounded(input)?;
    let mut decoder = Decoder::from_bytes(&bytes)?;
    let mut temporary_name = output.as_os_str().to_os_string();
    temporary_name.push(".tmp");
    let temporary = PathBuf::from(temporary_name);

    let result = (|| -> Result<(), Box<dyn Error>> {
        let mut writer = BufWriter::new(File::create(&temporary)?);
        writer.write_all(b"V64GOLD1")?;
        writer.write_all(&decoder.header().columns.to_le_bytes())?;
        writer.write_all(&decoder.header().rows.to_le_bytes())?;
        writer.write_all(&decoder.video_record_count().to_le_bytes())?;
        let mut records = 0u32;
        while let Some(info) = decoder.advance()? {
            let state = decoder
                .current_state()
                .ok_or("decoder advanced without exposing state")?;
            writer.write_all(&info.timestamp.to_le_bytes())?;
            writer.write_all(&info.duration.to_le_bytes())?;
            writer.write_all(&[u8::from(info.keyframe), u8::from(info.repeat)])?;
            writer.write_all(&0u16.to_le_bytes())?;
            writer.write_all(&u32::try_from(state.len())?.to_le_bytes())?;
            writer.write_all(state)?;
            records = records
                .checked_add(1)
                .ok_or("video record count overflow")?;
        }
        if records != decoder.video_record_count() {
            return Err("decoded record count disagrees with container".into());
        }
        writer.flush()?;
        writer.get_ref().sync_all()?;
        Ok(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if output.exists() {
        fs::remove_file(output)?;
    }
    fs::rename(temporary, output)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_cli_input_limit_matches_the_c_abi_ceiling() {
        assert_eq!(MAX_CLI_INPUT_BYTES, 1_073_741_824);
    }

    #[test]
    fn command_usage_is_stable() {
        assert_eq!(usage(), "usage: v64 <inspect|verify|state-stream> ...");
    }
}
