import { describe, expect, it } from "vitest";

import { decodeMcpStdioLines, encodeMcpStdioResponse } from "../../../src/application/mcp/mcp-stdio";

describe("MCP stdio framing", () => {
  it("carries partial lines and decodes multiple JSON-RPC frames", () => {
    const first = decodeMcpStdioLines('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n{"jsonrpc":"2.0"');
    expect(first.frames).toHaveLength(1);
    const second = decodeMcpStdioLines(',"id":2,"method":"tools/list"}\n', first.carry);
    expect(second.frames[0]).toMatchObject({ id: 2, method: "tools/list" });
    expect(encodeMcpStdioResponse({ jsonrpc: "2.0", id: 1, result: {} })).toBe('{"jsonrpc":"2.0","id":1,"result":{}}\n');
  });

  it("decodes JSON-RPC notifications without inventing a request id", () => {
    const result = decodeMcpStdioLines('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');

    expect(result.errors).toEqual([]);
    expect(result.frames).toEqual([{ jsonrpc: "2.0", method: "notifications/initialized" }]);
  });

  it("reports malformed and oversized lines without throwing", () => {
    const result = decodeMcpStdioLines(`bad\n${"x".repeat(1_048_577)}\n`);
    expect(result.frames).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });
});
