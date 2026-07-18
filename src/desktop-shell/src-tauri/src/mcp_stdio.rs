use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
#[cfg(unix)]
use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
#[cfg(windows)]
use std::{ffi::OsStr, os::windows::ffi::OsStrExt, os::windows::io::FromRawHandle};
use tauri::{AppHandle, Emitter, State};

pub const MCP_REQUEST_EVENT: &str = "scadmill://mcp-request";
pub const MCP_CONNECTION_EVENT: &str = "scadmill://mcp-connection";
const MAX_FRAME_BYTES: usize = 1_048_576;
const AUTH_LINE_LIMIT: usize = 256;
const RELAY_VERSION: u8 = 1;
const AUTH_PREFIX: &str = "SCADMILL-MCP/1 ";

#[derive(Clone, Debug, Deserialize, Serialize)]
struct RelayManifest {
    version: u8,
    address: String,
    port: u16,
    token: String,
    pid: u32,
    process_start_id: String,
}

type RequestCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;
type ConnectionCallback = Arc<dyn Fn(bool) + Send + Sync + 'static>;

struct McpRelay {
    manifest_path: PathBuf,
    port: u16,
    stop_requested: Arc<AtomicBool>,
    client: Arc<Mutex<Option<TcpStream>>>,
    worker: Option<JoinHandle<()>>,
}

impl McpRelay {
    #[cfg(test)]
    fn start<F>(manifest_path: PathBuf, on_request: F) -> Result<Self, String>
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        Self::start_with_connection(manifest_path, on_request, |_| {})
    }

    fn start_with_connection<F, G>(
        manifest_path: PathBuf,
        on_request: F,
        on_connection: G,
    ) -> Result<Self, String>
    where
        F: Fn(String) + Send + Sync + 'static,
        G: Fn(bool) + Send + Sync + 'static,
    {
        let _ = fs::remove_file(&manifest_path);
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .map_err(|error| format!("Could not bind the MCP loopback relay: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("Could not configure the MCP loopback relay: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("Could not inspect the MCP loopback relay: {error}"))?
            .port();
        let token =
            session_token().map_err(|error| format!("Could not secure the MCP relay: {error}"))?;
        let process_start_id = process_identity(std::process::id())
            .map(|identity| encode_process_start_id(identity.start_id))
            .ok_or_else(|| "Could not identify the ScadMill desktop process.".to_string())?;
        let manifest = RelayManifest {
            version: RELAY_VERSION,
            address: Ipv4Addr::LOCALHOST.to_string(),
            port,
            token: token.clone(),
            pid: std::process::id(),
            process_start_id,
        };
        write_manifest_atomically(&manifest_path, &manifest)?;

        let stop_requested = Arc::new(AtomicBool::new(false));
        let client = Arc::new(Mutex::new(None));
        let worker_stop = Arc::clone(&stop_requested);
        let worker_client = Arc::clone(&client);
        let callback: RequestCallback = Arc::new(on_request);
        let connection_callback: ConnectionCallback = Arc::new(on_connection);
        let worker = std::thread::Builder::new()
            .name("scadmill-mcp-relay".to_string())
            .spawn(move || {
                relay_loop(
                    listener,
                    token,
                    worker_stop,
                    worker_client,
                    callback,
                    connection_callback,
                )
            })
            .map_err(|error| {
                let _ = fs::remove_file(&manifest_path);
                format!("Could not start the MCP relay worker: {error}")
            })?;

        Ok(Self {
            manifest_path,
            port,
            stop_requested,
            client,
            worker: Some(worker),
        })
    }

    fn write_response(&self, line: &str) -> Result<(), String> {
        validate_protocol_line(line, "response")?;
        let mut client = self
            .client
            .lock()
            .map_err(|_| "The MCP client connection lock failed.".to_string())?;
        let stream = client
            .as_mut()
            .ok_or_else(|| "No authenticated MCP client is connected.".to_string())?;
        if let Err(error) = stream
            .write_all(line.as_bytes())
            .and_then(|_| stream.flush())
        {
            let _ = stream.shutdown(Shutdown::Both);
            *client = None;
            return Err(format!("Could not write the MCP response: {error}"));
        }
        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        let _ = fs::remove_file(&self.manifest_path);
        self.stop_requested.store(true, Ordering::Release);
        if let Ok(mut client) = self.client.lock()
            && let Some(stream) = client.take()
        {
            let _ = stream.shutdown(Shutdown::Both);
        }
        let _ = TcpStream::connect_timeout(
            &SocketAddrV4::new(Ipv4Addr::LOCALHOST, self.port).into(),
            Duration::from_millis(100),
        );
        if let Some(worker) = self.worker.take() {
            worker
                .join()
                .map_err(|_| "The MCP relay worker did not stop cleanly.".to_string())?;
        }
        Ok(())
    }
}

