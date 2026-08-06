#![forbid(unsafe_code)]
#![allow(clippy::too_many_lines)]

use std::collections::HashMap;
use std::env;
use std::error::Error;
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Duration;

use sdl2::event::Event;
use sdl2::keyboard::Keycode;
use sdl2::mouse::MouseButton;
use sdl2::pixels::{Color, PixelFormatEnum};
use sdl2::rect::Rect;
use sdl2::render::{Canvas, WindowCanvas};
use sdl2::video::Window;
use serde_json::{Value, json};
use video64_drop_native::{
    Control, SHELL_ENCODE_REPORT_FORMAT, SHELL_PREVIEW_REPORT_FORMAT, SHELL_REPORT_FORMAT,
    ShellSettings, control_vocabulary, shell_capabilities,
};

const WINDOW_WIDTH: u32 = 1_200;
const WINDOW_HEIGHT: u32 = 820;
const CONTROL_Y: i32 = 150;
const CONTROL_WIDTH: u32 = 216;
const CONTROL_HEIGHT: u32 = 62;
const CONTROL_GAP: i32 = 14;
const PREVIEW_Y: i32 = 232;
const PREVIEW_HEIGHT: u32 = 320;
const QUEUE_Y: i32 = 592;
const QUEUE_ROW_HEIGHT: i32 = 42;
const MAX_VISIBLE_JOBS: usize = 3;

fn preview_button() -> Rect {
    Rect::new(812, 752, 170, 46)
}

fn encode_button() -> Rect {
    Rect::new(1_000, 752, 180, 46)
}

#[derive(Clone, Debug)]
struct CoreConfig {
    node: OsString,
    cli: PathBuf,
}

#[derive(Debug)]
struct Options {
    core_cli: PathBuf,
    headless_report: Option<PathBuf>,
    headless_encode: Option<(PathBuf, PathBuf)>,
    headless_preview: Option<(PathBuf, PathBuf)>,
    smoke_presents: Option<u32>,
    smoke_drop: Option<PathBuf>,
    smoke_preview: Option<PathBuf>,
    inputs: Vec<PathBuf>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
}

impl JobStatus {
    const fn label(self) -> &'static str {
        match self {
            Self::Queued => "QUEUED",
            Self::Running => "RUNNING",
            Self::Completed => "COMPLETE",
            Self::Failed => "FAILED",
        }
    }
}

#[derive(Clone, Debug)]
struct ShellJob {
    id: String,
    input: PathBuf,
    output: PathBuf,
    status: JobStatus,
    stage: Option<String>,
    detail: Option<String>,
    warnings: Vec<String>,
    grid: Option<(u64, u64)>,
    audio_present: Option<bool>,
    output_bytes: Option<u64>,
}

impl ShellJob {
    fn from_plan(value: &Value) -> Result<Self, String> {
        Ok(Self {
            id: json_string(value, "id")?,
            input: PathBuf::from(json_string(value, "inputPath")?),
            output: PathBuf::from(json_string(value, "outputPath")?),
            status: JobStatus::Queued,
            stage: None,
            detail: Some("Ready for source analysis".to_owned()),
            warnings: Vec::new(),
            grid: None,
            audio_present: None,
            output_bytes: None,
        })
    }

    fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "inputPath": self.input,
            "outputPath": self.output,
            "status": self.status.label().to_ascii_lowercase(),
            "stage": self.stage,
            "detail": self.detail,
            "warnings": self.warnings,
            "grid": self.grid.map(|(columns, rows)| json!({
                "columns": columns,
                "rows": rows,
            })),
            "audioPresent": self.audio_present,
            "outputBytes": self.output_bytes,
        })
    }
}

