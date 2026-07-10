use crate::{EngineError, io_error};
use serde::Serialize;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

const STREAMED_OUTPUT_BYTE_LIMIT: usize = 1024 * 1024;
const STREAMED_OUTPUT_RECORD_LIMIT: usize = 4_096;
const STREAMED_EVENTS_PER_POLL: usize = 128;
const OUTPUT_READ_CHUNK_BYTES: usize = 8 * 1024;
const OUTPUT_TRUNCATION_MARKER: &str = "[ScadMill: streamed output truncated at the 1 MiB / 4096-record display limit; complete rawLog retained]\n";
const OUTPUT_CANCELLED_MARKER: &str = "[ScadMill: pending streamed output omitted after the run was cancelled; complete rawLog retained]\n";
const OUTPUT_TIMEOUT_MARKER: &str = "[ScadMill: pending streamed output omitted after the run timed out; complete rawLog retained]\n";

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineOutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineOutputEvent {
    pub sequence: u64,
    pub elapsed_ms: u128,
    pub stream: EngineOutputStream,
    pub raw: String,
}

#[derive(Debug)]
pub(crate) struct ProcessCapture {
    pub exit_code: Option<i32>,
    pub raw_log: String,
    pub success: bool,
}

struct CapturedRecord {
    stream: EngineOutputStream,
    raw: String,
}

struct CaptureState {
    spool: File,
    capture_error: Option<(&'static str, std::io::Error)>,
    streamed_bytes: usize,
    streamed_records: usize,
    truncated_stream: Option<EngineOutputStream>,
}

impl CaptureState {
    fn new(spool: File) -> Self {
        Self {
            spool,
            capture_error: None,
            streamed_bytes: 0,
            streamed_records: 0,
            truncated_stream: None,
        }
    }

    fn record(
        &mut self,
        stream: EngineOutputStream,
        raw: String,
        sender: &mpsc::Sender<CapturedRecord>,
    ) -> bool {
        if self.capture_error.is_none()
            && let Err(source) = self.spool.write_all(raw.as_bytes())
        {
            self.capture_error = Some(("spool OpenSCAD output", source));
        }
        if self.truncated_stream.is_some() {
            return true;
        }
        let next_bytes = self.streamed_bytes.saturating_add(raw.len());
        if self.streamed_records >= STREAMED_OUTPUT_RECORD_LIMIT
            || next_bytes > STREAMED_OUTPUT_BYTE_LIMIT
        {
            self.truncated_stream = Some(stream);
            return true;
        }
        if sender.send(CapturedRecord { stream, raw }).is_err() {
            return false;
        }
        self.streamed_bytes = next_bytes;
        self.streamed_records += 1;
        true
    }
}

fn incomplete_utf8_suffix_len(bytes: &[u8]) -> usize {
    let first_possible_lead = bytes.len().saturating_sub(3);
    for start in first_possible_lead..bytes.len() {
        let suffix = &bytes[start..];
        if let Err(error) = std::str::from_utf8(suffix)
            && error.valid_up_to() == 0
            && error.error_len().is_none()
        {
            return suffix.len();
        }
    }
    0
}

fn lock_capture_state(state: &Mutex<CaptureState>) -> MutexGuard<'_, CaptureState> {
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn read_records(
    reader: impl Read + Send + 'static,
    stream: EngineOutputStream,
    sender: mpsc::Sender<CapturedRecord>,
    capture: Arc<Mutex<CaptureState>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut bytes = Vec::with_capacity(OUTPUT_READ_CHUNK_BYTES);
        let mut pending_utf8 = Vec::with_capacity(OUTPUT_READ_CHUNK_BYTES + 3);
        loop {
            bytes.clear();
            match reader
                .by_ref()
                .take(OUTPUT_READ_CHUNK_BYTES as u64)
                .read_until(b'\n', &mut bytes)
            {
                Ok(0) => {
                    if !pending_utf8.is_empty() {
                        let raw = String::from_utf8_lossy(&pending_utf8).into_owned();
                        let _ = lock_capture_state(&capture).record(stream, raw, &sender);
                    }
                    break;
                }
                Err(source) => {
                    let mut capture = lock_capture_state(&capture);
                    if capture.capture_error.is_none() {
                        capture.capture_error = Some(("read OpenSCAD output", source));
                    }
                    break;
                }
                Ok(_) => {
                    pending_utf8.extend_from_slice(&bytes);
                    let carry_len = incomplete_utf8_suffix_len(&pending_utf8);
                    let complete_len = pending_utf8.len() - carry_len;
                    if complete_len == 0 {
                        continue;
                    }
                    let raw = String::from_utf8_lossy(&pending_utf8[..complete_len]).into_owned();
                    pending_utf8.drain(..complete_len);
                    if !lock_capture_state(&capture).record(stream, raw, &sender) {
                        break;
                    }
                }
            }
        }
    })
}

