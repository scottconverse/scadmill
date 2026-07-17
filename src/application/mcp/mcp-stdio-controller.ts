import { dispatchMcpRequest, type McpJsonRpcResponse, type McpToolHandler } from "./mcp-dispatcher";
import { decodeMcpStdioLines, encodeMcpStdioResponse, type McpStdioFrame } from "./mcp-stdio";
import { DEFAULT_MCP_PERMISSIONS, type McpToolPermissionState } from "./mcp-tools";

export interface McpStdioControllerOptions {
  readonly handler: McpToolHandler;
  readonly permissions?: McpToolPermissionState;
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

export function createMcpStdioController({ handler, permissions = DEFAULT_MCP_PERMISSIONS, onResponse, onProtocolError }: McpStdioControllerOptions): McpStdioController {
  let state: McpStdioControllerState = "off";
  let carry = "";
  const receiveFrame = async (frame: McpStdioFrame) => {
    if (state !== "running") return;
    const response = await dispatchMcpRequest(frame, handler, permissions);
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
