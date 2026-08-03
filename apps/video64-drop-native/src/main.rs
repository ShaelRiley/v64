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
use sdl2::pixels::Color;
use sdl2::rect::Rect;
use sdl2::render::{Canvas, WindowCanvas};
use sdl2::video::Window;
use serde_json::{Value, json};
use video64_drop_native::{
    Control, SHELL_ENCODE_REPORT_FORMAT, SHELL_REPORT_FORMAT, ShellSettings, control_vocabulary,
    shell_capabilities,
};

const WINDOW_WIDTH: u32 = 1_000;
const WINDOW_HEIGHT: u32 = 720;
const CONTROL_Y: i32 = 162;
const CONTROL_WIDTH: u32 = 180;
const CONTROL_HEIGHT: u32 = 66;
const CONTROL_GAP: i32 = 14;
const QUEUE_Y: i32 = 286;
const QUEUE_ROW_HEIGHT: i32 = 48;
const MAX_VISIBLE_JOBS: usize = 6;
fn encode_button() -> Rect {
    Rect::new(810, 650, 170, 46)
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
    smoke_presents: Option<u32>,
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

#[derive(Debug)]
struct ShellState {
    settings: ShellSettings,
    focus: Control,
    jobs: Vec<ShellJob>,
    selected: usize,
    batch_active: bool,
    notice: String,
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
        }
    }
}

#[derive(Debug)]
enum WorkerMessage {
    Progress {
        stage: Option<String>,
        detail: Option<String>,
    },
    Finished(Value),
    Failed(String),
}

#[derive(Debug)]
struct ActiveWorker {
    job_index: usize,
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
        node: env::var_os("VIDEO64_DROP_NODE").unwrap_or_else(|| OsString::from("node")),
        cli: options.core_cli.clone(),
    };

    if let Some((input, output)) = options.headless_encode.as_ref() {
        let report_path = options
            .headless_report
            .as_deref()
            .ok_or("--headless-encode requires --headless-report")?;
        return write_headless_encode_report(&core, input, output, report_path).map_err(Into::into);
    }
    if let Some(report_path) = options.headless_report.as_deref() {
        return write_headless_shell_report(&core, &options.inputs, report_path)
            .map_err(Into::into);
    }

    run_windowed(&core, options.inputs, options.smoke_presents).map_err(Into::into)
}

fn usage() -> &'static str {
    "usage: video64-drop [--core-cli PATH] [--smoke-presents N] [INPUT ...]\n       video64-drop --headless-report REPORT.json [INPUT ...]\n       video64-drop --headless-encode INPUT OUTPUT.v64 --headless-report REPORT.json"
}

fn parse_options(arguments: &[OsString]) -> Result<Options, String> {
    let mut core_cli = default_core_cli_path();
    let mut headless_report = None;
    let mut headless_encode = None;
    let mut smoke_presents = None;
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
            Some(value) if value.starts_with('-') => return Err(usage().to_owned()),
            _ => inputs.push(PathBuf::from(&arguments[index])),
        }
        index += 1;
    }
    Ok(Options {
        core_cli,
        headless_report,
        headless_encode,
        smoke_presents,
        inputs,
    })
}

fn default_core_cli_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../video64-drop/cli.mjs")
}

fn core_output(core: &CoreConfig, arguments: &[OsString]) -> Result<std::process::Output, String> {
    Command::new(&core.node)
        .arg(&core.cli)
        .args(arguments)
        .output()
        .map_err(|error| format!("Unable to start Video64 Drop core: {error}"))
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
            "encodeQueue": "Enter or E",
            "retryFailed": "R",
            "removeQueued": "Delete",
            "openCompletedOutput": "O",
            "quit": "Escape",
        },
        "coreCli": core.cli,
        "transitionalBoundary": {
            "sourceAudioEncoding": true,
            "audioBitrateFrozen": false,
            "decodedPreview": false,
            "sampledSizeEstimator": false,
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
    let mut worker: Option<ActiveWorker> = None;
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
                    "Encoding is active; quit after the current file completes"
                        .clone_into(&mut state.notice);
                }
                Event::DropFile { filename, .. } => {
                    add_inputs(core, &mut state, vec![PathBuf::from(filename)])?;
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
                } => adjust_settings(core, &mut state, -1),
                Event::KeyDown {
                    keycode: Some(Keycode::Right),
                    repeat: false,
                    ..
                } => adjust_settings(core, &mut state, 1),
                Event::KeyDown {
                    keycode: Some(Keycode::Up),
                    repeat: false,
                    ..
                } => state.selected = state.selected.saturating_sub(1),
                Event::KeyDown {
                    keycode: Some(Keycode::Down),
                    repeat: false,
                    ..
                } => {
                    if !state.jobs.is_empty() {
                        state.selected = (state.selected + 1).min(state.jobs.len() - 1);
                    }
                }
                Event::KeyDown {
                    keycode: Some(Keycode::Return | Keycode::KpEnter | Keycode::E),
                    repeat: false,
                    ..
                } => begin_batch(&mut state),
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
                } => handle_click(core, &mut state, x, y),
                _ => {}
            }
        }

        draw(&mut canvas, &state)?;
        presented = presented.saturating_add(1);
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
    if state.jobs.is_empty() {
        state.selected = 0;
    } else {
        state.selected = state.selected.min(state.jobs.len() - 1);
    }
    state.notice = format!("{} file(s) in queue", state.jobs.len());
    Ok(())
}