impl Drop for McpRelay {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[derive(Default)]
struct McpStdioInner {
    enabled: AtomicBool,
    relay: Mutex<Option<McpRelay>>,
}

impl Drop for McpStdioInner {
    fn drop(&mut self) {
        if let Ok(relay) = self.relay.get_mut()
            && let Some(mut relay) = relay.take()
        {
            let _ = relay.stop();
        }
    }
}

#[derive(Clone, Default)]
pub struct McpStdioBridge(Arc<McpStdioInner>);

impl McpStdioBridge {
    fn enabled(&self) -> bool {
        self.0.enabled.load(Ordering::Acquire)
    }

    fn set_enabled(&self, app: AppHandle, enabled: bool) -> Result<(), String> {
        if enabled {
            let mut relay = self
                .0
                .relay
                .lock()
                .map_err(|_| "The MCP relay state lock failed.".to_string())?;
            if relay.is_some() {
                self.0.enabled.store(true, Ordering::Release);
                return Ok(());
            }
            let executable = std::env::current_exe()
                .map_err(|error| format!("Could not locate the ScadMill executable: {error}"))?;
            let manifest_path = manifest_path_for_executable(&executable);
            let request_app = app.clone();
            let next = McpRelay::start_with_connection(
                manifest_path,
                move |line| {
                    let _ = request_app.emit(MCP_REQUEST_EVENT, line);
                },
                move |connected| {
                    let _ = app.emit(MCP_CONNECTION_EVENT, connected);
                },
            )?;
            *relay = Some(next);
            self.0.enabled.store(true, Ordering::Release);
            return Ok(());
        }

        self.0.enabled.store(false, Ordering::Release);
        let relay = self
            .0
            .relay
            .lock()
            .map_err(|_| "The MCP relay state lock failed.".to_string())?
            .take();
        if let Some(mut relay) = relay {
            relay.stop()?;
        }
        Ok(())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn mcp_set_enabled(
    app: AppHandle,
    bridge: State<'_, McpStdioBridge>,
    enabled: bool,
) -> Result<(), String> {
    bridge.set_enabled(app, enabled)
}

#[tauri::command(rename_all = "camelCase")]
pub fn mcp_write_response(bridge: State<'_, McpStdioBridge>, line: String) -> Result<(), String> {
    if !bridge.enabled() {
        return Err("The MCP stdio server is disabled.".to_string());
    }
    bridge
        .0
        .relay
        .lock()
        .map_err(|_| "The MCP relay state lock failed.".to_string())?
        .as_ref()
        .ok_or_else(|| "The MCP stdio server is disabled.".to_string())?
        .write_response(&line)
}

pub fn run_mcp_stdio_client() -> i32 {
    match run_mcp_stdio_client_inner() {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("ScadMill MCP relay unavailable: {error}");
            2
        }
    }
}

fn run_mcp_stdio_client_inner() -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("could not locate the ScadMill executable: {error}"))?;
    let manifest_path = manifest_path_for_executable(&executable);
    let manifest = read_client_manifest(&manifest_path, &executable)?;
    let mut stream = TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, manifest.port).into(),
        Duration::from_secs(2),
    )
    .map_err(|error| format!("could not connect to the enabled desktop app: {error}"))?;
    writeln!(stream, "{AUTH_PREFIX}{}", manifest.token)
        .and_then(|_| stream.flush())
        .map_err(|error| format!("could not authenticate with the desktop app: {error}"))?;

    let mut request_stream = stream
        .try_clone()
        .map_err(|error| format!("could not open the MCP request channel: {error}"))?;
    std::thread::spawn(move || {
        let stdin = io::stdin();
        let mut input = stdin.lock();
        loop {
            match read_bounded_line(&mut input, MAX_FRAME_BYTES) {
                Ok(Some(line)) => {
                    if request_stream
                        .write_all(&line)
                        .and_then(|_| request_stream.flush())
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(None) => {
                    let _ = request_stream.shutdown(Shutdown::Write);
                    break;
                }
                Err(_) => {
                    let _ = request_stream.shutdown(Shutdown::Both);
                    break;
                }
            }
        }
    });

    let stdout = io::stdout();
    let mut output = stdout.lock();
    let mut reader = BufReader::new(stream);
    loop {
        match read_bounded_line(&mut reader, MAX_FRAME_BYTES)
            .map_err(|error| format!("invalid response from the desktop app: {error}"))?
        {
            Some(line) => output
                .write_all(&line)
                .and_then(|_| output.flush())
                .map_err(|error| format!("could not write the MCP response: {error}"))?,
            None => return Ok(()),
        }
    }
}

