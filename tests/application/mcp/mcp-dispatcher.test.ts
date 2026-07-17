import { describe, expect, it, vi } from "vitest";

import { dispatchMcpRequest } from "../../../src/application/mcp/mcp-dispatcher";
import { applyMcpPermission, DEFAULT_MCP_PERMISSIONS } from "../../../src/application/mcp/mcp-tools";

describe("MCP JSON-RPC dispatcher", () => {
  it("lists tools and returns protocol errors for unknown methods", async () => {
    const handler = { call: vi.fn() };
    await expect(dispatchMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, handler, DEFAULT_MCP_PERMISSIONS)).resolves.toMatchObject({ result: { tools: expect.arrayContaining([expect.objectContaining({ name: "list_files" })]) } });
    await expect(dispatchMcpRequest({ jsonrpc: "2.0", id: 2, method: "nope" }, handler, DEFAULT_MCP_PERMISSIONS)).resolves.toMatchObject({ error: { code: -32601 } });
  });

  it("returns a structured denial for blocked mutations and dispatches allowed reads", async () => {
    const handler = { call: vi.fn().mockResolvedValue({ files: [] }) };
    const denied = await dispatchMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "write_file", arguments: { path: "main.scad", content: "cube(1);" } } }, handler, DEFAULT_MCP_PERMISSIONS);
    expect(denied).toMatchObject({ error: { code: -32001, message: expect.stringMatching(/denied/i) } });
    const allowed = await dispatchMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_files", arguments: {} } }, handler, applyMcpPermission(DEFAULT_MCP_PERMISSIONS, "write_file", "allow-session"));
    expect(allowed).toMatchObject({ result: { files: [] } });
    expect(handler.call).toHaveBeenCalledOnce();
  });
});
