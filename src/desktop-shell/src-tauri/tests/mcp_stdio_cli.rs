use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddrV4, TcpListener};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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

#[test]
fn exact_cli_mode_bridges_stdio_without_starting_the_gui() {
    let executable = PathBuf::from(env!("CARGO_BIN_EXE_scadmill"));
    let manifest_path = manifest_path_for_executable(&executable);
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .expect("test relay should bind");
    listener
        .set_nonblocking(false)
        .expect("test relay should be blocking");
    let port = listener
        .local_addr()
        .expect("relay address should exist")
        .port();
    let token = "a".repeat(64);
    fs::write(
        &manifest_path,
        serde_json::json!({
            "version": 1,
            "address": "127.0.0.1",
            "port": port,
            "token": token,
            "pid": std::process::id(),
        })
        .to_string(),
    )
    .expect("endpoint manifest should be written");

    let mut child = Command::new(&executable)
        .arg("--mcp-stdio")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("MCP relay process should start");
    let (stream, peer) = listener.accept().expect("relay process should connect");
    assert!(peer.ip().is_loopback());
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("relay timeout should be configured");
    let mut server_reader = BufReader::new(stream.try_clone().expect("relay stream should clone"));
    let mut auth = String::new();
    server_reader
        .read_line(&mut auth)
        .expect("relay authentication should be readable");
    assert_eq!(auth, format!("SCADMILL-MCP/1 {token}\n"));

    let request = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n";
    let mut child_stdin = child.stdin.take().expect("child stdin should be piped");
    child_stdin
        .write_all(request.as_bytes())
        .and_then(|_| child_stdin.flush())
        .expect("MCP request should be written to stdio");
    let mut relayed_request = String::new();
    server_reader
        .read_line(&mut relayed_request)
        .expect("relayed request should be readable");
    assert_eq!(relayed_request, request);

    let response = "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n";
    let mut server_writer = stream;
    server_writer
        .write_all(response.as_bytes())
        .and_then(|_| server_writer.flush())
        .expect("relay response should be written");
    let mut relayed_response = String::new();
    BufReader::new(child.stdout.take().expect("child stdout should be piped"))
        .read_line(&mut relayed_response)
        .expect("stdio response should be readable");
    assert_eq!(relayed_response, response);

    drop(child_stdin);
    server_writer
        .shutdown(Shutdown::Both)
        .expect("test relay should close");
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child
            .try_wait()
            .expect("relay process status should be readable")
        {
            assert!(
                status.success(),
                "relay process should exit cleanly: {status}"
            );
            break;
        }
        assert!(
            Instant::now() < deadline,
            "relay process did not exit after its server closed"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    let _ = fs::remove_file(manifest_path);
}