fn relay_loop(
    listener: TcpListener,
    token: String,
    stop_requested: Arc<AtomicBool>,
    client: Arc<Mutex<Option<TcpStream>>>,
    on_request: RequestCallback,
    on_connection: ConnectionCallback,
) {
    while !stop_requested.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((stream, address)) => {
                if !address.ip().is_loopback() {
                    let _ = stream.shutdown(Shutdown::Both);
                    continue;
                }
                handle_client(
                    stream,
                    &token,
                    &stop_requested,
                    &client,
                    &on_request,
                    &on_connection,
                );
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => break,
        }
    }
}

fn handle_client(
    stream: TcpStream,
    token: &str,
    stop_requested: &AtomicBool,
    client: &Mutex<Option<TcpStream>>,
    on_request: &RequestCallback,
    on_connection: &ConnectionCallback,
) {
    if stream
        .set_read_timeout(Some(Duration::from_millis(250)))
        .is_err()
    {
        return;
    }
    let writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    let mut reader = BufReader::new(stream);
    let auth = match read_bounded_line(&mut reader, AUTH_LINE_LIMIT) {
        Ok(Some(auth)) => auth,
        _ => return,
    };
    let expected = format!("{AUTH_PREFIX}{token}\n");
    if !constant_time_equal(&auth, expected.as_bytes()) {
        return;
    }
    if let Ok(mut active) = client.lock() {
        if active.is_some() {
            return;
        }
        *active = Some(writer);
    } else {
        return;
    }
    on_connection(true);

    while !stop_requested.load(Ordering::Acquire) {
        match read_bounded_line(&mut reader, MAX_FRAME_BYTES) {
            Ok(Some(line)) => match String::from_utf8(line) {
                Ok(line) => on_request(line),
                Err(_) => break,
            },
            Ok(None) => break,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) => {}
            Err(_) => break,
        }
    }
    if let Ok(mut active) = client.lock()
        && let Some(stream) = active.take()
    {
        let _ = stream.shutdown(Shutdown::Both);
    }
    on_connection(false);
}

fn validate_protocol_line(line: &str, kind: &str) -> Result<(), String> {
    if !line.ends_with('\n')
        || line[..line.len() - 1].contains('\n')
        || line.len() > MAX_FRAME_BYTES
    {
        return Err(format!(
            "MCP {kind} must be one newline-terminated frame no larger than 1 MiB."
        ));
    }
    Ok(())
}

fn read_bounded_line<R: BufRead>(reader: &mut R, limit: usize) -> io::Result<Option<Vec<u8>>> {
    let mut line = Vec::with_capacity(256);
    let read = (&mut *reader)
        .take((limit + 2) as u64)
        .read_until(b'\n', &mut line)?;
    if read == 0 {
        return Ok(None);
    }
    if line.len() > limit || line.last() != Some(&b'\n') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "MCP frame is not a bounded newline-terminated record",
        ));
    }
    Ok(Some(line))
}

fn manifest_path_for_executable(executable: &Path) -> PathBuf {
    let identity = if cfg!(windows) {
        executable
            .to_string_lossy()
            .replace('/', "\\")
            .to_lowercase()
    } else {
        executable
            .canonicalize()
            .unwrap_or_else(|_| executable.to_path_buf())
            .to_string_lossy()
            .into_owned()
    };
    let digest = Sha256::digest(identity.as_bytes());
    let suffix = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    std::env::temp_dir().join(format!("scadmill-mcp-{suffix}.json"))
}