#[derive(Clone, Debug)]
struct RgbImage {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[derive(Clone, Debug)]
struct PreviewResult {
    source: RgbImage,
    decoded: RgbImage,
    central_bytes: u64,
    low_bytes: u64,
    high_bytes: u64,
    timestamp_seconds: f64,
}

#[derive(Clone, Debug)]
enum PreviewState {
    Empty,
    Running { input: PathBuf },
    Ready(PreviewResult),
    Failed { input: PathBuf, error: String },
}

#[derive(Debug)]
struct ShellState {
    settings: ShellSettings,
    focus: Control,
    jobs: Vec<ShellJob>,
    selected: usize,
    batch_active: bool,
    notice: String,
    preview: PreviewState,
}

impl Default for ShellState {
    fn default() -> Self {
        Self {
            settings: ShellSettings::default(),
            focus: Control::Cadence,
            jobs: Vec::new(),
            selected: 0,
            batch_active: false,
            notice: "Drop video files into the window".to_owned(),
            preview: PreviewState::Empty,
        }
    }
}

#[derive(Debug)]
enum WorkerMessage {
    EncodeProgress {
        stage: Option<String>,
        detail: Option<String>,
    },
    EncodeFinished(Value),
    PreviewFinished(PreviewResult),
    Failed(String),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WorkerKind {
    Encode,
    Preview,
}

#[derive(Debug)]
struct ActiveWorker {
    job_index: usize,
    kind: WorkerKind,
    receiver: Receiver<WorkerMessage>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("video64-drop: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let arguments = env::args_os().skip(1).collect::<Vec<_>>();
    if arguments.len() == 1 && (arguments[0] == "--version" || arguments[0] == "-V") {
        println!("Video64 Drop {} native shell", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if arguments.len() == 1 && (arguments[0] == "--help" || arguments[0] == "-h") {
        println!("{}", usage());
        return Ok(());
    }
    let options = parse_options(&arguments)?;
    let core = CoreConfig {
        node: env::var_os("VIDEO64_DROP_NODE").unwrap_or_else(default_node_path),
        cli: options.core_cli.clone(),
    };

    if let Some((input, output)) = options.headless_encode.as_ref() {
        let report_path = options
            .headless_report
            .as_deref()
            .ok_or("--headless-encode requires --headless-report")?;
        return write_headless_encode_report(&core, input, output, report_path).map_err(Into::into);
    }
    if let Some((input, output_dir)) = options.headless_preview.as_ref() {
        let report_path = options
            .headless_report
            .as_deref()
            .ok_or("--headless-preview requires --headless-report")?;
        return write_headless_preview_report(&core, input, output_dir, report_path)
            .map_err(Into::into);
    }
    if let Some(report_path) = options.headless_report.as_deref() {
        return write_headless_shell_report(&core, &options.inputs, report_path)
            .map_err(Into::into);
    }

    run_windowed(
        &core,
        options.inputs,
        options.smoke_presents,
        options.smoke_drop,
        options.smoke_preview.as_deref(),
    )
    .map_err(Into::into)
}

fn usage() -> &'static str {
    "usage: video64-drop [--core-cli PATH] [--smoke-presents N] [--smoke-drop PATH] [--smoke-preview PATH] [INPUT ...]\n       video64-drop --headless-report REPORT.json [INPUT ...]\n       video64-drop --headless-encode INPUT OUTPUT.v64 --headless-report REPORT.json\n       video64-drop --headless-preview INPUT OUTPUT_DIR --headless-report REPORT.json"
}

fn parse_options(arguments: &[OsString]) -> Result<Options, String> {
    let mut core_cli = default_core_cli_path();
    let mut headless_report = None;
    let mut headless_encode = None;
    let mut headless_preview = None;
    let mut smoke_presents = None;
    let mut smoke_drop = None;
    let mut smoke_preview = None;
    let mut inputs = Vec::new();
    let mut index = 0usize;
    while index < arguments.len() {
        match arguments[index].to_str() {
            Some("--core-cli") => {
                index += 1;
                core_cli = PathBuf::from(arguments.get(index).ok_or_else(|| usage().to_owned())?);
            }
            Some("--headless-report") => {
                index += 1;
                headless_report = Some(PathBuf::from(
                    arguments.get(index).ok_or_else(|| usage().to_owned())?,
                ));
            }
            Some("--headless-encode") => {
                index += 1;
                let input = PathBuf::from(arguments.get(index).ok_or_else(|| usage().to_owned())?);
                index += 1;
                let output = PathBuf::from(arguments.get(index).ok_or_else(|| usage().to_owned())?);
                headless_encode = Some((input, output));
            }
            Some("--headless-preview") => {
                index += 1;
                let input = PathBuf::from(arguments.get(index).ok_or_else(|| usage().to_owned())?);
                index += 1;
                let output_dir =
                    PathBuf::from(arguments.get(index).ok_or_else(|| usage().to_owned())?);
                headless_preview = Some((input, output_dir));
            }
            Some("--smoke-presents") => {
                index += 1;
                let count = arguments
                    .get(index)
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| usage().to_owned())?
                    .parse::<u32>()
                    .map_err(|_| "--smoke-presents requires an unsigned integer".to_owned())?;
                if count == 0 || count > 10_000 {
                    return Err("--smoke-presents must be between 1 and 10000".to_owned());
                }
                smoke_presents = Some(count);
            }
            Some("--smoke-drop") => {
                index += 1;
                smoke_drop = Some(PathBuf::from(
                    arguments.get(index).ok_or_else(|| usage().to_owned())?,
                ));
            }
            Some("--smoke-preview") => {
                index += 1;
                smoke_preview = Some(PathBuf::from(
                    arguments.get(index).ok_or_else(|| usage().to_owned())?,
                ));
            }
            Some(value) if value.starts_with('-') => return Err(usage().to_owned()),
            _ => inputs.push(PathBuf::from(&arguments[index])),
        }
        index += 1;
    }
    if headless_encode.is_some() && headless_preview.is_some() {
        return Err("Choose only one headless operation".to_owned());
    }
    Ok(Options {
        core_cli,
        headless_report,
        headless_encode,
        headless_preview,
        smoke_presents,
        smoke_drop,
        smoke_preview,
        inputs,
    })
}

fn core_cli_candidates(executable: &Path) -> Vec<PathBuf> {
    let Some(directory) = executable.parent() else {
        return Vec::new();
    };
    vec![
        directory.join("apps/video64-drop/cli.mjs"),
        directory.join("../apps/video64-drop/cli.mjs"),
        directory.join("video64-drop/cli.mjs"),
    ]
}

fn default_core_cli_path() -> PathBuf {
    if let Ok(executable) = env::current_exe() {
        if let Some(candidate) = core_cli_candidates(&executable)
            .into_iter()
            .find(|candidate| candidate.is_file())
        {
            return candidate;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../video64-drop/cli.mjs")
}

fn node_candidates(executable: &Path) -> Vec<PathBuf> {
    let Some(directory) = executable.parent() else {
        return Vec::new();
    };
    vec![
        directory.join("runtime/node/bin/node"),
        directory.join("node/bin/node"),
        directory.join("node"),
    ]
}

fn default_node_path() -> OsString {
    if let Ok(executable) = env::current_exe() {
        if let Some(candidate) = node_candidates(&executable)
            .into_iter()
            .find(|candidate| candidate.is_file())
        {
            return candidate.into_os_string();
        }
    }
    OsString::from("node")
}

fn core_output(core: &CoreConfig, arguments: &[OsString]) -> Result<std::process::Output, String> {
    Command::new(&core.node)
        .arg(&core.cli)
        .args(arguments)
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                format!(
                    "Unable to start Video64 Drop core: Node.js runtime not found at {}. Re-extract the complete Video64 Drop release archive.",
                    Path::new(&core.node).display()
                )
            } else {
                format!("Unable to start Video64 Drop core: {error}")
            }
        })
}

fn plan_jobs(
    core: &CoreConfig,
    settings: &ShellSettings,
    inputs: &[PathBuf],
) -> Result<Vec<ShellJob>, String> {
    if inputs.is_empty() {
        return Ok(Vec::new());
    }
    let mut arguments = vec![OsString::from("plan")];
    arguments.extend(inputs.iter().map(|path| path.as_os_str().to_owned()));
    arguments.extend(settings.cli_arguments().into_iter().map(OsString::from));
    let output = core_output(core, &arguments)?;
    if !output.status.success() {
        return Err(format!(
            "Queue planning failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let document: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Queue plan was not valid JSON: {error}"))?;
    document
        .get("jobs")
        .and_then(Value::as_array)
        .ok_or_else(|| "Queue plan did not contain jobs".to_owned())?
        .iter()
        .map(ShellJob::from_plan)
        .collect()
}

fn inspect_job(core: &CoreConfig, settings: &ShellSettings, job: &mut ShellJob) {
    let mut arguments = vec![OsString::from("inspect"), job.input.as_os_str().to_owned()];
    arguments.extend(settings.cli_arguments().into_iter().map(OsString::from));
    match core_output(core, &arguments) {
        Ok(output) if output.status.success() => {
            match serde_json::from_slice::<Value>(&output.stdout) {
                Ok(document) => {
                    job.warnings = json_string_array(document.get("warnings"));
                    job.grid = document.get("grid").and_then(|grid| {
                        Some((grid.get("columns")?.as_u64()?, grid.get("rows")?.as_u64()?))
                    });
                    job.audio_present = document
                        .pointer("/source/audioPresent")
                        .and_then(Value::as_bool);
                    job.detail = job.grid.map_or_else(
                        || Some("Source analysis complete".to_owned()),
                        |(columns, rows)| Some(format!("{columns} X {rows} CELLS")),
                    );
                }
                Err(error) => {
                    job.status = JobStatus::Failed;
                    job.detail = Some(format!("Analysis JSON failed: {error}"));
                }
            }
        }
        Ok(output) => {
            job.status = JobStatus::Failed;
            job.detail = Some(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        Err(error) => {
            job.status = JobStatus::Failed;
            job.detail = Some(error);
        }
    }
}

fn json_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("JSON field {key} is missing"))
}

fn json_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn queue_snapshot(
    core: &CoreConfig,
    inputs: &[PathBuf],
) -> Result<(ShellSettings, Vec<ShellJob>), String> {
    let settings = ShellSettings::default();
    let mut jobs = plan_jobs(core, &settings, inputs)?;
    for job in &mut jobs {
        inspect_job(core, &settings, job);
    }
    Ok((settings, jobs))
}

fn write_headless_shell_report(
    core: &CoreConfig,
    inputs: &[PathBuf],
    output: &Path,
) -> Result<(), String> {
    let (settings, jobs) = queue_snapshot(core, inputs)?;
    let report = json!({
        "format": SHELL_REPORT_FORMAT,
        "capabilities": shell_capabilities(),
        "controls": control_vocabulary(),
        "settings": settings.to_json(),
        "queue": jobs.iter().map(ShellJob::to_json).collect::<Vec<_>>(),
        "keyboard": {
            "focusNextControl": "Tab",
            "changeControl": "Left/Right",
            "selectJob": "Up/Down",
            "previewSelected": "P",
            "encodeQueue": "Enter or E",
            "retryFailed": "R",
            "removeQueued": "Delete",
            "openCompletedOutput": "O",
            "quit": "Escape",
        },
        "coreCli": core.cli,
        "nodeRuntime": Path::new(&core.node).to_string_lossy(),
        "transitionalBoundary": {
            "sourceAudioEncoding": true,
            "audioBitrateFrozen": false,
            "decodedPreview": true,
            "sampledSizeEstimator": true,
            "particleLighting": false,
            "packaging": false,
        },
    });
    write_json(output, &report)
}

fn write_headless_encode_report(
    core: &CoreConfig,
    input: &Path,
    output: &Path,
    report_path: &Path,
) -> Result<(), String> {
    let settings = ShellSettings::default();
    let mut arguments = vec![
        OsString::from("encode"),
        input.as_os_str().to_owned(),
        output.as_os_str().to_owned(),
    ];
    arguments.extend(settings.cli_arguments().into_iter().map(OsString::from));
    let result = core_output(core, &arguments)?;
    let events = String::from_utf8_lossy(&result.stderr)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect::<Vec<_>>();
    let final_job = serde_json::from_slice::<Value>(&result.stdout)
        .map_err(|error| format!("Completed job was not valid JSON: {error}"))?;
    let report = json!({
        "format": SHELL_ENCODE_REPORT_FORMAT,
        "capabilities": shell_capabilities(),
        "settings": settings.to_json(),
        "inputPath": input,
        "outputPath": output,
        "events": events,
        "finalJob": final_job,
        "coreExitSuccess": result.status.success(),
    });
    write_json(report_path, &report)?;
    if !result.status.success() {
        return Err("Video64 Drop core returned a failed encode".to_owned());
    }
    Ok(())
}

fn write_headless_preview_report(
    core: &CoreConfig,
    input: &Path,
    output_dir: &Path,
    report_path: &Path,
) -> Result<(), String> {
    let settings = ShellSettings::default();
    let result = create_preview(core, &settings, input, output_dir)?;
    let report = json!({
        "format": SHELL_PREVIEW_REPORT_FORMAT,
        "capabilities": shell_capabilities(),
        "settings": settings.to_json(),
        "inputPath": input,
        "outputDirectory": output_dir,
        "advisory": true,
        "exactPostEncodeVerificationAuthoritative": true,
        "previewTimestampSeconds": result.timestamp_seconds,
        "estimate": {
            "centralEstimateBytes": result.central_bytes,
            "advisoryLowBytes": result.low_bytes,
            "advisoryHighBytes": result.high_bytes,
        },
        "images": {
            "source": {
                "width": result.source.width,
                "height": result.source.height,
                "rgbBytes": result.source.pixels.len(),
            },
            "decodedV64": {
                "width": result.decoded.width,
                "height": result.decoded.height,
                "rgbBytes": result.decoded.pixels.len(),
            },
        },
    });
    write_json(report_path, &report)
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let encoded = format!(
        "{}\n",
        serde_json::to_string_pretty(value).map_err(|error| error.to_string())?
    );
    fs::write(path, encoded).map_err(|error| error.to_string())
}

fn run_windowed(
    core: &CoreConfig,
    inputs: Vec<PathBuf>,
    smoke_presents: Option<u32>,
    smoke_drop: Option<PathBuf>,
    smoke_preview: Option<&Path>,
) -> Result<(), String> {
    let mut state = ShellState::default();
    add_inputs(core, &mut state, inputs)?;

    let sdl = sdl2::init().map_err(|error| error.to_string())?;
    let video = sdl.video().map_err(|error| error.to_string())?;
    let window = video
        .window("Video64 Drop", WINDOW_WIDTH, WINDOW_HEIGHT)
        .position_centered()
        .resizable()
        .build()
        .map_err(|error| error.to_string())?;
    let mut canvas = window
        .into_canvas()
        .software()
        .build()
        .map_err(|error| error.to_string())?;
    let mut event_pump = sdl.event_pump().map_err(|error| error.to_string())?;
    if let Some(input) = smoke_drop {
        handle_dropped_file(core, &mut state, input);
    }
    let mut worker: Option<ActiveWorker> = None;
    if let Some(input) = smoke_preview {
        handle_dropped_file(core, &mut state, input.to_path_buf());
        if let Some(index) = state.jobs.iter().position(|job| job.input == input) {
            state.selected = index;
        }
        begin_preview(core, &mut state, &mut worker);
    }
    let mut presented = 0u32;

    'running: loop {
        process_worker_messages(&mut state, &mut worker);
        if state.batch_active && worker.is_none() {
            start_next_worker(core, &mut state, &mut worker);
        }

        for event in event_pump.poll_iter() {
            match event {
                Event::Quit { .. }
                | Event::KeyDown {
                    keycode: Some(Keycode::Escape),
                    ..
                } => {
                    if worker.is_none() {
                        break 'running;
                    }
                    "Work is active; quit after it completes".clone_into(&mut state.notice);
                }
                Event::DropFile { filename, .. } => {
                    handle_dropped_file(core, &mut state, PathBuf::from(filename));
                }
                Event::KeyDown {
                    keycode: Some(Keycode::Tab),
                    repeat: false,
                    ..
                } => state.focus = state.focus.next(),
                Event::KeyDown {
                    keycode: Some(Keycode::Left),
                    repeat: false,
                    ..
                } => adjust_settings(core, &mut state, -1, worker.is_some()),
                Event::KeyDown {
                    keycode: Some(Keycode::Right),
                    repeat: false,
                    ..
                } => adjust_settings(core, &mut state, 1, worker.is_some()),
                Event::KeyDown {
                    keycode: Some(Keycode::Up),
                    repeat: false,
                    ..
                } => select_job(&mut state, -1),
                Event::KeyDown {
                    keycode: Some(Keycode::Down),
                    repeat: false,
                    ..
                } => select_job(&mut state, 1),
                Event::KeyDown {
                    keycode: Some(Keycode::P),
                    repeat: false,
                    ..
                } => begin_preview(core, &mut state, &mut worker),
                Event::KeyDown {
                    keycode: Some(Keycode::Return | Keycode::KpEnter | Keycode::E),
                    repeat: false,
                    ..
                } => begin_batch(&mut state, worker.is_some()),
                Event::KeyDown {
                    keycode: Some(Keycode::Delete),
                    repeat: false,
                    ..
                } => remove_selected(&mut state),
                Event::KeyDown {
                    keycode: Some(Keycode::R),
                    repeat: false,
                    ..
                } => retry_selected(&mut state),
                Event::KeyDown {
                    keycode: Some(Keycode::O),
                    repeat: false,
                    ..
                } => open_selected_output(&mut state),
                Event::MouseButtonDown {
                    mouse_btn: MouseButton::Left,
                    x,
                    y,
                    ..
                } => handle_click(core, &mut state, &mut worker, x, y),
                _ => {}
            }
        }

        draw(&mut canvas, &state)?;
        let preview_ready =
            smoke_preview.is_none() || !matches!(&state.preview, PreviewState::Running { .. });
        if preview_ready {
            presented = presented.saturating_add(1);
        }
        if smoke_presents.is_some_and(|limit| presented >= limit) {
            break;
        }
        thread::sleep(Duration::from_millis(16));
    }
    Ok(())
}

fn add_inputs(
    core: &CoreConfig,
    state: &mut ShellState,
    inputs: Vec<PathBuf>,
) -> Result<(), String> {
    if inputs.is_empty() {
        return Ok(());
    }
    let mut all_inputs = state
        .jobs
        .iter()
        .map(|job| job.input.clone())
        .collect::<Vec<_>>();
    for input in inputs {
        if !all_inputs.contains(&input) {
            all_inputs.push(input);
        }
    }
    let old_jobs = state
        .jobs
        .drain(..)
        .map(|job| (job.input.clone(), job))
        .collect::<HashMap<_, _>>();
    let mut planned = plan_jobs(core, &state.settings, &all_inputs)?;
    for job in &mut planned {
        if let Some(existing) = old_jobs.get(&job.input) {
            *job = existing.clone();
        } else {
            inspect_job(core, &state.settings, job);
        }
    }
    state.jobs = planned;
    state.selected = if state.jobs.is_empty() {
        0
    } else {
        state.selected.min(state.jobs.len() - 1)
    };
    state.preview = PreviewState::Empty;
    state.notice = format!("{} file(s) in queue", state.jobs.len());
    Ok(())
}

fn handle_dropped_file(core: &CoreConfig, state: &mut ShellState, input: PathBuf) {
    let label = file_label(&input);
    if let Err(error) = add_inputs(core, state, vec![input]) {
        state.notice = format!("Could not add {label}: {error}");
    }
}

fn adjust_settings(core: &CoreConfig, state: &mut ShellState, direction: i8, worker_active: bool) {
    if worker_active {
        "Wait for the active preview or encode".clone_into(&mut state.notice);
        return;
    }
    if state.jobs.iter().any(|job| job.status != JobStatus::Queued) {
        "Settings are locked after encoding starts".clone_into(&mut state.notice);
        return;
    }
    if !state.settings.adjust(state.focus, direction) {
        return;
    }
    let inputs = state
        .jobs
        .iter()
        .map(|job| job.input.clone())
        .collect::<Vec<_>>();
    match plan_jobs(core, &state.settings, &inputs) {
        Ok(mut jobs) => {
            for job in &mut jobs {
                inspect_job(core, &state.settings, job);
            }
            state.jobs = jobs;
            state.preview = PreviewState::Empty;
            state.notice = format!(
                "{} set to {} - preview invalidated",
                state.focus.label(),
                state.settings.value_label(state.focus)
            );
        }
        Err(error) => state.notice = error,
    }
}

fn select_job(state: &mut ShellState, direction: i8) {
    if state.jobs.is_empty() {
        return;
    }
    let before = state.selected;
    match direction.cmp(&0) {
        std::cmp::Ordering::Less => {
            state.selected = state.selected.saturating_sub(1);
        }
        std::cmp::Ordering::Greater => {
            state.selected = (state.selected + 1).min(state.jobs.len() - 1);
        }
        std::cmp::Ordering::Equal => {}
    }
    if state.selected != before {
        state.preview = PreviewState::Empty;
    }
}

fn begin_batch(state: &mut ShellState, worker_active: bool) {
    if worker_active {
        "Wait for the active preview or encode".clone_into(&mut state.notice);
    } else if state.jobs.iter().any(|job| job.status == JobStatus::Queued) {
        state.batch_active = true;
        "Encoding queued files".clone_into(&mut state.notice);
    } else {
        "No queued files are ready to encode".clone_into(&mut state.notice);
    }
}

fn begin_preview(core: &CoreConfig, state: &mut ShellState, worker: &mut Option<ActiveWorker>) {
    if worker.is_some() || state.batch_active {
        "Wait for the active preview or encode".clone_into(&mut state.notice);
        return;
    }
    let Some(job) = state.jobs.get(state.selected).cloned() else {
        "Select a queued file before previewing".clone_into(&mut state.notice);
        return;
    };
    let output_dir = preview_output_dir(&job);
    state.preview = PreviewState::Running {
        input: job.input.clone(),
    };
    state.notice = format!("Building decoded preview for {}", file_label(&job.input));
    let receiver = spawn_preview_worker(
        core.clone(),
        state.settings.clone(),
        job.clone(),
        output_dir,
    );
    *worker = Some(ActiveWorker {
        job_index: state.selected,
        kind: WorkerKind::Preview,
        receiver,
    });
}

fn preview_output_dir(job: &ShellJob) -> PathBuf {
    let safe_id = job
        .id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    env::temp_dir().join(format!(
        "video64-drop-preview-{}-{safe_id}",
        std::process::id()
    ))
}

fn remove_selected(state: &mut ShellState) {
    if state
        .jobs
        .get(state.selected)
        .is_some_and(|job| matches!(job.status, JobStatus::Queued | JobStatus::Failed))
    {
        state.jobs.remove(state.selected);
        state.selected = state.selected.min(state.jobs.len().saturating_sub(1));
        state.preview = PreviewState::Empty;
        "Removed selected file".clone_into(&mut state.notice);
    } else {
        "Only queued or failed files can be removed".clone_into(&mut state.notice);
    }
}

fn retry_selected(state: &mut ShellState) {
    if let Some(job) = state.jobs.get_mut(state.selected) {
        if job.status == JobStatus::Failed {
            job.status = JobStatus::Queued;
            job.stage = None;
            job.detail = Some("Ready to retry".to_owned());
            "Failed file returned to the queue".clone_into(&mut state.notice);
        }
    }
}

fn open_selected_output(state: &mut ShellState) {
    let Some(job) = state.jobs.get(state.selected) else {
        return;
    };
    if job.status != JobStatus::Completed {
        "The selected file has no completed output yet".clone_into(&mut state.notice);
        return;
    }
    let directory = job.output.parent().unwrap_or_else(|| Path::new("."));
    match Command::new("xdg-open").arg(directory).spawn() {
        Ok(_) => "Opened the output folder".clone_into(&mut state.notice),
        Err(error) => state.notice = format!("Could not open output folder: {error}"),
    }
}

fn handle_click(
    core: &CoreConfig,
    state: &mut ShellState,
    worker: &mut Option<ActiveWorker>,
    x: i32,
    y: i32,
) {
    if preview_button().contains_point((x, y)) {
        begin_preview(core, state, worker);
        return;
    }
    if encode_button().contains_point((x, y)) {
        begin_batch(state, worker.is_some());
        return;
    }
    for (index, control) in Control::ALL.iter().copied().enumerate() {
        let rect = control_rect(index);
        if rect.contains_point((x, y)) {
            state.focus = control;
            let midpoint = rect.x() + i32::try_from(rect.width() / 2).unwrap_or(0);
            adjust_settings(
                core,
                state,
                if x < midpoint { -1 } else { 1 },
                worker.is_some(),
            );
            return;
        }
    }
    let row = (y - QUEUE_Y).div_euclid(QUEUE_ROW_HEIGHT);
    if row >= 0 {
        let index = usize::try_from(row).unwrap_or(usize::MAX);
        if index < state.jobs.len().min(MAX_VISIBLE_JOBS) && state.selected != index {
            state.selected = index;
            state.preview = PreviewState::Empty;
        }
    }
}

fn control_rect(index: usize) -> Rect {
    let x = 20
        + i32::try_from(index).unwrap_or(0)
            * (i32::try_from(CONTROL_WIDTH).unwrap_or(0) + CONTROL_GAP);
    Rect::new(x, CONTROL_Y, CONTROL_WIDTH, CONTROL_HEIGHT)
}

fn start_next_worker(core: &CoreConfig, state: &mut ShellState, worker: &mut Option<ActiveWorker>) {
    let Some(index) = state
        .jobs
        .iter()
        .position(|job| job.status == JobStatus::Queued)
    else {
        state.batch_active = false;
        "Queue complete".clone_into(&mut state.notice);
        return;
    };
    let job = state.jobs[index].clone();
    state.jobs[index].status = JobStatus::Running;
    state.jobs[index].stage = Some("analysis".to_owned());
    state.jobs[index].detail = Some("Starting Video64 Drop core".to_owned());
    state.selected = index;
    state.preview = PreviewState::Empty;
    let receiver = spawn_encode_worker(core.clone(), state.settings.clone(), job);
    *worker = Some(ActiveWorker {
        job_index: index,
        kind: WorkerKind::Encode,
        receiver,
    });
}

fn spawn_encode_worker(
    core: CoreConfig,
    settings: ShellSettings,
    job: ShellJob,
) -> Receiver<WorkerMessage> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || run_encode_worker(&core, &settings, &job, &sender));
    receiver
}

