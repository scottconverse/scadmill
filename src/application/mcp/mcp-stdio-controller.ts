import { dispatchMcpRequest, type McpJsonRpcResponse, type McpToolHandler } from "./mcp-dispatcher";
import { decodeMcpStdioLines, encodeMcpStdioResponse, type McpStdioFrame } from "./mcp-stdio";
import { DEFAULT_MCP_PERMISSIONS, type McpToolName, type McpToolPermissionState, requiresMcpPermission, validateMcpRequest } from "./mcp-tools";

export interface McpStdioControllerOptions {
  readonly handler: McpToolHandler;
  readonly permissions?: McpToolPermissionState;
  readonly getPermissions?: () => McpToolPermissionState;
  readonly onMutationPermissionConsumed?: (tool: Extract<McpToolName, "write_file" | "set_parameters">) => void;
  readonly onResponse: (line: string, response: McpJsonRpcResponse) => void;
  readonly onProtocolError?: (message: string) => void;
}

export type McpStdioControllerState = "off" | "running";
type McpLifecycleState = "new" | "initializing" | "initialized";

export interface McpStdioController {
  readonly state: McpStdioControllerState;
  start(): boolean;
  stop(): boolean;
  receive(chunk: string): Promise<void>;
}

export function createMcpStdioController({ handler, permissions = DEFAULT_MCP_PERMISSIONS, getPermissions, onMutationPermissionConsumed, onResponse, onProtocolError }: McpStdioControllerOptions): McpStdioController {
  let state: McpStdioControllerState = "off";
  let lifecycle: McpLifecycleState = "new";
  let carry = "";
  let session = 0;
  let receiveQueue: Promise<void> = Promise.resolve();
  const consumedAllowOnce = new Set<McpToolName>();
  const observedPermissions = new Map<McpToolName, McpToolPermissionState[McpToolName]>();

  const emitResponse = (response: McpJsonRpcResponse) => {
    onResponse(encodeMcpStdioResponse(response), response);
  };
  const lifecycleError = (frame: McpStdioFrame, code: number, message: string) => {
    if (frame.id === undefined) {
      onProtocolError?.(message);
      return;
    }
    emitResponse({ jsonrpc: "2.0", id: frame.id, error: { code, message } });
  };
  const activePermissionState = () => {
    const raw = getPermissions?.() ?? permissions;
    for (const tool of ["write_file", "set_parameters"] as const) {
      const previous = observedPermissions.get(tool);
      if (previous !== raw[tool]) {
        if (raw[tool] === "allow-once") consumedAllowOnce.delete(tool);
        observedPermissions.set(tool, raw[tool]);
      }
    }
    if (consumedAllowOnce.size === 0) return raw;
    return {
      ...raw,
      write_file: consumedAllowOnce.has("write_file") ? "deny" : raw.write_file,
      set_parameters: consumedAllowOnce.has("set_parameters") ? "deny" : raw.set_parameters,
    };
  };
  const sessionIsActive = (expectedSession: number) => state === "running" && session === expectedSession;
  const receiveFrame = async (frame: McpStdioFrame, expectedSession: number) => {
    if (!sessionIsActive(expectedSession)) return;
    if (frame.method === "ping") {
      const response = await dispatchMcpRequest(frame, handler, activePermissionState());
      if (!sessionIsActive(expectedSession)) return;
      if (response) emitResponse(response);
      return;
    }
    if (frame.method === "initialize") {
      if (lifecycle !== "new") {
        lifecycleError(frame, -32600, "MCP initialize may only be called once per connection.");
        return;
      }
      const response = await dispatchMcpRequest(frame, handler, activePermissionState());
      if (!sessionIsActive(expectedSession)) return;
      if (response && "result" in response) lifecycle = "initializing";
      if (response) emitResponse(response);
      return;
    }
    if (frame.method === "notifications/initialized") {
      if (lifecycle !== "initializing") {
        lifecycleError(frame, -32600, lifecycle === "new"
          ? "MCP initialized notification received before initialize."
          : "MCP initialized notification may only be sent once.");
        return;
      }
      lifecycle = "initialized";
      return;
    }
    if (lifecycle !== "initialized") {
      lifecycleError(frame, -32002, lifecycle === "new"
        ? "MCP server is not initialized."
        : "MCP client must send notifications/initialized before using tools.");
      return;
    }
    const activePermissions = activePermissionState();
    const request = frame.method === "tools/call" && frame.params && typeof frame.params === "object" && !Array.isArray(frame.params)
      ? validateMcpRequest({ name: String((frame.params as { name?: unknown }).name ?? ""), arguments: (frame.params as { arguments?: unknown }).arguments })
      : undefined;
    const response = await dispatchMcpRequest(frame, handler, activePermissions);
    if (!sessionIsActive(expectedSession)) return;
    if (
      request?.ok && (request.tool === "write_file" || request.tool === "set_parameters") && requiresMcpPermission(request.tool)
      && activePermissions[request.tool] === "allow-once" && response && "result" in response
    ) {
      consumedAllowOnce.add(request.tool);
      onMutationPermissionConsumed?.(request.tool);
    }
    if (!response) return;
    emitResponse(response);
  };
  return {
    get state() { return state; },
    start() {
      if (state === "running") return false;
      state = "running";
      lifecycle = "new";
      carry = "";
      session += 1;
      receiveQueue = Promise.resolve();
      consumedAllowOnce.clear();
      observedPermissions.clear();
      return true;
    },
    stop() {
      if (state === "off") return false;
      state = "off";
      lifecycle = "new";
      carry = "";
      session += 1;
      receiveQueue = Promise.resolve();
      consumedAllowOnce.clear();
      observedPermissions.clear();
      return true;
    },
    receive(chunk: string) {
      if (state !== "running") return Promise.resolve();
      const expectedSession = session;
      const completion = receiveQueue.then(async () => {
        if (state !== "running" || session !== expectedSession) return;
        const decoded = decodeMcpStdioLines(chunk, carry);
        carry = decoded.carry;
        for (const error of decoded.errors) onProtocolError?.(error);
        for (const frame of decoded.frames) await receiveFrame(frame, expectedSession);
      });
      receiveQueue = completion.catch(() => undefined);
      return completion;
    },
  };
}