fn write_manifest_atomically(path: &Path, manifest: &RelayManifest) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The MCP endpoint manifest has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the MCP manifest directory: {error}"))?;
    let temporary = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        &manifest.token[..16]
    ));
    let bytes = serde_json::to_vec(manifest)
        .map_err(|error| format!("Could not encode the MCP endpoint manifest: {error}"))?;
    let _ = fs::remove_file(&temporary);
    let mut file = create_private_manifest_file(&temporary)
        .map_err(|error| format!("Could not create the MCP endpoint manifest: {error}"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Could not persist the MCP endpoint manifest: {error}"))?;
    drop(file);
    let _ = fs::remove_file(path);
    fs::rename(&temporary, path)
        .map_err(|error| format!("Could not publish the MCP endpoint manifest: {error}"))
}

fn read_manifest(path: &Path) -> Result<RelayManifest, String> {
    let bytes = fs::read(path).map_err(|_| "the desktop MCP toggle is off".to_string())?;
    if bytes.len() > 4096 {
        return Err("the endpoint manifest is oversized".to_string());
    }
    let manifest: RelayManifest = serde_json::from_slice(&bytes)
        .map_err(|_| "the endpoint manifest is invalid".to_string())?;
    if manifest.version != RELAY_VERSION
        || manifest.address != Ipv4Addr::LOCALHOST.to_string()
        || manifest.port == 0
        || manifest.token.len() != 64
        || !manifest
            .token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || manifest.pid == 0
        || parse_process_start_id(&manifest.process_start_id).is_none()
    {
        return Err("the endpoint manifest failed validation".to_string());
    }
    Ok(manifest)
}

fn read_client_manifest(path: &Path, executable: &Path) -> Result<RelayManifest, String> {
    let result = read_manifest(path).and_then(|manifest| {
        if process_matches_executable(manifest.pid, &manifest.process_start_id, executable) {
            Ok(manifest)
        } else {
            Err("the endpoint manifest belongs to a stale or different process".to_string())
        }
    });
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

fn normalized_executable_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

struct ProcessIdentity {
    executable: PathBuf,
    start_id: u64,
}

fn encode_process_start_id(start_id: u64) -> String {
    format!("{start_id:016x}")
}

fn parse_process_start_id(start_id: &str) -> Option<u64> {
    if start_id.len() != 16
        || !start_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return None;
    }
    u64::from_str_radix(start_id, 16)
        .ok()
        .filter(|value| *value != 0)
}

fn process_matches_executable(pid: u32, start_id: &str, executable: &Path) -> bool {
    let Some(start_id) = parse_process_start_id(start_id) else {
        return false;
    };
    process_identity(pid)
        .map(|identity| {
            identity.start_id == start_id
                && executable_paths_equal(&identity.executable, executable)
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn executable_paths_equal(left: &Path, right: &Path) -> bool {
    normalized_executable_path(left)
        .to_string_lossy()
        .eq_ignore_ascii_case(&normalized_executable_path(right).to_string_lossy())
}

#[cfg(not(windows))]
fn executable_paths_equal(left: &Path, right: &Path) -> bool {
    normalized_executable_path(left) == normalized_executable_path(right)
}

#[cfg(windows)]
fn process_identity(pid: u32) -> Option<ProcessIdentity> {
    type Handle = *mut core::ffi::c_void;
    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit_handle: i32, process_id: u32) -> Handle;
        fn QueryFullProcessImageNameW(
            process: Handle,
            flags: u32,
            executable_name: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn GetProcessTimes(
            process: Handle,
            creation_time: *mut FileTime,
            exit_time: *mut FileTime,
            kernel_time: *mut FileTime,
            user_time: *mut FileTime,
        ) -> i32;
        fn CloseHandle(object: Handle) -> i32;
    }
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    // SAFETY: the handle is checked for null, the output buffer is writable for the supplied
    // capacity, and every successfully opened process handle is closed before returning.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut buffer = vec![0_u16; 32_768];
        let mut length = buffer.len() as u32;
        let queried = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length);
        let mut creation_time = FileTime { low: 0, high: 0 };
        let mut exit_time = FileTime { low: 0, high: 0 };
        let mut kernel_time = FileTime { low: 0, high: 0 };
        let mut user_time = FileTime { low: 0, high: 0 };
        let times_queried = GetProcessTimes(
            process,
            &mut creation_time,
            &mut exit_time,
            &mut kernel_time,
            &mut user_time,
        );
        let _ = CloseHandle(process);
        if queried == 0 || length == 0 || times_queried == 0 {
            return None;
        }
        buffer.truncate(length as usize);
        let start_id = (u64::from(creation_time.high) << 32) | u64::from(creation_time.low);
        (start_id != 0).then(|| ProcessIdentity {
            executable: PathBuf::from(String::from_utf16_lossy(&buffer)),
            start_id,
        })
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn process_identity(pid: u32) -> Option<ProcessIdentity> {
    let executable = fs::read_link(format!("/proc/{pid}/exe")).ok()?;
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let after_name = stat.rsplit_once(')')?.1.trim_start();
    let start_id = after_name.split_whitespace().nth(19)?.parse().ok()?;
    (start_id != 0).then_some(ProcessIdentity {
        executable,
        start_id,
    })
}

#[cfg(target_os = "macos")]
fn process_identity(pid: u32) -> Option<ProcessIdentity> {
    #[repr(C)]
    struct ProcBsdInfo {
        flags: u32,
        status: u32,
        xstatus: u32,
        pid: u32,
        ppid: u32,
        uid: u32,
        gid: u32,
        ruid: u32,
        rgid: u32,
        svuid: u32,
        svgid: u32,
        reserved: u32,
        command: [u8; 16],
        name: [u8; 32],
        open_files: u32,
        process_group: u32,
        job_control_count: u32,
        controlling_terminal: u32,
        terminal_process_group: u32,
        nice: i32,
        start_seconds: u64,
        start_microseconds: u64,
    }
    #[link(name = "proc")]
    unsafe extern "C" {
        fn proc_pidpath(pid: i32, buffer: *mut core::ffi::c_void, buffer_size: u32) -> i32;
        fn proc_pidinfo(
            pid: i32,
            flavor: i32,
            argument: u64,
            buffer: *mut core::ffi::c_void,
            buffer_size: i32,
        ) -> i32;
    }
    const PROC_PIDTBSDINFO: i32 = 3;
    let Ok(pid) = i32::try_from(pid) else {
        return None;
    };
    let mut buffer = vec![0_u8; 4096];
    // SAFETY: proc_pidpath receives a valid writable buffer and its exact byte capacity.
    let length = unsafe {
        proc_pidpath(
            pid,
            buffer.as_mut_ptr().cast::<core::ffi::c_void>(),
            buffer.len() as u32,
        )
    };
    if length <= 0 {
        return None;
    }
    buffer.truncate(length as usize);
    let executable = PathBuf::from(String::from_utf8_lossy(&buffer).into_owned());
    let mut process_info = std::mem::MaybeUninit::<ProcBsdInfo>::zeroed();
    // SAFETY: proc_pidinfo receives a writable buffer sized exactly for ProcBsdInfo.
    let info_length = unsafe {
        proc_pidinfo(
            pid,
            PROC_PIDTBSDINFO,
            0,
            process_info.as_mut_ptr().cast::<core::ffi::c_void>(),
            std::mem::size_of::<ProcBsdInfo>() as i32,
        )
    };
    if info_length != std::mem::size_of::<ProcBsdInfo>() as i32 {
        return None;
    }
    // SAFETY: proc_pidinfo reported that it initialized the complete structure.
    let process_info = unsafe { process_info.assume_init() };
    let start_id = process_info
        .start_seconds
        .checked_mul(1_000_000)?
        .checked_add(process_info.start_microseconds)?;
    (start_id != 0).then_some(ProcessIdentity {
        executable,
        start_id,
    })
}

#[cfg(all(
    unix,
    not(any(target_os = "linux", target_os = "android", target_os = "macos"))
))]
fn process_identity(_pid: u32) -> Option<ProcessIdentity> {
    None
}

