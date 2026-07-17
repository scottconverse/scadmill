use std::io::{self, BufRead, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, State};

pub const MCP_REQUEST_EVENT: &str = "scadmill://mcp-request";
const MAX_FRAME_BYTES: usize = 1_048_576;

#[derive(Default)]
struct McpStdioInner {
    enabled: AtomicBool,
    reader_started: AtomicBool,
}

#[derive(Clone, Default)]
pub struct McpStdioBridge(Arc<McpStdioInner>);

impl McpStdioBridge {
    fn enabled(&self) -> bool {
        self.0.enabled.load(Ordering::Acquire)
    }

    fn set_enabled(&self, app: AppHandle, enabled: bool) {
        self.0.enabled.store(enabled, Ordering::Release);
        if !enabled || self.0.reader_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let bridge = self.clone();
        std::thread::spawn(move || {
            let stdin = io::stdin();
            for line in stdin.lock().lines() {
                let Ok(line) = line else { continue };
                if bridge.enabled() && line.len() <= MAX_FRAME_BYTES {
                    let _ = app.emit(MCP_REQUEST_EVENT, format!("{line}\n"));
                }
            }
            bridge.0.reader_started.store(false, Ordering::Release);
        });
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn mcp_set_enabled(app: AppHandle, bridge: State<'_, McpStdioBridge>, enabled: bool) {
    bridge.set_enabled(app, enabled);
}

#[tauri::command(rename_all = "camelCase")]
pub fn mcp_write_response(bridge: State<'_, McpStdioBridge>, line: String) -> Result<(), String> {
    if !bridge.enabled() {
        return Err("The MCP stdio server is disabled.".to_string());
    }
    if !line.ends_with('\n')
        || line[..line.len() - 1].contains('\n')
        || line.len() > MAX_FRAME_BYTES
    {
        return Err(
            "MCP response must be one newline-terminated frame no larger than 1 MiB.".to_string(),
        );
    }
    let mut output = io::stdout().lock();
    output
        .write_all(line.as_bytes())
        .and_then(|_| output.flush())
        .map_err(|error| format!("Could not write MCP response: {error}"))
}

#[cfg(test)]
mod tests {
    use super::McpStdioBridge;

    #[test]
    fn starts_disabled() {
        assert!(!McpStdioBridge::default().enabled());
    }
}