fn run_encode_worker(
    core: &CoreConfig,
    settings: &ShellSettings,
    job: &ShellJob,
    sender: &Sender<WorkerMessage>,
) {
    let mut command = Command::new(&core.node);
    command
        .arg(&core.cli)
        .arg("encode")
        .arg(&job.input)
        .arg(&job.output)
        .args(settings.cli_arguments())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = sender.send(WorkerMessage::Failed(format!(
                "Core could not start: {error}"
            )));
            return;
        }
    };
    let stderr = child.stderr.take();
    let progress_sender = sender.clone();
    let progress_reader = thread::spawn(move || {
        if let Some(stderr) = stderr {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(event) = serde_json::from_str::<Value>(&line) {
                    let _ = progress_sender.send(WorkerMessage::EncodeProgress {
                        stage: event
                            .get("stage")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned),
                        detail: event
                            .get("detail")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned),
                    });
                }
            }
        }
    });
    let mut stdout = String::new();
    if let Some(mut output) = child.stdout.take() {
        if let Err(error) = output.read_to_string(&mut stdout) {
            let _ = sender.send(WorkerMessage::Failed(format!(
                "Could not read core output: {error}"
            )));
            let _ = child.wait();
            let _ = progress_reader.join();
            return;
        }
    }
    let status = child.wait();
    let _ = progress_reader.join();
    match status {
        Ok(exit) => match serde_json::from_str::<Value>(&stdout) {
            Ok(final_job) if exit.success() => {
                let _ = sender.send(WorkerMessage::EncodeFinished(final_job));
            }
            Ok(final_job) => {
                let message = final_job
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Video64 Drop core failed")
                    .to_owned();
                let _ = sender.send(WorkerMessage::Failed(message));
            }
            Err(error) => {
                let _ = sender.send(WorkerMessage::Failed(format!(
                    "Core result was not JSON: {error}"
                )));
            }
        },
        Err(error) => {
            let _ = sender.send(WorkerMessage::Failed(format!(
                "Core process failed: {error}"
            )));
        }
    }
}

