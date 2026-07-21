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
    const initialize = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n';
    const request = '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n';
    await controller.receive(request);
    expect(responses).toEqual([]);
    expect(controller.start()).toBe(true);
    expect(controller.start()).toBe(false);
    await controller.receive(initialize);
    await controller.receive(request.slice(0, 20));
    expect(responses).toHaveLength(1);
    await controller.receive(request.slice(20));
    expect(responses).toHaveLength(2);
    expect(JSON.parse(responses[1]).result.tools).toBeDefined();
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

  it("enforces initialize then initialized before serving tools while allowing ping", async () => {
    const responses: unknown[] = [];
    const errors: string[] = [];
    const controller = createMcpStdioController({
      handler: { call: vi.fn() },
      onResponse: (_line, response) => responses.push(response),
      onProtocolError: (message) => errors.push(message),
    });
    controller.start();

    await controller.receive([
      '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":2,"method":"ping"}',
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}',
      '{"jsonrpc":"2.0","id":3,"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":4,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":5,"method":"tools/list"}',
      "",
    ].join("\n"));

    expect(responses).toHaveLength(6);
    expect(responses[0]).toMatchObject({ id: 1, error: { code: -32002 } });
    expect(responses[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    expect(responses[2]).toMatchObject({ id: 1, result: { capabilities: { tools: { listChanged: false } } } });
    expect(responses[3]).toMatchObject({ id: 3, error: { code: -32002 } });
    expect(responses[4]).toMatchObject({ id: 4, error: { code: -32600 } });
    expect(responses[5]).toMatchObject({ id: 5, result: { tools: expect.any(Array) } });
    expect(errors).toEqual(["MCP initialized notification received before initialize."]);
  });

  it("serializes concurrent receives so allow-once admits exactly one mutation", async () => {
    let permissions = { ...DEFAULT_MCP_PERMISSIONS, write_file: "allow-once" as const };
    const consumed = vi.fn((tool) => { permissions = { ...permissions, [tool]: "deny" }; });
    let releaseFirst: (() => void) | undefined;
    const firstCallGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const handler = vi.fn(async () => {
      if (handler.mock.calls.length === 1) await firstCallGate;
      return { status: "pending_review" };
    });
    const responses: unknown[] = [];
    const controller = createMcpStdioController({
      handler: { call: handler },
      getPermissions: () => permissions,
      onMutationPermissionConsumed: consumed,
      onResponse: (_line, response) => responses.push(response),
    });
    controller.start();
    await controller.receive('{"jsonrpc":"2.0","id":10,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    const write = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"write_file","arguments":{"path":"main.scad","content":"cube(1);"}}}\n';

    const first = controller.receive(write);
    const second = controller.receive(write.replace('"id":1', '"id":2'));
    try {
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      releaseFirst?.();
    }
    await Promise.all([first, second]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(consumed).toHaveBeenCalledWith("write_file");
    expect(permissions.write_file).toBe("deny");
    expect(responses.at(-1)).toMatchObject({ id: 2, error: { code: -32001 } });
  });
});