fn append_available(
    receiver: &Receiver<CapturedRecord>,
    sequence: &AtomicU64,
    started: Instant,
    on_output: &dyn Fn(EngineOutputEvent),
    should_stop: &dyn Fn() -> bool,
) -> bool {
    for _ in 0..STREAMED_EVENTS_PER_POLL {
        if should_stop() {
            return false;
        }
        let Ok(record) = receiver.try_recv() else {
            return true;
        };
        on_output(EngineOutputEvent {
            sequence: sequence.fetch_add(1, Ordering::Relaxed),
            elapsed_ms: started.elapsed().as_millis(),
            stream: record.stream,
            raw: record.raw,
        });
    }
    false
}

fn append_available_with_truncation(
    receiver: &Receiver<CapturedRecord>,
    capture: &Mutex<CaptureState>,
    marker_emitted: &mut bool,
    sequence: &AtomicU64,
    started: Instant,
    on_output: &dyn Fn(EngineOutputEvent),
    should_stop: &dyn Fn() -> bool,
) -> bool {
    if !append_available(receiver, sequence, started, on_output, should_stop) {
        return false;
    }
    if *marker_emitted {
        return true;
    }
    let truncated_stream = lock_capture_state(capture).truncated_stream;
    let Some(stream) = truncated_stream else {
        return true;
    };
    // Every retained record is sent before truncation is published under the same lock.
    // Drain once more after observing it so the marker remains the ordered final event.
    if !append_available(receiver, sequence, started, on_output, should_stop) {
        return false;
    }
    if should_stop() {
        return false;
    }
    on_output(EngineOutputEvent {
        sequence: sequence.fetch_add(1, Ordering::Relaxed),
        elapsed_ms: started.elapsed().as_millis(),
        stream,
        raw: OUTPUT_TRUNCATION_MARKER.to_string(),
    });
    *marker_emitted = true;
    true
}

fn discard_pending_streamed_events(
    receiver: &Receiver<CapturedRecord>,
) -> Option<EngineOutputStream> {
    let mut first_dropped_stream = None;
    while let Ok(record) = receiver.try_recv() {
        first_dropped_stream.get_or_insert(record.stream);
    }
    first_dropped_stream
}

#[derive(Clone, Copy)]
enum StopReason {
    Cancelled,
    Timeout,
}