#[cfg(unix)]
fn create_private_manifest_file(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut options = OpenOptions::new();
    options.create_new(true).write(true).mode(0o600);
    options.open(path)
}

#[cfg(windows)]
fn create_private_manifest_file(path: &Path) -> io::Result<fs::File> {
    type Handle = *mut core::ffi::c_void;
    #[repr(C)]
    struct SecurityAttributes {
        length: u32,
        security_descriptor: *mut core::ffi::c_void,
        inherit_handle: i32,
    }
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
            descriptor: *const u16,
            revision: u32,
            security_descriptor: *mut *mut core::ffi::c_void,
            descriptor_size: *mut u32,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateFileW(
            file_name: *const u16,
            desired_access: u32,
            share_mode: u32,
            security_attributes: *mut SecurityAttributes,
            creation_disposition: u32,
            flags_and_attributes: u32,
            template_file: Handle,
        ) -> Handle;
        fn LocalFree(memory: Handle) -> Handle;
    }
    const SDDL_REVISION_1: u32 = 1;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const CREATE_NEW: u32 = 1;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;
    const INVALID_HANDLE_VALUE: Handle = -1_isize as Handle;

    let descriptor_text: Vec<u16> = OsStr::new("D:P(A;;GA;;;OW)")
        .encode_wide()
        .chain(Some(0))
        .collect();
    let file_name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut descriptor = std::ptr::null_mut();
    // SAFETY: Windows receives valid NUL-terminated UTF-16 strings. The allocated security
    // descriptor is freed after CreateFileW, and a successful raw handle is transferred once.
    unsafe {
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            descriptor_text.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }
        let mut attributes = SecurityAttributes {
            length: std::mem::size_of::<SecurityAttributes>() as u32,
            security_descriptor: descriptor,
            inherit_handle: 0,
        };
        let handle = CreateFileW(
            file_name.as_ptr(),
            GENERIC_WRITE,
            0,
            &mut attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        );
        let _ = LocalFree(descriptor);
        if handle == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        Ok(fs::File::from_raw_handle(handle))
    }
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn session_token() -> io::Result<String> {
    let mut bytes = [0_u8; 32];
    fill_os_random(&mut bytes)?;
    Ok(bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>())
}

