import { describe, expect, it, vi } from "vitest";
import { createMcpStdioController } from "../../../src/application/mcp/mcp-stdio-controller";
import { DEFAULT_MCP_PERMISSIONS } from "../../../src/application/mcp/mcp-tools";

describe("MCP stdio controller", () => {
  it("does not receive while off and routes framed requests while running", async () => {
    const responses: string[] = [];
    const controller = createMcpStdioController({
      handler: { call: vi.fn().mockResolvedValue({ files: [] }) },
      permissions: DEFAULT_MCP_PERMISSIONS,
      onResponse: (line) => responses.push(line),
    });
    const request = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n';
    await controller.receive(request);
    expect(responses).toEqual([]);
    expect(controller.start()).toBe(true);
    expect(controller.start()).toBe(false);
    await controller.receive(request.slice(0, 20));
    expect(responses).toEqual([]);
    await controller.receive(request.slice(20));
    expect(responses).toHaveLength(1);
    expect(JSON.parse(responses[0]).result.tools).toBeDefined();
  });

  it("clears partial frames and reports protocol errors when stopped", async () => {
    const errors: string[] = [];
    const controller = createMcpStdioController({ handler: { call: vi.fn() }, onResponse: () => undefined, onProtocolError: (message) => errors.push(message) });
    controller.start();
    await controller.receive("{\"jsonrpc\":\"2.0\"");
    expect(controller.stop()).toBe(true);
    expect(controller.stop()).toBe(false);
    controller.start();
    await controller.receive("bad\n");
    expect(errors).toEqual(["MCP frame is not valid JSON."]);
  });
});