fn spawn_preview_worker(
    core: CoreConfig,
    settings: ShellSettings,
    job: ShellJob,
    output_dir: PathBuf,
) -> Receiver<WorkerMessage> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let message = match create_preview(&core, &settings, &job.input, &output_dir) {
            Ok(result) => WorkerMessage::PreviewFinished(result),
            Err(error) => WorkerMessage::Failed(error),
        };
        let _ = sender.send(message);
    });
    receiver
}

fn create_preview(
    core: &CoreConfig,
    settings: &ShellSettings,
    input: &Path,
    output_dir: &Path,
) -> Result<PreviewResult, String> {
    fs::create_dir_all(output_dir).map_err(|error| {
        format!(
            "Could not create preview directory {}: {error}",
            output_dir.display()
        )
    })?;
    let mut arguments = vec![
        OsString::from("preview"),
        input.as_os_str().to_owned(),
        output_dir.as_os_str().to_owned(),
    ];
    arguments.extend(settings.cli_arguments().into_iter().map(OsString::from));
    let output = core_output(core, &arguments)?;
    if !output.status.success() {
        return Err(format!(
            "Preview failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let report: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Preview report was not valid JSON: {error}"))?;
    let source_path = preview_image_path(&report, "/source/path", output_dir, "source.ppm")?;
    let decoded_path =
        preview_image_path(&report, "/decodedV64/path", output_dir, "decoded-v64.ppm")?;
    let source = load_ppm(&source_path)?;
    let decoded = load_ppm(&decoded_path)?;
    Ok(PreviewResult {
        source,
        decoded,
        central_bytes: json_u64(&report, "/estimate/estimatedBytes")?,
        low_bytes: json_u64(&report, "/estimate/lowerBytes")?,
        high_bytes: json_u64(&report, "/estimate/upperBytes")?,
        timestamp_seconds: report
            .pointer("/preview/representativeOffsetSeconds")
            .and_then(Value::as_f64)
            .ok_or_else(|| "Preview report omitted previewTimestampSeconds".to_owned())?,
    })
}

fn preview_image_path(
    report: &Value,
    pointer: &str,
    output_dir: &Path,
    fallback_name: &str,
) -> Result<PathBuf, String> {
    if let Some(path) = report.pointer(pointer).and_then(Value::as_str) {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    let fallback = output_dir.join(fallback_name);
    if fallback.is_file() {
        Ok(fallback)
    } else {
        Err(format!(
            "Preview image was not written: {}",
            fallback.display()
        ))
    }
}

fn json_u64(value: &Value, pointer: &str) -> Result<u64, String> {
    value
        .pointer(pointer)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("Preview report omitted {pointer}"))
}

fn load_ppm(path: &Path) -> Result<RgbImage, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Could not read preview image {}: {error}", path.display()))?;
    let mut cursor = 0usize;
    let magic = ppm_token(&bytes, &mut cursor)?;
    if magic != "P6" {
        return Err(format!(
            "Unsupported preview image format in {}",
            path.display()
        ));
    }
    let width = ppm_token(&bytes, &mut cursor)?
        .parse::<u32>()
        .map_err(|_| "PPM width is invalid".to_owned())?;
    let height = ppm_token(&bytes, &mut cursor)?
        .parse::<u32>()
        .map_err(|_| "PPM height is invalid".to_owned())?;
    let maximum = ppm_token(&bytes, &mut cursor)?
        .parse::<u32>()
        .map_err(|_| "PPM maximum is invalid".to_owned())?;
    if maximum != 255 || width == 0 || height == 0 {
        return Err("PPM must be nonempty 8-bit RGB".to_owned());
    }
    if cursor >= bytes.len() || !bytes[cursor].is_ascii_whitespace() {
        return Err("PPM header is missing its pixel delimiter".to_owned());
    }
    let delimiter = bytes[cursor];
    cursor += 1;
    if delimiter == b'\r' && bytes.get(cursor) == Some(&b'\n') {
        cursor += 1;
    }
    let expected = usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .and_then(|pixels| pixels.checked_mul(3))
        .ok_or_else(|| "PPM dimensions overflow".to_owned())?;
    if bytes.len().saturating_sub(cursor) != expected {
        return Err(format!(
            "PPM pixel payload mismatch in {}: expected {expected}, found {}",
            path.display(),
            bytes.len().saturating_sub(cursor)
        ));
    }
    Ok(RgbImage {
        width,
        height,
        pixels: bytes[cursor..].to_vec(),
    })
}

