from pathlib import Path

path = Path("apps/video64-drop-native/src/main.rs")
text = path.read_text()

old = '''    let core = CoreConfig {
        node: env::var_os("VIDEO64_DROP_NODE").unwrap_or_else(|| OsString::from("node")),
        cli: options.core_cli.clone(),
    };'''
new = '''    let core = CoreConfig {
        node: env::var_os("VIDEO64_DROP_NODE").unwrap_or_else(default_node_path),
        cli: options.core_cli.clone(),
    };'''
if old not in text:
    raise SystemExit("CoreConfig construction contract changed")
text = text.replace(old, new, 1)

old = '''fn default_core_cli_path() -> PathBuf {
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

fn core_output(core: &CoreConfig, arguments: &[OsString]) -> Result<std::process::Output, String> {
    Command::new(&core.node)
        .arg(&core.cli)
        .args(arguments)
        .output()
        .map_err(|error| format!("Unable to start Video64 Drop core: {error}"))
}'''
new = '''fn default_core_cli_path() -> PathBuf {
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
}'''
if old not in text:
    raise SystemExit("Runtime helper contract changed")
text = text.replace(old, new, 1)

old = '''        "coreCli": core.cli,
        "transitionalBoundary": {'''
new = '''        "coreCli": core.cli,
        "nodeRuntime": core.node,
        "transitionalBoundary": {'''
if old not in text:
    raise SystemExit("Headless report contract changed")
text = text.replace(old, new, 1)

anchor = '''    #[test]
    fn stage_progress_is_monotonic() {'''
test = '''    #[test]
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
    fn stage_progress_is_monotonic() {'''
if anchor not in text:
    raise SystemExit("Test insertion point changed")
text = text.replace(anchor, test, 1)
path.write_text(text)
