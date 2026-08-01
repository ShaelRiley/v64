#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use std::env;
use std::error::Error;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use v64_player::{
    AUDIO_SAMPLE_RATE, MAX_PLAYER_AUDIO_PCM_BYTES, MAX_PLAYER_INPUT_BYTES, PlaybackRate,
    PlayerPreferences, PlayerSession, TICK_RATE, fnv1a64_pcm,
};

const FEATURE_LENGTH_SECONDS: u64 = 30 * 60;
const FEATURE_LENGTH_TICKS: u64 = FEATURE_LENGTH_SECONDS * TICK_RATE;
const NANOS_PER_SECOND: u128 = 1_000_000_000;
const CLOCK_PATTERN_NS: [u64; 7] = [
    16_666_667,
    16_666_666,
    7_000_001,
    33_333_333,
    250_000_003,
    1_234_567_891,
    999_999_937,
];

#[derive(Debug)]
struct Options {
    input: PathBuf,
    output: PathBuf,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("v64-av-sync-gate: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let options = parse_options(env::args().skip(1).collect())?;
    let bytes = read_bounded(&options.input)?;
    let mut session = PlayerSession::from_bytes(&bytes, PlayerPreferences::default())?;
    if session.duration_ticks() < FEATURE_LENGTH_TICKS {
        return Err(format!(
            "feature-length gate requires at least {FEATURE_LENGTH_SECONDS} seconds"
        )
        .into());
    }
    let audio = session
        .audio()
        .ok_or("feature-length gate requires an AURN/SILN audio timeline")?;
    let expected_samples = floor_samples_from_ticks(session.duration_ticks())?;
    if audio.sample_count() != expected_samples {
        return Err("decoded audio sample count disagrees with the declared duration".into());
    }
    if audio.byte_count() > MAX_PLAYER_AUDIO_PCM_BYTES {
        return Err("decoded audio exceeds the player PCM ceiling".into());
    }

    let audio_samples = audio.sample_count();
    let audio_bytes = audio.byte_count();
    let audio_hash = format!("{:016x}", audio.fnv1a64());
    let extensions = session.extensions();

    let clock = run_clock_simulation(&mut session)?;
    let seeks = run_seek_conformance(&mut session)?;
    let controls = run_control_conformance(&mut session)?;

    session.seek(0)?;
    session.set_rate(PlaybackRate::NORMAL)?;
    session.advance_wall_clock(FEATURE_LENGTH_SECONDS * 1_000_000_000)?;
    let single_chunk_position = session.position_ticks();
    let single_chunk_sample = session
        .audio()
        .ok_or("audio timeline disappeared")?
        .sample_index_at_ticks(single_chunk_position);
    if single_chunk_position != session.duration_ticks()
        || single_chunk_sample != audio_samples
        || !session.at_eof()
    {
        return Err("single-chunk feature-length clock simulation did not reach exact EOF".into());
    }

    if clock.max_absolute_tick_drift != 0 || clock.max_absolute_sample_drift != 0 {
        return Err("feature-length clock simulation accumulated drift".into());
    }

    let report = json!({
        "format": "V64-AV-SYNC-1",
        "evidenceModel": "accelerated deterministic integer-clock simulation",
        "realTimeSleepRequired": false,
        "hardwareAudioSchedulerMeasured": false,
        "input": {
            "bytes": bytes.len(),
            "durationTicks": session.duration_ticks(),
            "durationSeconds": session.duration_ticks() / TICK_RATE,
            "columns": session.columns(),
            "rows": session.rows(),
            "frameTicks": session.frame_ticks(),
            "videoRecords": session.video_record_count(),
        },
        "audio": {
            "sampleRate": AUDIO_SAMPLE_RATE,
            "channels": 1,
            "samples": audio_samples,
            "bytes": audio_bytes,
            "pcmCeilingBytes": MAX_PLAYER_AUDIO_PCM_BYTES,
            "ceilingUtilizationBasisPoints": audio_bytes * 10_000 / MAX_PLAYER_AUDIO_PCM_BYTES,
            "pcmFnv1a64": audio_hash,
            "runs": extensions.audio_runs,
            "silenceRuns": extensions.silence_runs,
            "packets": extensions.audio_packets,
        },
        "clock": {
            "tickRate": TICK_RATE,
            "algorithm": "u128 rational accumulation with retained remainder",
            "incrementPatternNanoseconds": CLOCK_PATTERN_NS,
            "checkpoints": clock.checkpoints,
            "increments": clock.increments,
            "maxAbsoluteTickDrift": clock.max_absolute_tick_drift,
            "maxAbsoluteSampleDrift": clock.max_absolute_sample_drift,
            "singleChunkPositionTicks": single_chunk_position,
            "singleChunkSampleIndex": single_chunk_sample,
            "chunkingInvariant": single_chunk_position == session.duration_ticks()
                && single_chunk_sample == audio_samples,
        },
        "seeks": seeks,
        "controls": controls,
        "result": {
            "featureLength": true,
            "exactEof": true,
            "zeroArithmeticTickDrift": true,
            "zeroTimelineSampleDrift": true,
            "repeatedSeekStable": true,
            "boundedPcm": true,
        },
        "limitations": [
            "The gate proves deterministic player-clock, video-record, and PCM timeline alignment without waiting thirty wall-clock minutes.",
            "Operating-system and physical-device scheduling drift remains platform qualification work."
        ]
    });

    if let Some(parent) = options.output.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    fs::write(
        options.output,
        format!("{}\n", serde_json::to_string_pretty(&report)?),
    )?;
    Ok(())
}

#[derive(Debug)]
struct ClockEvidence {
    checkpoints: Vec<Value>,
    increments: u64,
    max_absolute_tick_drift: u64,
    max_absolute_sample_drift: u64,
}

fn run_clock_simulation(session: &mut PlayerSession) -> Result<ClockEvidence, String> {
    session.seek(0)?;
    session.set_rate(PlaybackRate::NORMAL)?;
    let duration_ns =
        u128::from(session.duration_ticks()) * NANOS_PER_SECOND / u128::from(TICK_RATE);
    let checkpoints_ns = [
        123_456_789_123u128,
        300 * NANOS_PER_SECOND,
        900 * NANOS_PER_SECOND,
        1_500 * NANOS_PER_SECOND,
        1_799 * NANOS_PER_SECOND + 500_000_000,
        duration_ns,
    ];
    if checkpoints_ns
        .iter()
        .any(|checkpoint| *checkpoint > duration_ns)
    {
        return Err("feature-length checkpoint exceeds the input duration".to_owned());
    }

    let mut wall_ns = 0u128;
    let mut pattern_index = 0usize;
    let mut increments = 0u64;
    let mut checkpoints = Vec::new();
    let mut max_tick_drift = 0u64;
    let mut max_sample_drift = 0u64;

    for target_ns in checkpoints_ns {
        while wall_ns < target_ns {
            let remaining = target_ns - wall_ns;
            let step = remaining.min(u128::from(
                CLOCK_PATTERN_NS[pattern_index % CLOCK_PATTERN_NS.len()],
            ));
            session.advance_wall_clock(
                u64::try_from(step).map_err(|_| "clock increment exceeds uint64")?,
            )?;
            wall_ns += step;
            pattern_index += 1;
            increments = increments.saturating_add(1);
        }
        let expected_ticks =
            reference_ticks(wall_ns, PlaybackRate::NORMAL).min(session.duration_ticks());
        let actual_ticks = session.position_ticks();
        let expected_sample = floor_samples_from_ticks(expected_ticks)?;
        let audio = session.audio().ok_or("audio timeline disappeared")?;
        let actual_sample = audio.sample_index_at_ticks(actual_ticks);
        let tick_drift = absolute_difference(actual_ticks, expected_ticks);
        let sample_drift = absolute_difference_usize(actual_sample, expected_sample);
        max_tick_drift = max_tick_drift.max(tick_drift);
        max_sample_drift = max_sample_drift.max(sample_drift);
        checkpoints.push(checkpoint_record(
            session,
            wall_ns,
            expected_ticks,
            expected_sample,
            tick_drift,
            sample_drift,
        )?);
    }

    if !session.at_eof() || session.raster().is_some() {
        return Err(
            "irregular feature-length clock simulation did not reach stable EOF".to_owned(),
        );
    }
    Ok(ClockEvidence {
        checkpoints,
        increments,
        max_absolute_tick_drift: max_tick_drift,
        max_absolute_sample_drift: max_sample_drift,
    })
}

fn checkpoint_record(
    session: &PlayerSession,
    wall_ns: u128,
    expected_ticks: u64,
    expected_sample: usize,
    tick_drift: u64,
    sample_drift: u64,
) -> Result<Value, String> {
    let actual_ticks = session.position_ticks();
    let audio = session.audio().ok_or("audio timeline disappeared")?;
    let actual_sample = audio.sample_index_at_ticks(actual_ticks);
    let end = actual_sample
        .saturating_add(usize::try_from(AUDIO_SAMPLE_RATE).unwrap_or(48_000))
        .min(audio.sample_count());
    let window_hash = format!("{:016x}", fnv1a64_pcm(&audio.samples()[actual_sample..end]));
    let frame = session.current_frame().map(|frame| {
        json!({
            "timestamp": frame.timestamp,
            "duration": frame.duration,
            "containsPosition": frame.timestamp <= actual_ticks
                && actual_ticks < frame.timestamp.saturating_add(frame.duration),
        })
    });
    Ok(json!({
        "wallNanoseconds": wall_ns.to_string(),
        "expectedTicks": expected_ticks,
        "actualTicks": actual_ticks,
        "absoluteTickDrift": tick_drift,
        "expectedSampleIndex": expected_sample,
        "actualSampleIndex": actual_sample,
        "absoluteSampleDrift": sample_drift,
        "frame": frame,
        "rasterFnv1a64": session.unfiltered_raster_hash().map(|hash| format!("{hash:016x}")),
        "oneSecondPcmWindowFnv1a64": window_hash,
        "eof": session.at_eof(),
    }))
}

fn run_seek_conformance(session: &mut PlayerSession) -> Result<Value, String> {
    let targets_seconds = [0u64, 1_740, 60, 900, 300, 1_740, 0, 1_799, 900];
    let mut records = Vec::new();
    let mut fingerprints = BTreeMap::<u64, String>::new();
    for seconds in targets_seconds {
        let target = seconds
            .checked_mul(TICK_RATE)
            .ok_or("seek target overflow")?;
        session.seek(target)?;
        let record = seek_record(session, target)?;
        let fingerprint = record
            .get("fingerprint")
            .and_then(Value::as_str)
            .ok_or("seek fingerprint is missing")?
            .to_owned();
        if let Some(prior) = fingerprints.insert(target, fingerprint.clone()) {
            if prior != fingerprint {
                return Err(
                    "repeated feature-length seek produced a different fingerprint".to_owned(),
                );
            }
        }
        records.push(record);
    }

    session.seek(session.duration_ticks())?;
    let eof_sample = session
        .audio()
        .ok_or("audio timeline disappeared")?
        .sample_index_at_ticks(session.position_ticks());
    let eof = json!({
        "positionTicks": session.position_ticks(),
        "sampleIndex": eof_sample,
        "atEof": session.at_eof(),
        "rasterAbsent": session.raster().is_none(),
    });
    if !session.at_eof() || session.raster().is_some() {
        return Err("feature-length seek to EOF was unstable".to_owned());
    }

    let recovery_target = 900 * TICK_RATE;
    session.seek(recovery_target)?;
    let recovery = seek_record(session, recovery_target)?;
    let prior = fingerprints
        .get(&recovery_target)
        .ok_or("missing prior recovery target fingerprint")?;
    if recovery.get("fingerprint").and_then(Value::as_str) != Some(prior.as_str()) {
        return Err("feature-length EOF recovery changed the seek fingerprint".to_owned());
    }

    Ok(json!({
        "targetsSeconds": targets_seconds,
        "records": records,
        "uniqueTargets": fingerprints.len(),
        "repeatedTargetsStable": true,
        "eof": eof,
        "recovery": recovery,
    }))
}

fn seek_record(session: &PlayerSession, target: u64) -> Result<Value, String> {
    if session.position_ticks() != target {
        return Err("seek did not land on the requested tick".to_owned());
    }
    let audio = session.audio().ok_or("audio timeline disappeared")?;
    let expected_sample = floor_samples_from_ticks(target)?;
    let actual_sample = audio.sample_index_at_ticks(target);
    if actual_sample != expected_sample {
        return Err("seek sample index disagrees with the timeline mapping".to_owned());
    }
    let frame = session
        .current_frame()
        .ok_or("non-EOF seek produced no video record")?;
    if !(frame.timestamp <= target && target < frame.timestamp.saturating_add(frame.duration)) {
        return Err("seek video record does not contain the requested tick".to_owned());
    }
    let raster_hash = session
        .unfiltered_raster_hash()
        .ok_or("non-EOF seek produced no raster")?;
    let fingerprint = format!(
        "{target}:{actual_sample}:{}:{}:{raster_hash:016x}",
        frame.timestamp, frame.duration
    );
    Ok(json!({
        "targetTicks": target,
        "targetSeconds": target / TICK_RATE,
        "sampleIndex": actual_sample,
        "frameTimestamp": frame.timestamp,
        "frameDuration": frame.duration,
        "rasterFnv1a64": format!("{raster_hash:016x}"),
        "fingerprint": fingerprint,
    }))
}

fn run_control_conformance(session: &mut PlayerSession) -> Result<Value, String> {
    let start = 600 * TICK_RATE;
    session.seek(start)?;
    session.set_rate(PlaybackRate::NORMAL)?;
    session.toggle_pause();
    session.advance_wall_clock(37_123_456_789)?;
    let paused_position = session.position_ticks();
    if paused_position != start {
        return Err("paused feature-length playback advanced".to_owned());
    }
    session.toggle_pause();

    session.set_rate(PlaybackRate::HALF)?;
    session.advance_wall_clock(20_000_000_000)?;
    let half_position = session.position_ticks();
    let expected_half = start + 10 * TICK_RATE;
    if half_position != expected_half {
        return Err("half-rate feature-length control drifted".to_owned());
    }

    session.set_rate(PlaybackRate::DOUBLE)?;
    session.advance_wall_clock(10_000_000_000)?;
    let double_position = session.position_ticks();
    let expected_double = expected_half + 20 * TICK_RATE;
    if double_position != expected_double {
        return Err("double-rate feature-length control drifted".to_owned());
    }
    let sample_index = session
        .audio()
        .ok_or("audio timeline disappeared")?
        .sample_index_at_ticks(double_position);
    let expected_sample = floor_samples_from_ticks(expected_double)?;
    if sample_index != expected_sample {
        return Err("rate-transition sample index drifted".to_owned());
    }

    Ok(json!({
        "startTicks": start,
        "pausedWallNanoseconds": "37123456789",
        "pausedPositionTicks": paused_position,
        "halfRateWallNanoseconds": "20000000000",
        "halfRatePositionTicks": half_position,
        "doubleRateWallNanoseconds": "10000000000",
        "doubleRatePositionTicks": double_position,
        "finalSampleIndex": sample_index,
        "exact": true,
    }))
}

fn reference_ticks(wall_ns: u128, rate: PlaybackRate) -> u64 {
    let numerator = wall_ns
        .saturating_mul(u128::from(TICK_RATE))
        .saturating_mul(u128::from(rate.numerator));
    let denominator = NANOS_PER_SECOND.saturating_mul(u128::from(rate.denominator));
    u64::try_from(numerator / denominator).unwrap_or(u64::MAX)
}

fn floor_samples_from_ticks(ticks: u64) -> Result<usize, String> {
    let samples = u128::from(ticks)
        .checked_mul(u128::from(AUDIO_SAMPLE_RATE))
        .ok_or("sample conversion overflow")?
        / u128::from(TICK_RATE);
    usize::try_from(samples).map_err(|_| "sample index exceeds platform range".to_owned())
}

fn absolute_difference(left: u64, right: u64) -> u64 {
    left.abs_diff(right)
}

fn absolute_difference_usize(left: usize, right: usize) -> u64 {
    u64::try_from(left.abs_diff(right)).unwrap_or(u64::MAX)
}

fn parse_options(arguments: Vec<String>) -> Result<Options, String> {
    if arguments.len() != 2 {
        return Err("usage: v64-av-sync-gate INPUT.v64 OUTPUT.json".to_owned());
    }
    Ok(Options {
        input: PathBuf::from(&arguments[0]),
        output: PathBuf::from(&arguments[1]),
    })
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, Box<dyn Error>> {
    let limit = u64::try_from(MAX_PLAYER_INPUT_BYTES)?;
    let mut reader = File::open(path)?.take(limit + 1);
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes)?;
    if bytes.len() > MAX_PLAYER_INPUT_BYTES {
        return Err(format!("input exceeds {MAX_PLAYER_INPUT_BYTES} bytes").into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_clock_is_chunking_invariant() {
        let total = 1_800u128 * NANOS_PER_SECOND;
        let direct = reference_ticks(total, PlaybackRate::NORMAL);
        let mut accumulated = 0u128;
        let mut index = 0usize;
        while accumulated < total {
            let step = (total - accumulated)
                .min(u128::from(CLOCK_PATTERN_NS[index % CLOCK_PATTERN_NS.len()]));
            accumulated += step;
            index += 1;
        }
        assert_eq!(reference_ticks(accumulated, PlaybackRate::NORMAL), direct);
        assert_eq!(direct, FEATURE_LENGTH_TICKS);
    }

    #[test]
    fn tick_to_sample_mapping_is_exact_at_five_tick_boundaries() {
        assert_eq!(floor_samples_from_ticks(0).unwrap(), 0);
        assert_eq!(floor_samples_from_ticks(4).unwrap(), 3);
        assert_eq!(floor_samples_from_ticks(5).unwrap(), 4);
        assert_eq!(floor_samples_from_ticks(TICK_RATE).unwrap(), 48_000);
        assert_eq!(
            floor_samples_from_ticks(FEATURE_LENGTH_TICKS).unwrap(),
            86_400_000
        );
    }
}