fn adjust_settings(core: &CoreConfig, state: &mut ShellState, direction: i8) {
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
            state.notice = format!(
                "{} set to {}",
                state.focus.label(),
                state.settings.value_label(state.focus)
            );
        }
        Err(error) => state.notice = error,
    }
}

fn begin_batch(state: &mut ShellState) {
    if state.jobs.iter().any(|job| job.status == JobStatus::Queued) {
        state.batch_active = true;
        "Encoding queued files".clone_into(&mut state.notice);
    } else {
        "No queued files are ready to encode".clone_into(&mut state.notice);
    }
}

fn remove_selected(state: &mut ShellState) {
    if state
        .jobs
        .get(state.selected)
        .is_some_and(|job| matches!(job.status, JobStatus::Queued | JobStatus::Failed))
    {
        state.jobs.remove(state.selected);
        state.selected = state.selected.min(state.jobs.len().saturating_sub(1));
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

fn handle_click(core: &CoreConfig, state: &mut ShellState, x: i32, y: i32) {
    if encode_button().contains_point((x, y)) {
        begin_batch(state);
        return;
    }
    for (index, control) in Control::ALL.iter().copied().enumerate() {
        let rect = control_rect(index);
        if rect.contains_point((x, y)) {
            state.focus = control;
            let midpoint = rect.x() + i32::try_from(rect.width() / 2).unwrap_or(0);
            adjust_settings(core, state, if x < midpoint { -1 } else { 1 });
            return;
        }
    }
    let row = (y - QUEUE_Y).div_euclid(QUEUE_ROW_HEIGHT);
    if row >= 0 {
        let index = usize::try_from(row).unwrap_or(usize::MAX);
        if index < state.jobs.len().min(MAX_VISIBLE_JOBS) {
            state.selected = index;
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
    let receiver = spawn_encode_worker(core.clone(), state.settings.clone(), job);
    *worker = Some(ActiveWorker {
        job_index: index,
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
                    let _ = progress_sender.send(WorkerMessage::Progress {
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
                let _ = sender.send(WorkerMessage::Finished(final_job));
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

fn process_worker_messages(state: &mut ShellState, worker: &mut Option<ActiveWorker>) {
    let Some(active) = worker.as_ref() else {
        return;
    };
    let index = active.job_index;
    let messages = active.receiver.try_iter().collect::<Vec<_>>();
    let mut finished = false;
    for message in messages {
        match message {
            WorkerMessage::Progress { stage, detail } => {
                if let Some(job) = state.jobs.get_mut(index) {
                    job.stage = stage;
                    job.detail = detail;
                }
            }
            WorkerMessage::Finished(final_job) => {
                apply_final_job(&mut state.jobs[index], &final_job);
                state.notice = format!("Completed {}", file_label(&state.jobs[index].input));
                finished = true;
            }
            WorkerMessage::Failed(error) => {
                if let Some(job) = state.jobs.get_mut(index) {
                    job.status = JobStatus::Failed;
                    job.detail = Some(error.clone());
                }
                state.notice = error;
                state.batch_active = false;
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

    draw_text(canvas, 24, 20, "VIDEO64 DROP", 3, Color::RGB(244, 247, 252))?;
    draw_text(
        canvas,
        26,
        50,
        "LINUX NATIVE SHELL - DROP FILES OR PASS THEM ON THE COMMAND LINE",
        1,
        Color::RGB(145, 156, 176),
    )?;

    canvas.set_draw_color(Color::RGB(20, 25, 35));
    canvas
        .fill_rect(Rect::new(20, 76, width.saturating_sub(40), 64))
        .map_err(|error| error.to_string())?;
    canvas.set_draw_color(Color::RGB(77, 96, 128));
    canvas
        .draw_rect(Rect::new(20, 76, width.saturating_sub(40), 64))
        .map_err(|error| error.to_string())?;
    draw_text(
        canvas,
        42,
        91,
        "DROP VIDEO FILES HERE",
        2,
        Color::RGB(224, 230, 241),
    )?;
    draw_text(
        canvas,
        42,
        118,
        "SOURCE AUDIO USES PROVISIONAL AM1; BITRATE AWAITS BLINDED LISTENING",
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
            rect.y() + 10,
            control.label(),
            1,
            Color::RGB(151, 164, 184),
        )?;
        draw_text(
            canvas,
            rect.x() + 10,
            rect.y() + 34,
            &state.settings.value_label(control),
            1,
            Color::RGB(244, 247, 252),
        )?;
    }

    draw_text(canvas, 22, 252, "QUEUE", 2, Color::RGB(229, 234, 244))?;
    draw_text(
        canvas,
        112,
        257,
        "UP/DOWN SELECT  -  ENTER OR E ENCODE  -  DELETE REMOVE  -  R RETRY  -  O OPEN",
        1,
        Color::RGB(119, 132, 153),
    )?;

    if state.jobs.is_empty() {
        draw_text(
            canvas,
            34,
            QUEUE_Y + 24,
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
                u32::try_from(QUEUE_ROW_HEIGHT - 4).unwrap_or(0),
            ))
            .map_err(|error| error.to_string())?;
        let status_color = match job.status {
            JobStatus::Queued => Color::RGB(151, 164, 184),
            JobStatus::Running => Color::RGB(102, 190, 245),
            JobStatus::Completed => Color::RGB(116, 210, 151),
            JobStatus::Failed => Color::RGB(235, 105, 105),
        };
        draw_text(canvas, 32, y + 8, job.status.label(), 1, status_color)?;
        draw_text(
            canvas,
            134,
            y + 8,
            &truncate_ascii(&file_label(&job.input), 48),
            1,
            Color::RGB(231, 235, 242),
        )?;
        let detail = job.detail.as_deref().unwrap_or("WAITING");
        draw_text(
            canvas,
            134,
            y + 27,
            &truncate_ascii(detail, 70),
            1,
            Color::RGB(126, 139, 160),
        )?;
        if job.status == JobStatus::Running {
            draw_progress(
                canvas,
                760,
                y + 13,
                190,
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
        594,
        &truncate_ascii(selected_warning, 118),
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
        622,
        &truncate_ascii(&state.notice, 118),
        1,
        Color::RGB(151, 164, 184),
    )?;

    canvas.set_draw_color(if state.batch_active {
        Color::RGB(41, 94, 121)
    } else {
        Color::RGB(38, 72, 112)
    });
    canvas
        .fill_rect(encode_button())
        .map_err(|error| error.to_string())?;
    draw_text(
        canvas,
        encode_button().x() + 22,
        encode_button().y() + 15,
        if state.batch_active {
            "ENCODING"
        } else {
            "ENCODE QUEUE"
        },
        1,
        Color::RGB(244, 248, 252),
    )?;
    draw_text(
        canvas,
        24,
        i32::try_from(height).unwrap_or(i32::MAX) - 26,
        "TAB FOCUS  LEFT/RIGHT CHANGE  ESC QUIT AFTER CURRENT FILE",
        1,
        Color::RGB(87, 100, 120),
    )?;

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
    fn options_support_headless_and_windowed_modes() {
        let parsed = parse_options(&[
            "--core-cli".into(),
            "core.mjs".into(),
            "--smoke-presents".into(),
            "3".into(),
            "one.mp4".into(),
            "two.mkv".into(),
        ])
        .unwrap();
        assert_eq!(parsed.core_cli, PathBuf::from("core.mjs"));
        assert_eq!(parsed.smoke_presents, Some(3));
        assert_eq!(parsed.inputs.len(), 2);
        assert!(parse_options(&["--smoke-presents".into(), "0".into()]).is_err());
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
        assert_eq!(values.last().copied(), Some(100));
    }

    #[test]
    fn display_text_is_bounded_and_ascii() {
        assert_eq!(truncate_ascii("movie.mp4", 20), "MOVIE.MP4");
        assert_eq!(truncate_ascii("abcdefghijklmnopqrstuvwxyz", 8), "ABCDE...");
        assert_ne!(glyph_rows('A'), [0; 7]);
        assert_eq!(glyph_rows('@'), [0; 7]);
    }
}
