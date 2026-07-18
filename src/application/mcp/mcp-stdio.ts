const MAX_FRAME_BYTES = 1_048_576;

export interface McpStdioFrame { readonly jsonrpc: "2.0"; readonly id?: string | number; readonly method: string; readonly params?: unknown; }

export function decodeMcpStdioLines(chunk: string, carry = ""): { readonly frames: readonly McpStdioFrame[]; readonly carry: string; readonly errors: readonly string[] } {
  const source = carry + chunk;
  const lines = source.split(/\r?\n/gu);
  const nextCarry = lines.pop() ?? "";
  const frames: McpStdioFrame[] = [];
  const errors: string[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    if (new TextEncoder().encode(line).byteLength > MAX_FRAME_BYTES) {
      errors.push("MCP frame exceeds the 1 MiB limit.");
      continue;
    }
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== "object" || (value as { jsonrpc?: unknown }).jsonrpc !== "2.0" || typeof (value as { method?: unknown }).method !== "string") {
        errors.push("MCP frame is not a JSON-RPC request or notification.");
        continue;
      }
      frames.push(value as McpStdioFrame);
    } catch {
      errors.push("MCP frame is not valid JSON.");
    }
  }
  return { frames, carry: nextCarry, errors };
}

export function encodeMcpStdioResponse(response: unknown): string {
  return `${JSON.stringify(response)}\n`;
}