impl StopReason {
    fn marker(self) -> &'static str {
        match self {
            Self::Cancelled => OUTPUT_CANCELLED_MARKER,
            Self::Timeout => OUTPUT_TIMEOUT_MARKER,
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn emit_terminal_marker(
    capture: &Mutex<CaptureState>,
    dropped_stream: Option<EngineOutputStream>,
    reason: StopReason,
    marker_emitted: &mut bool,
    sequence: &AtomicU64,
    started: Instant,
    on_output: &dyn Fn(EngineOutputEvent),
) {
    if *marker_emitted {
        return;
    }
    let limited_stream = lock_capture_state(capture).truncated_stream;
    let Some(stream) = limited_stream.or(dropped_stream) else {
        return;
    };
    on_output(EngineOutputEvent {
        sequence: sequence.fetch_add(1, Ordering::Relaxed),
        elapsed_ms: started.elapsed().as_millis(),
        stream,
        raw: if limited_stream.is_some() {
            OUTPUT_TRUNCATION_MARKER
        } else {
            reason.marker()
        }
        .to_string(),
    });
    *marker_emitted = true;
}

fn materialize_raw_log(capture: &Mutex<CaptureState>) -> Result<String, EngineError> {
    let mut capture = lock_capture_state(capture);
    if let Some((operation, source)) = capture.capture_error.take() {
        return Err(EngineError::Io { operation, source });
    }
    capture
        .spool
        .flush()
        .map_err(io_error("flush OpenSCAD output spool"))?;
    capture
        .spool
        .seek(SeekFrom::Start(0))
        .map_err(io_error("rewind OpenSCAD output spool"))?;
    let mut bytes = Vec::new();
    capture
        .spool
        .read_to_end(&mut bytes)
        .map_err(io_error("read OpenSCAD output spool"))?;
    drop(capture);
    Ok(match String::from_utf8(bytes) {
        Ok(raw) => raw,
        Err(invalid) => String::from_utf8_lossy(invalid.as_bytes()).into_owned(),
    })
}

#[cfg(target_os = "windows")]
fn terminate_process_tree(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
    let _ = child.wait();
}

struct ChildGuard {
    child: Option<Child>,
}

impl ChildGuard {
    fn spawn(command: &mut Command) -> std::io::Result<Self> {
        command.spawn().map(|child| Self { child: Some(child) })
    }

    fn child_mut(&mut self) -> &mut Child {
        self.child.as_mut().expect("child is still active")
    }

    fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        let status = self.child_mut().try_wait()?;
        if status.is_some() {
            self.child.take();
        }
        Ok(status)
    }

    fn terminate(&mut self) {
        if let Some(mut child) = self.child.take() {
            terminate_process_tree(&mut child);
        }
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[cfg(not(target_os = "windows"))]
fn terminate_process_tree(child: &mut Child) {
    // SAFETY: the child is started as the leader of its own process group below, and the
    // negated OS-assigned child PID addresses only that group.
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn run_command(
    command: &mut Command,
    timeout: Duration,
    cancelled: &AtomicBool,
    sequence: &AtomicU64,
    started: Instant,
    on_output: &dyn Fn(EngineOutputEvent),
) -> Result<ProcessCapture, EngineError> {
    if cancelled.load(Ordering::Acquire) {
        return Err(EngineError::Cancelled { log: String::new() });
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;
        command.process_group(0);
    }
    let capture = Arc::new(Mutex::new(CaptureState::new(
        tempfile::tempfile().map_err(io_error("create OpenSCAD output spool"))?,
    )));
    let mut child = ChildGuard::spawn(command.stdout(Stdio::piped()).stderr(Stdio::piped()))
        .map_err(io_error("start the OpenSCAD engine"))?;
    let stdout = child
        .child_mut()
        .stdout
        .take()
        .expect("stdout was configured as piped");
    let stderr = child
        .child_mut()
        .stderr
        .take()
        .expect("stderr was configured as piped");
    let (sender, receiver) = mpsc::channel();
    let stdout_reader = read_records(
        stdout,
        EngineOutputStream::Stdout,
        sender.clone(),
        Arc::clone(&capture),
    );
    let stderr_reader = read_records(
        stderr,
        EngineOutputStream::Stderr,
        sender,
        Arc::clone(&capture),
    );
    // Declare the armed guard after the pipe readers so unwinding drops it first.
    let mut active_child = child;
    let mut marker_emitted = false;
    let should_stop = || cancelled.load(Ordering::Acquire) || started.elapsed() >= timeout;

    let status = loop {
        let _ = append_available_with_truncation(
            &receiver,
            &capture,
            &mut marker_emitted,
            sequence,
            started,
            on_output,
            &should_stop,
        );
        if cancelled.load(Ordering::Acquire) {
            active_child.terminate();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            let dropped_stream = discard_pending_streamed_events(&receiver);
            emit_terminal_marker(
                &capture,
                dropped_stream,
                StopReason::Cancelled,
                &mut marker_emitted,
                sequence,
                started,
                on_output,
            );
            return Err(EngineError::Cancelled {
                log: materialize_raw_log(&capture)?,
            });
        }
        if started.elapsed() >= timeout {
            active_child.terminate();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            let dropped_stream = discard_pending_streamed_events(&receiver);
            emit_terminal_marker(
                &capture,
                dropped_stream,
                StopReason::Timeout,
                &mut marker_emitted,
                sequence,
                started,
                on_output,
            );
            return Err(EngineError::Timeout {
                log: materialize_raw_log(&capture)?,
            });
        }
        if let Some(status) = active_child
            .try_wait()
            .map_err(io_error("poll the OpenSCAD engine"))?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(5));
    };

    let _ = stdout_reader.join();
    let _ = stderr_reader.join();
    loop {
        let drained = append_available_with_truncation(
            &receiver,
            &capture,
            &mut marker_emitted,
            sequence,
            started,
            on_output,
            &should_stop,
        );
        if cancelled.load(Ordering::Acquire) {
            let dropped_stream = discard_pending_streamed_events(&receiver);
            emit_terminal_marker(
                &capture,
                dropped_stream,
                StopReason::Cancelled,
                &mut marker_emitted,
                sequence,
                started,
                on_output,
            );
            return Err(EngineError::Cancelled {
                log: materialize_raw_log(&capture)?,
            });
        }
        if started.elapsed() >= timeout {
            let dropped_stream = discard_pending_streamed_events(&receiver);
            emit_terminal_marker(
                &capture,
                dropped_stream,
                StopReason::Timeout,
                &mut marker_emitted,
                sequence,
                started,
                on_output,
            );
            return Err(EngineError::Timeout {
                log: materialize_raw_log(&capture)?,
            });
        }
        if drained {
            break;
        }
    }
    Ok(ProcessCapture {
        exit_code: status.code(),
        raw_log: materialize_raw_log(&capture)?,
        success: status.success(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        EngineOutputEvent, EngineOutputStream, OUTPUT_READ_CHUNK_BYTES, OUTPUT_TRUNCATION_MARKER,
        STREAMED_EVENTS_PER_POLL, STREAMED_OUTPUT_BYTE_LIMIT, STREAMED_OUTPUT_RECORD_LIMIT,
        run_command,
    };
    use crate::EngineError;
    use std::env;
    use std::io::{self, Write};
    use std::panic::{AssertUnwindSafe, catch_unwind};
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    const HELPER_MODE: &str = "SCADMILL_PROCESS_TEST_MODE";
    const HEARTBEAT_PATH: &str = "SCADMILL_PROCESS_TEST_HEARTBEAT";

    fn helper_command(mode: &str) -> Command {
        let mut command = Command::new(env::current_exe().expect("current test executable"));
        command
            .args([
                "--exact",
                "process::tests::helper_process",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(HELPER_MODE, mode);
        command
    }

    fn write_flood() {
        let chunk = vec![b'x'; 64 * 1024];
        let mut stdout = io::stdout().lock();
        for _ in 0..32 {
            stdout.write_all(&chunk).expect("write flood chunk");
        }
        stdout.flush().expect("flush flood output");
    }

    fn write_many_lines() {
        write_lines(STREAMED_OUTPUT_RECORD_LIMIT + 1_024);
    }

    fn write_lines(count: usize) {
        let mut stdout = io::stdout().lock();
        stdout.write_all(b"\n").expect("separate harness output");
        for _ in 0..count {
            stdout.write_all(b"x\n").expect("write output line");
        }
        stdout.flush().expect("flush output lines");
    }

    fn write_utf8_boundary() {
        let mut stderr = io::stderr().lock();
        stderr
            .write_all(&vec![b'x'; OUTPUT_READ_CHUNK_BYTES - 1])
            .expect("write UTF-8 boundary prefix");
        stderr
            .write_all("é\n".as_bytes())
            .expect("write split UTF-8 code point");
        stderr.flush().expect("flush UTF-8 boundary output");
    }

    #[test]
    fn helper_process() {
        match env::var(HELPER_MODE).as_deref() {
            Ok("interleave") => {
                println!("stdout-one");
                io::stdout().flush().expect("flush stdout");
                thread::sleep(Duration::from_millis(20));
                eprintln!("stderr-one");
                io::stderr().flush().expect("flush stderr");
            }
            Ok("sleep") => thread::sleep(Duration::from_secs(10)),
            Ok("flood") => write_flood(),
            Ok("many-lines") => write_many_lines(),
            Ok("queued-lines") => write_lines(1_024),
            Ok("utf8-boundary") => write_utf8_boundary(),
            Ok("many-lines-then-sleep") => {
                write_many_lines();
                thread::sleep(Duration::from_secs(10));
            }
            Ok("flood-then-sleep") => {
                write_flood();
                thread::sleep(Duration::from_secs(10));
            }
            Ok("spawn-child") => {
                let heartbeat = env::var(HEARTBEAT_PATH).expect("heartbeat path");
                let mut child = helper_command("heartbeat");
                child.env(HEARTBEAT_PATH, heartbeat);
                // This deliberately orphanable descendant is reaped by the process-tree
                // termination behavior that the timeout test exercises.
                #[allow(clippy::zombie_processes)]
                let _child = child.spawn().expect("spawn heartbeat child");
                thread::sleep(Duration::from_secs(10));
            }
            Ok("spawn-child-and-log") => {
                let heartbeat = env::var(HEARTBEAT_PATH).expect("heartbeat path");
                let mut child = helper_command("heartbeat");
                child.env(HEARTBEAT_PATH, heartbeat);
                #[allow(clippy::zombie_processes)]
                let _child = child.spawn().expect("spawn heartbeat child");
                let heartbeat_path = env::var(HEARTBEAT_PATH).expect("heartbeat path");
                let deadline = Instant::now() + Duration::from_secs(2);
                while !std::path::Path::new(&heartbeat_path).exists() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(5));
                }
                println!("ready");
                io::stdout().flush().expect("flush ready output");
                thread::sleep(Duration::from_secs(10));
            }
            Ok("heartbeat") => {
                let heartbeat = env::var(HEARTBEAT_PATH).expect("heartbeat path");
                for count in 0_u32..500 {
                    std::fs::write(&heartbeat, count.to_string()).expect("write heartbeat");
                    thread::sleep(Duration::from_millis(10));
                }
            }
            _ => {}
        }
    }

    #[test]
    fn sequences_stdout_and_stderr_records_from_their_arrival_order() {
        let events = Mutex::new(Vec::<EngineOutputEvent>::new());
        let result = run_command(
            &mut helper_command("interleave"),
            Duration::from_secs(2),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
            Instant::now(),
            &|event| events.lock().expect("event lock").push(event),
        )
        .expect("helper should finish");

        assert!(result.success);
        let events = events.lock().expect("event lock");
        let stdout = events
            .iter()
            .position(|event| event.raw.contains("stdout-one\n"))
            .expect("stdout record");
        let stderr = events
            .iter()
            .position(|event| event.raw.contains("stderr-one\n"))
            .expect("stderr record");
        assert!(stdout < stderr);
        assert_eq!(events[stdout].stream, EngineOutputStream::Stdout);
        assert_eq!(events[stderr].stream, EngineOutputStream::Stderr);
        assert!(
            events
                .windows(2)
                .all(|pair| pair[0].sequence < pair[1].sequence)
        );
    }

    #[test]
    fn preserves_utf8_code_points_split_at_the_read_boundary() {
        let events = Mutex::new(Vec::<EngineOutputEvent>::new());
        let result = run_command(
            &mut helper_command("utf8-boundary"),
            Duration::from_secs(2),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
            Instant::now(),
            &|event| events.lock().expect("event lock").push(event),
        )
        .expect("UTF-8 helper should finish");

        let streamed_stderr = events
            .lock()
            .expect("event lock")
            .iter()
            .filter(|event| event.stream == EngineOutputStream::Stderr)
            .map(|event| event.raw.as_str())
            .collect::<String>();
        assert!(streamed_stderr.ends_with("é\n"), "{streamed_stderr:?}");
        assert!(!streamed_stderr.contains('\u{fffd}'), "{streamed_stderr:?}");
        assert!(result.raw_log.contains('é'), "{:?}", result.raw_log);
        assert!(!result.raw_log.contains('\u{fffd}'), "{:?}", result.raw_log);
    }

    #[test]
    fn bounds_high_volume_raw_log_records_and_streamed_events() {
        let events = Mutex::new(Vec::<EngineOutputEvent>::new());
        let result = run_command(
            &mut helper_command("flood"),
            Duration::from_secs(5),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
            Instant::now(),
            &|event| events.lock().expect("event lock").push(event),
        )
        .expect("flood helper should finish");

        assert!(result.success);
        assert_eq!(
            result.raw_log.bytes().filter(|byte| *byte == b'x').count(),
            2 * 1024 * 1024
        );
        assert!(!result.raw_log.contains(OUTPUT_TRUNCATION_MARKER));
        let events = events.lock().expect("event lock");
        assert!(events.len() <= STREAMED_OUTPUT_RECORD_LIMIT + 1);
        assert_eq!(
            events.last().map(|event| event.raw.as_str()),
            Some(OUTPUT_TRUNCATION_MARKER)
        );
        assert!(
            events.iter().map(|event| event.raw.len()).sum::<usize>()
                <= STREAMED_OUTPUT_BYTE_LIMIT + OUTPUT_TRUNCATION_MARKER.len(),
        );
        assert!(
            events[..events.len() - 1]
                .iter()
                .all(|event| event.raw.len() <= OUTPUT_READ_CHUNK_BYTES),
        );
        assert!(
            events
                .windows(2)
                .all(|pair| pair[0].sequence < pair[1].sequence),
        );
    }

    #[test]
    fn bounds_many_small_output_records() {
        let events = Mutex::new(Vec::<EngineOutputEvent>::new());
        let result = run_command(
            &mut helper_command("many-lines"),
            Duration::from_secs(5),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
            Instant::now(),
            &|event| events.lock().expect("event lock").push(event),
        )
        .expect("many-lines helper should finish");

        assert!(result.success);
        assert_eq!(
            result.raw_log.lines().filter(|line| *line == "x").count(),
            STREAMED_OUTPUT_RECORD_LIMIT + 1_024,
        );
        assert!(!result.raw_log.contains(OUTPUT_TRUNCATION_MARKER));
        let events = events.lock().expect("event lock");
        assert!(events.len() <= STREAMED_OUTPUT_RECORD_LIMIT + 1);
        assert_eq!(
            events.last().map(|event| event.raw.as_str()),
            Some(OUTPUT_TRUNCATION_MARKER)
        );
    }

    #[test]
    fn remains_cancellable_after_high_volume_output_is_truncated() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let trigger = Arc::clone(&cancelled);
        let canceller = thread::spawn(move || {
            thread::sleep(Duration::from_millis(150));
            trigger.store(true, Ordering::Release);
        });
        let started = Instant::now();
        let events = Mutex::new(Vec::<EngineOutputEvent>::new());
        let result = run_command(
            &mut helper_command("flood-then-sleep"),
            Duration::from_secs(5),
            &cancelled,
            &AtomicU64::new(0),
            started,
            &|event| events.lock().expect("event lock").push(event),
        );
        canceller.join().expect("canceller should finish");

        let EngineError::Cancelled { log } = result.expect_err("flood helper should be cancelled")
        else {
            unreachable!("expected cancellation")
        };
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(
            log.bytes().filter(|byte| *byte == b'x').count(),
            2 * 1024 * 1024
        );
        assert!(!log.contains(OUTPUT_TRUNCATION_MARKER));
        let events = events.lock().expect("event lock");
        assert!(events.len() <= STREAMED_OUTPUT_RECORD_LIMIT + 1);
        assert_eq!(
            events.last().map(|event| event.raw.as_str()),
            Some(OUTPUT_TRUNCATION_MARKER)
        );
    }

    #[test]
    fn cancellation_checks_are_not_starved_by_slow_stream_consumers() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let trigger = Arc::clone(&cancelled);
        let canceller = thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            trigger.store(true, Ordering::Release);
        });
        let started = Instant::now();
        let result = run_command(
            &mut helper_command("many-lines-then-sleep"),
            Duration::from_secs(10),
            &cancelled,
            &AtomicU64::new(0),
            started,
            &|_| thread::sleep(Duration::from_millis(1)),
        );
        canceller.join().expect("canceller should finish");

        assert!(matches!(result, Err(EngineError::Cancelled { .. })));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "slow streamed-event callbacks delayed cancellation for {:?}",
            started.elapsed(),
        );
    }

