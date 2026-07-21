use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

fn manifest_path_for_executable(executable: &Path) -> PathBuf {
    let canonical = executable
        .canonicalize()
        .unwrap_or_else(|_| executable.to_path_buf());
    let identity = if cfg!(windows) {
        canonical.to_string_lossy().to_lowercase()
    } else {
        canonical.to_string_lossy().into_owned()
    };
    let digest = Sha256::digest(identity.as_bytes());
    let suffix = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    std::env::temp_dir().join(format!("scadmill-mcp-{suffix}.json"))
}

fn wait_bounded(child: &mut Child, timeout: Duration) -> ExitStatus {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child
            .try_wait()
            .expect("CLI process status should be readable")
        {
            return status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("MCP CLI did not exit within {timeout:?}");
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn exact_cli_mode_fails_closed_without_an_enabled_gui() {
    let executable = PathBuf::from(env!("CARGO_BIN_EXE_scadmill"));
    let manifest_path = manifest_path_for_executable(&executable);
    assert!(
        !manifest_path.exists(),
        "the exact debug executable must not have an enabled GUI endpoint during this test"
    );

    let mut child = Command::new(&executable)
        .arg("--mcp-stdio")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("MCP CLI process should start");
    let status = wait_bounded(&mut child, Duration::from_secs(5));
    let mut stdout = Vec::new();
    child
        .stdout
        .take()
        .expect("CLI stdout should be piped")
        .read_to_end(&mut stdout)
        .expect("CLI stdout should be readable");
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .expect("CLI stderr should be piped")
        .read_to_string(&mut stderr)
        .expect("CLI stderr should be readable");

    assert_eq!(status.code(), Some(2));
    assert!(
        stdout.is_empty(),
        "the failed CLI must not emit protocol output"
    );
    assert!(
        stderr.contains("ScadMill MCP relay unavailable: the desktop MCP toggle is off"),
        "the failed CLI should explain the fail-closed state: {stderr}"
    );
    assert!(
        !manifest_path.exists(),
        "the failed CLI must not create an endpoint manifest"
    );
}