#[cfg(windows)]
fn fill_os_random(bytes: &mut [u8]) -> io::Result<()> {
    #[link(name = "bcrypt")]
    unsafe extern "system" {
        fn BCryptGenRandom(
            algorithm: *mut core::ffi::c_void,
            buffer: *mut u8,
            length: u32,
            flags: u32,
        ) -> i32;
    }
    const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 0x0000_0002;
    let length = u32::try_from(bytes.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "random buffer is too large"))?;
    // SAFETY: BCryptGenRandom receives a valid writable byte slice for exactly `length` bytes.
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            length,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status < 0 {
        return Err(io::Error::other(format!(
            "BCryptGenRandom failed with NTSTATUS {status:#x}"
        )));
    }
    Ok(())
}

#[cfg(unix)]
fn fill_os_random(bytes: &mut [u8]) -> io::Result<()> {
    File::open("/dev/urandom")?.read_exact(bytes)
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_FRAME_BYTES, McpRelay, McpStdioBridge, RelayManifest, encode_process_start_id,
        process_identity, read_client_manifest, read_manifest,
    };
    use std::fs;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpStream;
    use std::sync::mpsc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn starts_disabled() {
        assert!(!McpStdioBridge::default().enabled());
    }

    #[test]
    fn relay_endpoint_exists_only_while_enabled_and_forwards_authenticated_frames() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after the Unix epoch")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("scadmill-mcp-test-{}-{unique}", std::process::id()));
        fs::create_dir_all(&root).expect("test directory should be created");
        let manifest_path = root.join("endpoint.json");
        let (request_tx, request_rx) = mpsc::channel();
        let (connection_tx, connection_rx) = mpsc::channel();

        let mut relay = McpRelay::start_with_connection(
            manifest_path.clone(),
            move |line| {
                request_tx
                    .send(line)
                    .expect("request receiver should remain open");
            },
            move |connected| {
                connection_tx
                    .send(connected)
                    .expect("connection receiver should remain open");
            },
        )
        .expect("relay should start");

        let manifest: RelayManifest = serde_json::from_slice(
            &fs::read(&manifest_path).expect("enabled relay should publish its endpoint"),
        )
        .expect("endpoint manifest should be valid JSON");
        let mut client = TcpStream::connect(("127.0.0.1", manifest.port))
            .expect("published endpoint should accept a client");
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("read timeout should be configured");
        writeln!(client, "SCADMILL-MCP/1 {}", manifest.token).expect("auth should be written");
        assert!(
            connection_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("authenticated connection should be announced"),
        );
        writeln!(
            client,
            "{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}}"
        )
        .expect("request should be written");
        assert_eq!(
            request_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("request should reach the GUI relay"),
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n",
        );

        relay
            .write_response("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n")
            .expect("response should reach the authenticated client");
        let mut response = String::new();
        BufReader::new(client.try_clone().expect("client should clone"))
            .read_line(&mut response)
            .expect("response should be readable");
        assert_eq!(response, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n");

        let port = manifest.port;
        relay.stop().expect("relay should stop cleanly");
        assert!(
            !connection_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("connection shutdown should be announced"),
        );
        response.clear();
        assert_eq!(
            BufReader::new(client)
                .read_line(&mut response)
                .expect("disabled relay should close its authenticated client"),
            0,
        );
        assert!(
            !manifest_path.exists(),
            "disabled relay must remove its endpoint manifest"
        );
        assert!(
            TcpStream::connect(("127.0.0.1", port)).is_err(),
            "disabled relay must close its listener"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn relay_rejects_wrong_authentication_and_unbounded_frames() {
        let root = std::env::temp_dir().join(format!(
            "scadmill-mcp-auth-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after the Unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("test directory should be created");
        let manifest_path = root.join("endpoint.json");
        let (request_tx, request_rx) = mpsc::channel();
        let mut relay = McpRelay::start(manifest_path.clone(), move |line| {
            request_tx
                .send(line)
                .expect("request receiver should remain open");
        })
        .expect("relay should start");
        let manifest: RelayManifest =
            serde_json::from_slice(&fs::read(&manifest_path).expect("manifest should exist"))
                .expect("manifest should decode");

        let mut wrong = TcpStream::connect(("127.0.0.1", manifest.port))
            .expect("relay should accept an authentication attempt");
        wrong
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("timeout should be configured");
        writeln!(wrong, "SCADMILL-MCP/1 {}", "0".repeat(64)).expect("wrong auth should send");
        assert_eq!(
            BufReader::new(wrong)
                .read_line(&mut String::new())
                .expect("wrong auth connection should close"),
            0,
        );
        assert!(
            request_rx.try_recv().is_err(),
            "wrong auth must not emit a request"
        );

        let mut oversized = TcpStream::connect(("127.0.0.1", manifest.port))
            .expect("relay should accept a later valid client");
        oversized
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("timeout should be configured");
        writeln!(oversized, "SCADMILL-MCP/1 {}", manifest.token).expect("auth should send");
        oversized
            .write_all(&vec![b'x'; MAX_FRAME_BYTES + 2])
            .expect("oversized bytes should send");
        oversized.flush().expect("oversized bytes should flush");
        assert_eq!(
            BufReader::new(oversized)
                .read_line(&mut String::new())
                .expect("oversized connection should close"),
            0,
        );
        assert!(
            request_rx.try_recv().is_err(),
            "oversized input must not emit a request"
        );

        relay.stop().expect("relay should stop");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn manifest_validation_is_fail_closed() {
        let root = std::env::temp_dir().join(format!(
            "scadmill-mcp-manifest-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after the Unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("test directory should be created");
        let manifest_path = root.join("endpoint.json");
        fs::write(
            &manifest_path,
            r#"{"version":1,"address":"0.0.0.0","port":1234,"token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pid":1,"process_start_id":"0000000000000001"}"#,
        )
        .expect("invalid manifest fixture should be written");
        assert_eq!(
            read_manifest(&manifest_path).expect_err("non-loopback manifest must fail"),
            "the endpoint manifest failed validation",
        );
        fs::write(&manifest_path, vec![b'x'; 4097]).expect("oversized fixture should be written");
        assert_eq!(
            read_manifest(&manifest_path).expect_err("oversized manifest must fail"),
            "the endpoint manifest is oversized",
        );

        let uppercase_token = "A".repeat(64);
        fs::write(
            &manifest_path,
            format!(
                r#"{{"version":1,"address":"127.0.0.1","port":1234,"token":"{uppercase_token}","pid":{},"process_start_id":"0000000000000001"}}"#,
                std::process::id()
            ),
        )
        .expect("uppercase-token fixture should be written");
        assert_eq!(
            read_manifest(&manifest_path).expect_err("uppercase token must fail"),
            "the endpoint manifest failed validation",
        );

        let lowercase_token = "a1".repeat(32);
        fs::write(
            &manifest_path,
            format!(
                r#"{{"version":1,"address":"127.0.0.1","port":1234,"token":"{lowercase_token}","pid":{},"process_start_id":"0000000000000001"}}"#,
                std::process::id()
            ),
        )
        .expect("lowercase-token fixture should be written");
        assert_eq!(
            read_manifest(&manifest_path)
                .expect("canonical lowercase token should pass structural validation")
                .token,
            lowercase_token,
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn client_manifest_rejects_and_removes_a_dead_process() {
        let root = std::env::temp_dir().join(format!(
            "scadmill-mcp-stale-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after the Unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("test directory should be created");
        let manifest_path = root.join("endpoint.json");
        let manifest = RelayManifest {
            version: 1,
            address: "127.0.0.1".to_string(),
            port: 1234,
            token: "ab".repeat(32),
            pid: u32::MAX,
            process_start_id: "0000000000000001".to_string(),
        };
        fs::write(
            &manifest_path,
            serde_json::to_vec(&manifest).expect("fixture should encode"),
        )
        .expect("stale manifest fixture should be written");

        assert_eq!(
            read_client_manifest(
                &manifest_path,
                &std::env::current_exe().expect("test executable should resolve")
            )
            .expect_err("dead process manifest must fail"),
            "the endpoint manifest belongs to a stale or different process",
        );
        assert!(
            !manifest_path.exists(),
            "a rejected stale manifest must be removed fail-closed"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn client_manifest_requires_the_exact_live_executable() {
        let root = std::env::temp_dir().join(format!(
            "scadmill-mcp-owner-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after the Unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("test directory should be created");
        let manifest_path = root.join("endpoint.json");
        let current_process = process_identity(std::process::id())
            .expect("test process identity should be available");
        let mut manifest = RelayManifest {
            version: 1,
            address: "127.0.0.1".to_string(),
            port: 1234,
            token: "01".repeat(32),
            pid: std::process::id(),
            process_start_id: encode_process_start_id(current_process.start_id),
        };

        manifest.process_start_id = encode_process_start_id(
            current_process
                .start_id
                .checked_add(1)
                .expect("test process start identity should increment"),
        );
        fs::write(
            &manifest_path,
            serde_json::to_vec(&manifest).expect("reused-PID fixture should encode"),
        )
        .expect("reused-PID fixture should be written");
        let current_executable = std::env::current_exe().expect("test executable should resolve");
        assert_eq!(
            read_client_manifest(&manifest_path, &current_executable)
                .expect_err("same PID with a different start identity must fail"),
            "the endpoint manifest belongs to a stale or different process",
        );
        assert!(
            !manifest_path.exists(),
            "a PID-reuse manifest must be removed fail-closed"
        );

        manifest.process_start_id = encode_process_start_id(current_process.start_id);
        let encoded = serde_json::to_vec(&manifest).expect("fixture should encode");
        fs::write(&manifest_path, &encoded).expect("live manifest fixture should be written");
        assert_eq!(
            read_client_manifest(&manifest_path, &current_executable)
                .expect("live exact executable should pass")
                .pid,
            std::process::id(),
        );

        fs::write(&manifest_path, encoded).expect("mismatch fixture should be rewritten");
        assert_eq!(
            read_client_manifest(&manifest_path, &root.join("different-scadmill.exe"))
                .expect_err("different executable must fail"),
            "the endpoint manifest belongs to a stale or different process",
        );
        assert!(
            !manifest_path.exists(),
            "an executable-mismatch manifest must be removed fail-closed"
        );
        let _ = fs::remove_dir_all(root);
    }
}