    #[test]
    fn final_output_drain_observes_cancellation_between_callbacks() {
        let cancelled = AtomicBool::new(false);
        let seen = AtomicUsize::new(0);
        let events = Mutex::new(Vec::<EngineOutputEvent>::new());
        let result = run_command(
            &mut helper_command("queued-lines"),
            Duration::from_secs(5),
            &cancelled,
            &AtomicU64::new(0),
            Instant::now(),
            &|event| {
                let count = seen.fetch_add(1, Ordering::AcqRel) + 1;
                if count == STREAMED_EVENTS_PER_POLL {
                    thread::sleep(Duration::from_millis(100));
                } else if count == STREAMED_EVENTS_PER_POLL + 1 {
                    cancelled.store(true, Ordering::Release);
                }
                events.lock().expect("event lock").push(event);
            },
        );

        let EngineError::Cancelled { log } = result.expect_err("final drain should be cancelled")
        else {
            unreachable!("expected cancellation")
        };
        assert!(log.lines().filter(|line| *line == "x").count() >= 1_024);
        let events = events.lock().expect("event lock");
        let marker = events.last().expect("cancellation marker");
        assert!(marker.raw.contains("cancelled"), "{:?}", marker.raw);
        assert!(!marker.raw.contains("display limit"), "{:?}", marker.raw);
    }

