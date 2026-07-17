import { describe, expect, it, vi } from "vitest";

import { createTauriMcpPort, TAURI_MCP_REQUEST_EVENT } from "../../src/platform-desktop/tauri-mcp-port";

describe("Tauri MCP port", () => {
  it("maps the desktop commands and forwards only string request events", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    let eventListener: ((event: { payload: unknown }) => void) | undefined;
    const unsubscribe = vi.fn();
    const listen = vi.fn().mockImplementation(async (_event, listener) => {
      eventListener = listener;
      return unsubscribe;
    });
    const port = createTauriMcpPort(invoke, listen);
    const received = vi.fn();
    await port.setEnabled(true);
    await port.writeResponse('{"jsonrpc":"2.0"}\n');
    const release = await port.subscribeRequests(received);
    eventListener?.({ payload: "request\n" });
    eventListener?.({ payload: { unsafe: true } });
    expect(received).toHaveBeenCalledOnce();
    expect(received).toHaveBeenCalledWith("request\n");
    expect(invoke).toHaveBeenNthCalledWith(1, "mcp_set_enabled", { enabled: true });
    expect(invoke).toHaveBeenNthCalledWith(2, "mcp_write_response", { line: '{"jsonrpc":"2.0"}\n' });
    expect(listen).toHaveBeenCalledWith(TAURI_MCP_REQUEST_EVENT, expect.any(Function));
    release();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