fn ppm_token(bytes: &[u8], cursor: &mut usize) -> Result<String, String> {
    loop {
        while *cursor < bytes.len() && bytes[*cursor].is_ascii_whitespace() {
            *cursor += 1;
        }
        if *cursor < bytes.len() && bytes[*cursor] == b'#' {
            while *cursor < bytes.len() && bytes[*cursor] != b'\n' {
                *cursor += 1;
            }
            continue;
        }
        break;
    }
    let start = *cursor;
    while *cursor < bytes.len() && !bytes[*cursor].is_ascii_whitespace() && bytes[*cursor] != b'#' {
        *cursor += 1;
    }
    if start == *cursor {
        return Err("PPM header ended early".to_owned());
    }
    std::str::from_utf8(&bytes[start..*cursor])
        .map(ToOwned::to_owned)
        .map_err(|_| "PPM header was not ASCII".to_owned())
}

fn process_worker_messages(state: &mut ShellState, worker: &mut Option<ActiveWorker>) {
    let Some(active) = worker.as_ref() else {
        return;
    };
    let index = active.job_index;
    let kind = active.kind;
    let messages = active.receiver.try_iter().collect::<Vec<_>>();
    let mut finished = false;
    for message in messages {
        match message {
            WorkerMessage::EncodeProgress { stage, detail } => {
                if let Some(job) = state.jobs.get_mut(index) {
                    job.stage = stage;
                    job.detail = detail;
                }
            }
            WorkerMessage::EncodeFinished(final_job) => {
                if let Some(job) = state.jobs.get_mut(index) {
                    apply_final_job(job, &final_job);
                    state.notice = format!("Completed {}", file_label(&job.input));
                }
                finished = true;
            }
            WorkerMessage::PreviewFinished(result) => {
                state.notice = format!(
                    "Preview ready - advisory {} to {}",
                    format_bytes(result.low_bytes),
                    format_bytes(result.high_bytes)
                );
                state.preview = PreviewState::Ready(result);
                finished = true;
            }
            WorkerMessage::Failed(error) => {
                if kind == WorkerKind::Encode {
                    if let Some(job) = state.jobs.get_mut(index) {
                        job.status = JobStatus::Failed;
                        job.detail = Some(error.clone());
                    }
                    state.batch_active = false;
                } else {
                    let input = state
                        .jobs
                        .get(index)
                        .map(|job| job.input.clone())
                        .unwrap_or_default();
                    state.preview = PreviewState::Failed {
                        input,
                        error: error.clone(),
                    };
                }
                state.notice = error;
                finished = true;
            }
        }
    }
    if finished {
        *worker = None;
    }
}

