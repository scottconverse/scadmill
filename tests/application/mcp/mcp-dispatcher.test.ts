import { describe, expect, it, vi } from "vitest";

import { dispatchMcpRequest, MCP_PROTOCOL_VERSION } from "../../../src/application/mcp/mcp-dispatcher";
import { applyMcpPermission, DEFAULT_MCP_PERMISSIONS } from "../../../src/application/mcp/mcp-tools";

describe("MCP JSON-RPC dispatcher", () => {
  it("negotiates the current MCP lifecycle and responds to ping", async () => {
    const handler = { call: vi.fn() };
    const initialized = await dispatchMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    }, handler, DEFAULT_MCP_PERMISSIONS);

    expect(initialized).toMatchObject({
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "scadmill", title: "ScadMill" },
      },
    });
    await expect(dispatchMcpRequest({ jsonrpc: "2.0", id: 2, method: "ping" }, handler, DEFAULT_MCP_PERMISSIONS)).resolves.toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    await expect(dispatchMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, handler, DEFAULT_MCP_PERMISSIONS)).resolves.toBeUndefined();
    expect(handler.call).not.toHaveBeenCalled();
  });

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
    expect(allowed).toMatchObject({
      result: {
        content: [{ type: "text", text: '{"files":[]}' }],
        structuredContent: { files: [] },
        isError: false,
      },
    });
    expect(handler.call).toHaveBeenCalledOnce();
  });

  it("reports handler failures as MCP tool results without changing protocol errors", async () => {
    const handler = { call: vi.fn().mockRejectedValue(new Error("sensitive filesystem detail")) };

    await expect(dispatchMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_files", arguments: {} },
    }, handler, DEFAULT_MCP_PERMISSIONS)).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "MCP tool execution failed." }],
        isError: true,
      },
    });

    await expect(dispatchMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_files", arguments: { unexpected: true } },
    }, handler, DEFAULT_MCP_PERMISSIONS)).resolves.toMatchObject({ error: { code: -32602 } });
  });
});
