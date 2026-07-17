import { type McpToolName, type McpToolPermissionState, requiresMcpPermission, validateMcpRequest } from "./mcp-tools";

export interface McpJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
}

export interface McpToolHandler {
  call(name: McpToolName, argumentsValue: Record<string, unknown>): Promise<unknown>;
}

export type McpJsonRpcResponse =
  | { readonly jsonrpc: "2.0"; readonly id: string | number; readonly result: unknown }
  | { readonly jsonrpc: "2.0"; readonly id: string | number; readonly error: { readonly code: number; readonly message: string } };

export async function dispatchMcpRequest(
  request: McpJsonRpcRequest,
  handler: McpToolHandler,
  permissions: McpToolPermissionState,
): Promise<McpJsonRpcResponse> {
  if (request.method === "tools/list") return { jsonrpc: "2.0", id: request.id, result: { tools: [] } };
  if (request.method !== "tools/call") return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "MCP method not found." } };
  if (!request.params || typeof request.params !== "object" || Array.isArray(request.params)) return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "MCP call params must be an object." } };
  const params = request.params as { name?: unknown; arguments?: unknown };
  const validation = validateMcpRequest({ name: String(params.name ?? ""), arguments: params.arguments });
  if (!validation.ok || !validation.tool || !validation.arguments) return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: validation.error ?? "Invalid MCP tool request." } };
  const permission = permissions[validation.tool];
  if (requiresMcpPermission(validation.tool) && permission === "deny") {
    return { jsonrpc: "2.0", id: request.id, result: { status: "pending_review" } };
  }
  try {
    return { jsonrpc: "2.0", id: request.id, result: await handler.call(validation.tool, validation.arguments) };
  } catch {
    return { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "MCP tool execution failed." } };
  }
}
