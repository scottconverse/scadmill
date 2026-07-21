import { describe, expect, it, vi } from "vitest";

import { createTauriMcpPort, TAURI_MCP_CONNECTION_EVENT, TAURI_MCP_REQUEST_EVENT } from "../../src/platform-desktop/tauri-mcp-port";

describe("Tauri MCP port", () => {
  it("maps the desktop commands and forwards only string request events", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const eventListeners = new Map<string, (event: { payload: unknown }) => void>();
    const unsubscribe = vi.fn();
    const listen = vi.fn().mockImplementation(async (_event, listener) => {
      eventListeners.set(_event, listener);
      return unsubscribe;
    });
    const port = createTauriMcpPort(invoke, listen);
    const received = vi.fn();
    await port.setEnabled(true);
    await port.writeResponse('{"jsonrpc":"2.0"}\n');
    const release = await port.subscribeRequests(received);
    const connections = vi.fn();
    const releaseConnections = await port.subscribeConnection?.(connections);
    eventListeners.get(TAURI_MCP_REQUEST_EVENT)?.({ payload: "request\n" });
    eventListeners.get(TAURI_MCP_REQUEST_EVENT)?.({ payload: { unsafe: true } });
    eventListeners.get(TAURI_MCP_CONNECTION_EVENT)?.({ payload: true });
    eventListeners.get(TAURI_MCP_CONNECTION_EVENT)?.({ payload: "unsafe" });
    expect(received).toHaveBeenCalledOnce();
    expect(received).toHaveBeenCalledWith("request\n");
    expect(invoke).toHaveBeenNthCalledWith(1, "mcp_set_enabled", { enabled: true });
    expect(invoke).toHaveBeenNthCalledWith(2, "mcp_write_response", { line: '{"jsonrpc":"2.0"}\n' });
    expect(listen).toHaveBeenNthCalledWith(1, TAURI_MCP_REQUEST_EVENT, expect.any(Function));
    expect(listen).toHaveBeenNthCalledWith(2, TAURI_MCP_CONNECTION_EVENT, expect.any(Function));
    expect(connections).toHaveBeenCalledOnce();
    expect(connections).toHaveBeenCalledWith(true);
    release();
    releaseConnections?.();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
