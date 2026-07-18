import { MCP_TOOL_DEFINITIONS, type McpToolName, type McpToolPermissionState, requiresMcpPermission, validateMcpRequest } from "./mcp-tools";

export interface McpJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number;
  readonly method: string;
  readonly params?: unknown;
}

export interface McpToolHandler {
  call(name: McpToolName, argumentsValue: Record<string, unknown>): Promise<unknown>;
}

export type McpJsonRpcResponse =
  | { readonly jsonrpc: "2.0"; readonly id: string | number; readonly result: unknown }
  | { readonly jsonrpc: "2.0"; readonly id: string | number; readonly error: { readonly code: number; readonly message: string } };

export const MCP_PROTOCOL_VERSION = "2025-11-25";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function dispatchMcpRequest(
  request: McpJsonRpcRequest,
  handler: McpToolHandler,
  permissions: McpToolPermissionState,
): Promise<McpJsonRpcResponse | undefined> {
  if (request.id === undefined) return undefined;
  if (request.method === "initialize") {
    if (!isRecord(request.params) || typeof request.params.protocolVersion !== "string" || !isRecord(request.params.capabilities) || !isRecord(request.params.clientInfo)) {
      return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "MCP initialize params are invalid." } };
    }
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: request.params.protocolVersion === MCP_PROTOCOL_VERSION ? request.params.protocolVersion : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "scadmill", title: "ScadMill", version: "0.0.0" },
        instructions: "ScadMill exposes project-relative OpenSCAD tools. File and parameter mutations require explicit in-app permission and review.",
      },
    };
  }
  if (request.method === "ping") return { jsonrpc: "2.0", id: request.id, result: {} };
  if (request.method === "tools/list") return { jsonrpc: "2.0", id: request.id, result: { tools: MCP_TOOL_DEFINITIONS } };
  if (request.method !== "tools/call") return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "MCP method not found." } };
  if (!request.params || typeof request.params !== "object" || Array.isArray(request.params)) return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "MCP call params must be an object." } };
  const params = request.params as { name?: unknown; arguments?: unknown };
  const validation = validateMcpRequest({ name: String(params.name ?? ""), arguments: params.arguments });
  if (!validation.ok || !validation.tool || !validation.arguments) return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: validation.error ?? "Invalid MCP tool request." } };
  const permission = permissions[validation.tool];
  if (requiresMcpPermission(validation.tool) && permission === "deny") {
    return { jsonrpc: "2.0", id: request.id, error: { code: -32001, message: "MCP mutation denied by the current permission gate." } };
  }
  try {
    const result = await handler.call(validation.tool, validation.arguments);
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result) ?? "null" }],
        ...(isRecord(result) ? { structuredContent: result } : {}),
        isError: false,
      },
    };
  } catch {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: "MCP tool execution failed." }],
        isError: true,
      },
    };
  }
}