fn apply_final_job(job: &mut ShellJob, final_job: &Value) {
    job.warnings = json_string_array(final_job.get("warnings"));
    job.output_bytes = final_job
        .pointer("/result/verification/outputBytes")
        .and_then(Value::as_u64);
    let completed = final_job
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|status| status == "completed");
    if completed {
        job.status = JobStatus::Completed;
        job.stage = Some("complete".to_owned());
        job.detail = job.output_bytes.map_or_else(
            || Some("Verified V64 output".to_owned()),
            |bytes| Some(format!("VERIFIED - {bytes} BYTES")),
        );
    } else {
        job.status = JobStatus::Failed;
        job.detail = final_job
            .get("error")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| Some("Encoding failed".to_owned()));
    }
}

fn draw(canvas: &mut WindowCanvas, state: &ShellState) -> Result<(), String> {
    let (width, height) = canvas.output_size().map_err(|error| error.to_string())?;
    canvas.set_draw_color(Color::RGB(9, 11, 16));
    canvas.clear();

    draw_text(canvas, 24, 18, "VIDEO64 DROP", 3, Color::RGB(244, 247, 252))?;
    draw_text(
        canvas,
        26,
        48,
        "NATIVE DECODED PREVIEW AND ADVISORY SIZE ESTIMATE",
        1,
        Color::RGB(145, 156, 176),
    )?;

    canvas.set_draw_color(Color::RGB(20, 25, 35));
    canvas
        .fill_rect(Rect::new(20, 72, width.saturating_sub(40), 58))
        .map_err(|error| error.to_string())?;
    canvas.set_draw_color(Color::RGB(77, 96, 128));
    canvas
        .draw_rect(Rect::new(20, 72, width.saturating_sub(40), 58))
        .map_err(|error| error.to_string())?;
    draw_text(
        canvas,
        42,
        85,
        "DROP VIDEO FILES HERE",
        2,
        Color::RGB(224, 230, 241),
    )?;
    draw_text(
        canvas,
        42,
        111,
        "SOURCE AUDIO USES PROVISIONAL AM1; EXACT SIZE FOLLOWS VERIFIED ENCODE",
        1,
        Color::RGB(238, 183, 93),
    )?;

    for (index, control) in Control::ALL.iter().copied().enumerate() {
        let rect = control_rect(index);
        canvas.set_draw_color(if control == state.focus {
            Color::RGB(38, 61, 92)
        } else {
            Color::RGB(23, 29, 40)
        });
        canvas.fill_rect(rect).map_err(|error| error.to_string())?;
        canvas.set_draw_color(if control == state.focus {
            Color::RGB(109, 162, 222)
        } else {
            Color::RGB(62, 73, 91)
        });
        canvas.draw_rect(rect).map_err(|error| error.to_string())?;
        draw_text(
            canvas,
            rect.x() + 10,
            rect.y() + 9,
            control.label(),
            1,
            Color::RGB(151, 164, 184),
        )?;
        draw_text(
            canvas,
            rect.x() + 10,
            rect.y() + 33,
            &state.settings.value_label(control),
            1,
            Color::RGB(244, 247, 252),
        )?;
    }

    draw_preview(canvas, state, width)?;
    draw_queue(canvas, state, width)?;

    draw_text(
        canvas,
        24,
        i32::try_from(height).unwrap_or(i32::MAX) - 23,
        "TAB CONTROLS  LEFT RIGHT CHANGE  UP DOWN SELECT  P PREVIEW  E ENCODE  ESC QUIT",
        1,
        Color::RGB(87, 100, 120),
    )?;

    draw_button(
        canvas,
        preview_button(),
        "P  PREVIEW",
        matches!(&state.preview, PreviewState::Running { .. }),
    )?;
    draw_button(canvas, encode_button(), "E  ENCODE", state.batch_active)?;

    let title = format!(
        "Video64 Drop - {} file(s) - {}",
        state.jobs.len(),
        state.notice
    );
    canvas
        .window_mut()
        .set_title(&title)
        .map_err(|error| error.to_string())?;
    canvas.present();
    Ok(())
}

fn draw_preview(canvas: &mut WindowCanvas, state: &ShellState, width: u32) -> Result<(), String> {
    let outer = Rect::new(20, PREVIEW_Y, width.saturating_sub(40), PREVIEW_HEIGHT);
    canvas.set_draw_color(Color::RGB(14, 18, 26));
    canvas.fill_rect(outer).map_err(|error| error.to_string())?;
    canvas.set_draw_color(Color::RGB(49, 60, 78));
    canvas.draw_rect(outer).map_err(|error| error.to_string())?;

    let gap = 16u32;
    let panel_width = outer.width().saturating_sub(gap + 32) / 2;
    let left = Rect::new(36, PREVIEW_Y + 34, panel_width, 230);
    let right_x = 36 + i32::try_from(panel_width + gap).unwrap_or(0);
    let right = Rect::new(right_x, PREVIEW_Y + 34, panel_width, 230);
    draw_text(
        canvas,
        left.x(),
        PREVIEW_Y + 12,
        "SOURCE",
        1,
        Color::RGB(151, 164, 184),
    )?;
    draw_text(
        canvas,
        right.x(),
        PREVIEW_Y + 12,
        "DECODED V64",
        1,
        Color::RGB(151, 164, 184),
    )?;
    canvas.set_draw_color(Color::RGB(5, 7, 10));
    canvas.fill_rect(left).map_err(|error| error.to_string())?;
    canvas.fill_rect(right).map_err(|error| error.to_string())?;

    match &state.preview {
        PreviewState::Empty => {
            draw_text(
                canvas,
                42,
                PREVIEW_Y + 142,
                "SELECT A FILE AND PRESS P TO RUN REAL SAMPLED PROOF ENCODES",
                1,
                Color::RGB(92, 105, 125),
            )?;
        }
        PreviewState::Running { input } => {
            draw_text(
                canvas,
                42,
                PREVIEW_Y + 142,
                &format!(
                    "BUILDING PREVIEW FOR {}",
                    truncate_ascii(&file_label(input), 70)
                ),
                1,
                Color::RGB(102, 190, 245),
            )?;
        }
        PreviewState::Ready(result) => {
            draw_rgb_image(canvas, &result.source, left)?;
            draw_rgb_image(canvas, &result.decoded, right)?;
            draw_text(
                canvas,
                36,
                PREVIEW_Y + 278,
                &truncate_ascii(
                    &format!(
                        "ADVISORY ESTIMATE {}  LIKELY {} - {}  SAMPLE AT {:.2} S",
                        format_bytes(result.central_bytes),
                        format_bytes(result.low_bytes),
                        format_bytes(result.high_bytes),
                        result.timestamp_seconds
                    ),
                    126,
                ),
                1,
                Color::RGB(238, 183, 93),
            )?;
            draw_text(
                canvas,
                36,
                PREVIEW_Y + 299,
                "DECODED OUTPUT SHOWN; EXACT POST ENCODE VERIFICATION REMAINS AUTHORITATIVE",
                1,
                Color::RGB(126, 139, 160),
            )?;
        }
        PreviewState::Failed { input, error } => {
            draw_text(
                canvas,
                42,
                PREVIEW_Y + 128,
                &format!(
                    "PREVIEW FAILED FOR {}",
                    truncate_ascii(&file_label(input), 64)
                ),
                1,
                Color::RGB(235, 105, 105),
            )?;
            draw_text(
                canvas,
                42,
                PREVIEW_Y + 153,
                &truncate_ascii(error, 110),
                1,
                Color::RGB(235, 105, 105),
            )?;
        }
    }
    Ok(())
}

