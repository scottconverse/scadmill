export const MCP_TOOL_NAMES = [
  "list_files", "read_file", "write_file", "render_preview", "export_model",
  "get_diagnostics", "get_parameters", "set_parameters", "take_screenshot", "get_history",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
export type McpPermission = "allow-once" | "allow-session" | "deny";
export type McpToolPermissionState = Readonly<Record<McpToolName, McpPermission>>;
export interface McpToolDefinition { readonly name: McpToolName; readonly description: string; readonly inputSchema: Readonly<Record<string, unknown>>; }

const MUTATING_TOOLS: ReadonlySet<McpToolName> = new Set(["write_file", "set_parameters"]);
const PATH_TOOLS: ReadonlySet<McpToolName> = new Set(["read_file", "write_file", "render_preview", "export_model", "get_parameters", "set_parameters"]);

export const DEFAULT_MCP_PERMISSIONS: McpToolPermissionState = Object.freeze(Object.fromEntries(MCP_TOOL_NAMES.map((name) => [name, MUTATING_TOOLS.has(name) ? "deny" : "allow-session"])) as McpToolPermissionState);
export const MCP_TOOL_DEFINITIONS: readonly McpToolDefinition[] = Object.freeze(MCP_TOOL_NAMES.map((name) => ({ name, description: `${name.replaceAll("_", " ")} for the open project.`, inputSchema: { type: "object", additionalProperties: false } })));

export interface McpRequest { readonly name: string; readonly arguments?: unknown; }
export interface McpValidation { readonly ok: boolean; readonly tool?: McpToolName; readonly arguments?: Record<string, unknown>; readonly error?: string; }

function safeRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("\\") && !value.startsWith("/") && !value.split("/").includes("..");
}

export function validateMcpRequest(request: McpRequest): McpValidation {
  if (!MCP_TOOL_NAMES.includes(request.name as McpToolName)) return { ok: false, error: "Unknown MCP tool." };
  const tool = request.name as McpToolName;
  const args = request.arguments === undefined ? {} : request.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, tool, error: "Tool arguments must be an object." };
  const value = args as Record<string, unknown>;
  if (PATH_TOOLS.has(tool) && !safeRelativePath(value.path)) return { ok: false, tool, error: "Tool path must be project-relative." };
  if (tool === "write_file" && typeof value.content !== "string") return { ok: false, tool, error: "write_file requires string content." };
  if (tool === "export_model" && !["stl-binary", "stl-ascii", "3mf", "off", "amf", "svg", "dxf", "png"].includes(String(value.format))) return { ok: false, tool, error: "Unsupported export format." };
  return { ok: true, tool, arguments: value };
}

export function applyMcpPermission(state: McpToolPermissionState, tool: McpToolName, permission: McpPermission): McpToolPermissionState {
  return { ...state, [tool]: permission };
}

export function requiresMcpPermission(tool: McpToolName): boolean {
  return MUTATING_TOOLS.has(tool);
}
