import { describe, expect, it } from "vitest";

import { applyMcpPermission, DEFAULT_MCP_PERMISSIONS, requiresMcpPermission, validateMcpRequest } from "../../../src/application/mcp/mcp-tools";

describe("MCP tool contracts", () => {
  it("accepts read requests and rejects traversal or unknown tools", () => {
    expect(validateMcpRequest({ name: "read_file", arguments: { path: "main.scad" } })).toMatchObject({ ok: true, tool: "read_file" });
    expect(validateMcpRequest({ name: "read_file", arguments: { path: "../secret" } }).ok).toBe(false);
    expect(validateMcpRequest({ name: "unknown" }).ok).toBe(false);
  });

  it("validates mutating payloads and export formats", () => {
    expect(validateMcpRequest({ name: "write_file", arguments: { path: "main.scad", content: "cube(1);" } }).ok).toBe(true);
    expect(validateMcpRequest({ name: "write_file", arguments: { path: "main.scad" } }).ok).toBe(false);
    expect(validateMcpRequest({ name: "export_model", arguments: { path: "out/model.stl", format: "stl-binary" } }).ok).toBe(true);
    expect(validateMcpRequest({ name: "export_model", arguments: { path: "out/model.xyz", format: "xyz" } }).ok).toBe(false);
  });

  it("denies mutating tools by default and supports explicit session permission", () => {
    expect(requiresMcpPermission("write_file")).toBe(true);
    expect(DEFAULT_MCP_PERMISSIONS.write_file).toBe("deny");
    const next = applyMcpPermission(DEFAULT_MCP_PERMISSIONS, "write_file", "allow-session");
    expect(next.write_file).toBe("allow-session");
    expect(DEFAULT_MCP_PERMISSIONS.read_file).toBe("allow-session");
  });
});