fn draw_rgb_image(canvas: &mut WindowCanvas, image: &RgbImage, bounds: Rect) -> Result<(), String> {
    let creator = canvas.texture_creator();
    let mut texture = creator
        .create_texture_streaming(PixelFormatEnum::RGB24, image.width, image.height)
        .map_err(|error| error.to_string())?;
    let pitch = usize::try_from(image.width)
        .ok()
        .and_then(|width| width.checked_mul(3))
        .ok_or_else(|| "Preview texture pitch overflow".to_owned())?;
    texture
        .update(None, &image.pixels, pitch)
        .map_err(|error| error.to_string())?;
    let target = fit_rect(image.width, image.height, bounds);
    canvas
        .copy(&texture, None, target)
        .map_err(|error| error.to_string())
}

fn fit_rect(image_width: u32, image_height: u32, bounds: Rect) -> Rect {
    let width_limited_height =
        u64::from(bounds.width()) * u64::from(image_height) / u64::from(image_width.max(1));
    let (width, height) = if width_limited_height <= u64::from(bounds.height()) {
        (
            bounds.width(),
            u32::try_from(width_limited_height).unwrap_or(bounds.height()),
        )
    } else {
        let height = bounds.height();
        let width = u64::from(height) * u64::from(image_width) / u64::from(image_height.max(1));
        (u32::try_from(width).unwrap_or(bounds.width()), height)
    };
    let x = bounds.x() + i32::try_from(bounds.width().saturating_sub(width) / 2).unwrap_or(0);
    let y = bounds.y() + i32::try_from(bounds.height().saturating_sub(height) / 2).unwrap_or(0);
    Rect::new(x, y, width.max(1), height.max(1))
}

fn draw_queue(canvas: &mut WindowCanvas, state: &ShellState, width: u32) -> Result<(), String> {
    draw_text(canvas, 22, 563, "QUEUE", 2, Color::RGB(229, 234, 244))?;
    draw_text(
        canvas,
        112,
        568,
        "UP DOWN SELECT  DELETE REMOVE  R RETRY  O OPEN",
        1,
        Color::RGB(119, 132, 153),
    )?;
    if state.jobs.is_empty() {
        draw_text(
            canvas,
            34,
            QUEUE_Y + 18,
            "NO FILES QUEUED",
            2,
            Color::RGB(92, 105, 125),
        )?;
    }
    for (index, job) in state.jobs.iter().take(MAX_VISIBLE_JOBS).enumerate() {
        let y = QUEUE_Y + i32::try_from(index).unwrap_or(0) * QUEUE_ROW_HEIGHT;
        let selected = index == state.selected;
        canvas.set_draw_color(if selected {
            Color::RGB(30, 45, 65)
        } else {
            Color::RGB(16, 20, 29)
        });
        canvas
            .fill_rect(Rect::new(
                20,
                y,
                width.saturating_sub(40),
                u32::try_from(QUEUE_ROW_HEIGHT - 3).unwrap_or(0),
            ))
            .map_err(|error| error.to_string())?;
        let status_color = match job.status {
            JobStatus::Queued => Color::RGB(151, 164, 184),
            JobStatus::Running => Color::RGB(102, 190, 245),
            JobStatus::Completed => Color::RGB(116, 210, 151),
            JobStatus::Failed => Color::RGB(235, 105, 105),
        };
        draw_text(canvas, 32, y + 6, job.status.label(), 1, status_color)?;
        draw_text(
            canvas,
            134,
            y + 6,
            &truncate_ascii(&file_label(&job.input), 56),
            1,
            Color::RGB(231, 235, 242),
        )?;
        let detail = job.detail.as_deref().unwrap_or("WAITING");
        draw_text(
            canvas,
            134,
            y + 23,
            &truncate_ascii(detail, 78),
            1,
            Color::RGB(126, 139, 160),
        )?;
        if job.status == JobStatus::Running {
            draw_progress(
                canvas,
                922,
                y + 13,
                230,
                stage_progress(job.stage.as_deref()),
            )?;
        }
    }
    let selected_warning = state
        .jobs
        .get(state.selected)
        .and_then(|job| job.warnings.first())
        .map_or("NO ACTIVE WARNING", String::as_str);
    draw_text(
        canvas,
        24,
        724,
        &truncate_ascii(selected_warning, 126),
        1,
        if selected_warning == "NO ACTIVE WARNING" {
            Color::RGB(90, 103, 122)
        } else {
            Color::RGB(238, 183, 93)
        },
    )?;
    draw_text(
        canvas,
        24,
        745,
        &truncate_ascii(&state.notice, 126),
        1,
        Color::RGB(151, 164, 184),
    )?;
    Ok(())
}

fn draw_button(
    canvas: &mut WindowCanvas,
    rect: Rect,
    label: &str,
    active: bool,
) -> Result<(), String> {
    canvas.set_draw_color(if active {
        Color::RGB(41, 94, 121)
    } else {
        Color::RGB(38, 72, 112)
    });
    canvas.fill_rect(rect).map_err(|error| error.to_string())?;
    canvas.set_draw_color(Color::RGB(83, 128, 178));
    canvas.draw_rect(rect).map_err(|error| error.to_string())?;
    draw_text(
        canvas,
        rect.x() + 20,
        rect.y() + 15,
        label,
        1,
        Color::RGB(244, 248, 252),
    )
}

fn format_bytes(bytes: u64) -> String {
    const KIB: u64 = 1024;
    const MIB: u64 = KIB * KIB;
    if bytes >= MIB {
        let tenths = bytes.saturating_mul(10) / MIB;
        format!("{}.{} MB", tenths / 10, tenths % 10)
    } else if bytes >= KIB {
        let tenths = bytes.saturating_mul(10) / KIB;
        format!("{}.{} KB", tenths / 10, tenths % 10)
    } else {
        format!("{bytes} B")
    }
}

fn draw_progress(
    canvas: &mut Canvas<Window>,
    x: i32,
    y: i32,
    width: u32,
    progress_percent: u32,
) -> Result<(), String> {
    canvas.set_draw_color(Color::RGB(31, 37, 48));
    canvas
        .fill_rect(Rect::new(x, y, width, 10))
        .map_err(|error| error.to_string())?;
    let filled = width.saturating_mul(progress_percent.min(100)) / 100;
    canvas.set_draw_color(Color::RGB(83, 160, 218));
    canvas
        .fill_rect(Rect::new(x, y, filled, 10))
        .map_err(|error| error.to_string())
}

fn stage_progress(stage: Option<&str>) -> u32 {
    match stage {
        Some("analysis") => 12,
        Some("video_encode") => 48,
        Some("audio_encode") => 70,
        Some("mux") => 84,
        Some("verify") => 94,
        Some("complete") => 100,
        _ => 3,
    }
}

