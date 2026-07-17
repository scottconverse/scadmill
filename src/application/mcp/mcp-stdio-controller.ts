import { dispatchMcpRequest, type McpJsonRpcResponse, type McpToolHandler } from "./mcp-dispatcher";
import { decodeMcpStdioLines, encodeMcpStdioResponse, type McpStdioFrame } from "./mcp-stdio";
import { DEFAULT_MCP_PERMISSIONS, requiresMcpPermission, validateMcpRequest, type McpToolName, type McpToolPermissionState } from "./mcp-tools";

export interface McpStdioControllerOptions {
  readonly handler: McpToolHandler;
  readonly permissions?: McpToolPermissionState;
  readonly getPermissions?: () => McpToolPermissionState;
  readonly onMutationPermissionConsumed?: (tool: Extract<McpToolName, "write_file" | "set_parameters">) => void;
  readonly onResponse: (line: string, response: McpJsonRpcResponse) => void;
  readonly onProtocolError?: (message: string) => void;
}

export type McpStdioControllerState = "off" | "running";

export interface McpStdioController {
  readonly state: McpStdioControllerState;
  start(): boolean;
  stop(): boolean;
  receive(chunk: string): Promise<void>;
}

export function createMcpStdioController({ handler, permissions = DEFAULT_MCP_PERMISSIONS, getPermissions, onMutationPermissionConsumed, onResponse, onProtocolError }: McpStdioControllerOptions): McpStdioController {
  let state: McpStdioControllerState = "off";
  let carry = "";
  const receiveFrame = async (frame: McpStdioFrame) => {
    if (state !== "running") return;
    const activePermissions = getPermissions?.() ?? permissions;
    const request = frame.method === "tools/call" && frame.params && typeof frame.params === "object" && !Array.isArray(frame.params)
      ? validateMcpRequest({ name: String((frame.params as { name?: unknown }).name ?? ""), arguments: (frame.params as { arguments?: unknown }).arguments })
      : undefined;
    const response = await dispatchMcpRequest(frame, handler, activePermissions);
    if (
      request?.ok && (request.tool === "write_file" || request.tool === "set_parameters") && requiresMcpPermission(request.tool)
      && activePermissions[request.tool] === "allow-once" && "result" in response
    ) onMutationPermissionConsumed?.(request.tool);
    onResponse(encodeMcpStdioResponse(response), response);
  };
  return {
    get state() { return state; },
    start() {
      if (state === "running") return false;
      state = "running";
      carry = "";
      return true;
    },
    stop() {
      if (state === "off") return false;
      state = "off";
      carry = "";
      return true;
    },
    async receive(chunk: string) {
      if (state !== "running") return;
      const decoded = decodeMcpStdioLines(chunk, carry);
      carry = decoded.carry;
      for (const error of decoded.errors) onProtocolError?.(error);
      await Promise.all(decoded.frames.map(receiveFrame));
    },
  };
}