    #[test]
    fn final_output_drain_observes_timeout_between_callbacks() {
        let seen = AtomicUsize::new(0);
        let started = Instant::now();
        let result = run_command(
            &mut helper_command("queued-lines"),
            Duration::from_millis(400),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
            started,
            &|_| {
                let count = seen.fetch_add(1, Ordering::AcqRel) + 1;
                if count == STREAMED_EVENTS_PER_POLL {
                    thread::sleep(Duration::from_millis(100));
                } else if count > STREAMED_EVENTS_PER_POLL {
                    thread::sleep(Duration::from_millis(1));
                }
            },
        );

        assert!(matches!(result, Err(EngineError::Timeout { .. })));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn cancellation_kills_and_reaps_the_process() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let trigger = Arc::clone(&cancelled);
        let canceller = thread::spawn(move || {
            thread::sleep(Duration::from_millis(60));
            trigger.store(true, Ordering::Release);
        });
        let result = run_command(
            &mut helper_command("sleep"),
            Duration::from_secs(2),
            &cancelled,
            &AtomicU64::new(0),
            Instant::now(),
            &|_| {},
        );
        canceller.join().expect("canceller should finish");

        assert!(matches!(result, Err(EngineError::Cancelled { .. })));
        let next = run_command(
            &mut helper_command("interleave"),
            Duration::from_secs(2),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
            Instant::now(),
            &|_| {},
        )
        .expect("a later process should succeed");
        assert!(next.success);
    }