fn file_label(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_else(|| path.to_str().unwrap_or("UNKNOWN"))
        .to_owned()
}

fn truncate_ascii(text: &str, maximum: usize) -> String {
    let uppercase = text.to_ascii_uppercase();
    if uppercase.chars().count() <= maximum {
        return uppercase;
    }
    let retained = maximum.saturating_sub(3);
    let mut output = uppercase.chars().take(retained).collect::<String>();
    output.push_str("...");
    output
}

fn draw_text(
    canvas: &mut Canvas<Window>,
    x: i32,
    y: i32,
    text: &str,
    scale: u32,
    color: Color,
) -> Result<(), String> {
    canvas.set_draw_color(color);
    let scale_i32 = i32::try_from(scale).map_err(|_| "Text scale overflow".to_owned())?;
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
                        cursor + i32::from(column) * scale_i32,
                        y + i32::try_from(row).unwrap_or(0) * scale_i32,
                        scale,
                        scale,
                    ))
                    .map_err(|error| error.to_string())?;
            }
        }
        cursor = cursor.saturating_add(6 * scale_i32);
    }
    Ok(())
}

fn glyph_rows(character: char) -> [u8; 7] {
    match character.to_ascii_uppercase() {
        'A' => [14, 17, 17, 31, 17, 17, 17],
        'B' => [30, 17, 17, 30, 17, 17, 30],
        'C' => [15, 16, 16, 16, 16, 16, 15],
        'D' => [30, 17, 17, 17, 17, 17, 30],
        'E' => [31, 16, 16, 30, 16, 16, 31],
        'F' => [31, 16, 16, 30, 16, 16, 16],
        'G' => [15, 16, 16, 19, 17, 17, 15],
        'H' => [17, 17, 17, 31, 17, 17, 17],
        'I' => [31, 4, 4, 4, 4, 4, 31],
        'J' => [7, 2, 2, 2, 18, 18, 12],
        'K' => [17, 18, 20, 24, 20, 18, 17],
        'L' => [16, 16, 16, 16, 16, 16, 31],
        'M' => [17, 27, 21, 21, 17, 17, 17],
        'N' => [17, 25, 21, 19, 17, 17, 17],
        'O' => [14, 17, 17, 17, 17, 17, 14],
        'P' => [30, 17, 17, 30, 16, 16, 16],
        'Q' => [14, 17, 17, 17, 21, 18, 13],
        'R' => [30, 17, 17, 30, 20, 18, 17],
        'S' => [15, 16, 16, 14, 1, 1, 30],
        'T' => [31, 4, 4, 4, 4, 4, 4],
        'U' => [17, 17, 17, 17, 17, 17, 14],
        'V' => [17, 17, 17, 17, 17, 10, 4],
        'W' => [17, 17, 17, 21, 21, 21, 10],
        'X' => [17, 17, 10, 4, 10, 17, 17],
        'Y' => [17, 17, 10, 4, 4, 4, 4],
        'Z' => [31, 1, 2, 4, 8, 16, 31],
        '0' => [14, 17, 19, 21, 25, 17, 14],
        '1' => [4, 12, 4, 4, 4, 4, 14],
        '2' => [14, 17, 1, 2, 4, 8, 31],
        '3' => [30, 1, 1, 14, 1, 1, 30],
        '4' => [2, 6, 10, 18, 31, 2, 2],
        '5' => [31, 16, 16, 30, 1, 1, 30],
        '6' => [14, 16, 16, 30, 17, 17, 14],
        '7' => [31, 1, 2, 4, 8, 8, 8],
        '8' => [14, 17, 17, 14, 17, 17, 14],
        '9' => [14, 17, 17, 15, 1, 1, 14],
        '-' => [0, 0, 0, 31, 0, 0, 0],
        '_' => [0, 0, 0, 0, 0, 0, 31],
        '.' => [0, 0, 0, 0, 0, 12, 12],
        '/' => [1, 1, 2, 4, 8, 16, 16],
        ':' => [0, 12, 12, 0, 12, 12, 0],
        '(' => [2, 4, 8, 8, 8, 4, 2],
        ')' => [8, 4, 2, 2, 2, 4, 8],
        '!' => [4, 4, 4, 4, 4, 0, 4],
        '?' => [14, 17, 1, 2, 4, 0, 4],
        _ => [0; 7],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_support_preview_encode_and_windowed_modes() {
        let parsed = parse_options(&[
            "--core-cli".into(),
            "core.mjs".into(),
            "--smoke-presents".into(),
            "3".into(),
            "--smoke-drop".into(),
            "dropped.mp4".into(),
            "--smoke-preview".into(),
            "preview.mp4".into(),
            "one.mp4".into(),
            "two.mkv".into(),
        ])
        .unwrap();
        assert_eq!(parsed.core_cli, PathBuf::from("core.mjs"));
        assert_eq!(parsed.smoke_presents, Some(3));
        assert_eq!(parsed.smoke_drop, Some(PathBuf::from("dropped.mp4")));
        assert_eq!(parsed.smoke_preview, Some(PathBuf::from("preview.mp4")));
        assert_eq!(parsed.inputs.len(), 2);
        assert!(parse_options(&["--smoke-presents".into(), "0".into()]).is_err());

        let preview = parse_options(&[
            "--headless-preview".into(),
            "input.mp4".into(),
            "preview-dir".into(),
            "--headless-report".into(),
            "report.json".into(),
        ])
        .unwrap();
        assert_eq!(
            preview.headless_preview,
            Some((PathBuf::from("input.mp4"), PathBuf::from("preview-dir")))
        );
    }

    #[test]
    fn packaged_runtime_candidates_are_relative_to_the_executable() {
        let executable = Path::new("/opt/video64-drop/video64-drop");
        assert_eq!(
            node_candidates(executable),
            vec![
                PathBuf::from("/opt/video64-drop/runtime/node/bin/node"),
                PathBuf::from("/opt/video64-drop/node/bin/node"),
                PathBuf::from("/opt/video64-drop/node"),
            ]
        );
    }

    #[test]
    fn stage_progress_is_monotonic() {
        let values = [
            stage_progress(Some("analysis")),
            stage_progress(Some("video_encode")),
            stage_progress(Some("audio_encode")),
            stage_progress(Some("mux")),
            stage_progress(Some("verify")),
            stage_progress(Some("complete")),
        ];
        assert!(values.windows(2).all(|pair| pair[0] <= pair[1]));
    }

    #[test]
    fn display_text_is_bounded_and_ascii() {
        assert_eq!(truncate_ascii("hello", 8), "HELLO");
        assert_eq!(truncate_ascii("abcdefghij", 8), "ABCDE...");
        assert_eq!(format_bytes(31_348), "30.6 KB");
    }

    #[test]
    fn ppm_loader_accepts_binary_rgb_and_comments() {
        let directory =
            env::temp_dir().join(format!("video64-drop-ppm-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("fixture.ppm");
        let mut bytes = b"P6\n# fixture\n2 1\n255\n".to_vec();
        bytes.extend([1, 2, 3, 4, 5, 6]);
        fs::write(&path, bytes).unwrap();
        let image = load_ppm(&path).unwrap();
        assert_eq!((image.width, image.height), (2, 1));
        assert_eq!(image.pixels, [1, 2, 3, 4, 5, 6]);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn fit_rect_preserves_aspect_ratio() {
        assert_eq!(
            fit_rect(320, 180, Rect::new(0, 0, 640, 480)),
            Rect::new(0, 60, 640, 360)
        );
        assert_eq!(
            fit_rect(180, 320, Rect::new(0, 0, 640, 480)),
            Rect::new(185, 0, 270, 480)
        );
    }
}
