import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { McpServerPort } from "../application/platform/scadmill-platform";
import type { TauriInvoke } from "./tauri-settings-persistence";

export const TAURI_MCP_REQUEST_EVENT = "scadmill://mcp-request";

type TauriListen = typeof listen;

export function createTauriMcpPort(
  invoke: TauriInvoke = tauriInvoke,
  listenForEvent: TauriListen = listen,
): McpServerPort {
  return {
    async setEnabled(enabled) {
      await invoke<void>("mcp_set_enabled", { enabled });
    },
    async subscribeRequests(listener) {
      return listenForEvent<string>(TAURI_MCP_REQUEST_EVENT, (event) => {
        if (typeof event.payload === "string") listener(event.payload);
      });
    },
    async writeResponse(line) {
      await invoke<void>("mcp_write_response", { line });
    },
  };
}