    #[test]
    fn unwinding_an_output_callback_still_reaps_the_process_tree() {
        let root = tempfile::tempdir().expect("heartbeat directory");
        let heartbeat = root.path().join("heartbeat.txt");
        let mut command = helper_command("spawn-child-and-log");
        command.env(HEARTBEAT_PATH, &heartbeat);

        let outcome = catch_unwind(AssertUnwindSafe(|| {
            let _ = run_command(
                &mut command,
                Duration::from_secs(2),
                &AtomicBool::new(false),
                &AtomicU64::new(0),
                Instant::now(),
                &|_| panic!("simulated callback failure"),
            );
        }));
        assert!(outcome.is_err());

        thread::sleep(Duration::from_millis(100));
        let after_unwind = std::fs::read_to_string(&heartbeat).ok();
        thread::sleep(Duration::from_millis(150));
        let after_wait = std::fs::read_to_string(&heartbeat).ok();
        assert_eq!(
            after_wait, after_unwind,
            "a process survived callback unwind"
        );
    }

    #[test]
    fn timeout_stops_the_descendant_process_tree() {
        let root = tempfile::tempdir().expect("heartbeat directory");
        let heartbeat = root.path().join("heartbeat.txt");
        let mut command = helper_command("spawn-child");
        command.env(HEARTBEAT_PATH, &heartbeat);

        let result = run_command(
            &mut command,
            Duration::from_millis(250),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
            Instant::now(),
            &|_| {},
        );
        assert!(matches!(result, Err(EngineError::Timeout { .. })));
        thread::sleep(Duration::from_millis(100));
        let after_timeout = std::fs::read_to_string(&heartbeat).expect("heartbeat should exist");
        thread::sleep(Duration::from_millis(150));
        let after_wait = std::fs::read_to_string(&heartbeat).expect("heartbeat should remain");
        assert_eq!(
            after_wait, after_timeout,
            "a descendant survived the timeout"
        );

        let next = run_command(
            &mut helper_command("interleave"),
            Duration::from_secs(2),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
            Instant::now(),
            &|_| {},
        )
        .expect("a later process should succeed after timeout cleanup");
        assert!(next.success);
    }
}
