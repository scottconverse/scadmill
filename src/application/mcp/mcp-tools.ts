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
const TOOL_DEFINITION_DATA: Readonly<Record<McpToolName, Omit<McpToolDefinition, "name">>> = {
  list_files: { description: "List all files in the open project.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  read_file: { description: "Read a project file's current buffer content (unsaved edits included).", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } }, additionalProperties: false } },
  write_file: { description: "Propose full new content for a file. Subject to in-app diff review.", inputSchema: { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" }, createIfMissing: { type: "boolean", default: false } }, additionalProperties: false } },
  render_preview: { description: "Render a file at preview quality; returns stats and diagnostics, not mesh bytes.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, parameters: { type: "object", additionalProperties: true } }, additionalProperties: false } },
  export_model: { description: "Full-quality export to a file inside the project's export directory.", inputSchema: { type: "object", required: ["path", "format"], properties: { path: { type: "string" }, format: { enum: ["stl-binary", "stl-ascii", "3mf", "off", "amf", "svg", "dxf", "png"] }, parameters: { type: "object" }, parameterSet: { type: "string" } }, additionalProperties: false } },
  get_diagnostics: { description: "Structured diagnostics of the most recent render of a file (or the active file).", inputSchema: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false } },
  get_parameters: { description: "Extracted customizer schema and current values for a file.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } }, additionalProperties: false } },
  set_parameters: { description: "Set customizer values (render-override, does not edit source). Triggers a preview render.", inputSchema: { type: "object", required: ["path", "values"], properties: { path: { type: "string" }, values: { type: "object", additionalProperties: true } }, additionalProperties: false } },
  take_screenshot: { description: "Capture the current model viewport as PNG.", inputSchema: { type: "object", properties: { width: { type: "number", default: 1024 }, height: { type: "number", default: 768 } }, additionalProperties: false } },
  get_history: { description: "The session command history (most recent first).", inputSchema: { type: "object", properties: { limit: { type: "number", default: 50 } }, additionalProperties: false } },
};

export const DEFAULT_MCP_PERMISSIONS: McpToolPermissionState = Object.freeze(Object.fromEntries(MCP_TOOL_NAMES.map((name) => [name, MUTATING_TOOLS.has(name) ? "deny" : "allow-session"])) as McpToolPermissionState);
export const MCP_TOOL_DEFINITIONS: readonly McpToolDefinition[] = Object.freeze(MCP_TOOL_NAMES.map((name) => Object.freeze({ name, ...TOOL_DEFINITION_DATA[name] })));

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
  const schema = TOOL_DEFINITION_DATA[tool].inputSchema;
  const required = Array.isArray(schema.required) ? schema.required as string[] : [];
  for (const field of required) if (!(field in value)) return { ok: false, tool, error: `${tool} requires ${field}.` };
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, unknown> : {};
  if (schema.additionalProperties === false) {
    const unknown = Object.keys(value).find((key) => !(key in properties));
    if (unknown) return { ok: false, tool, error: `Unknown ${tool} argument: ${unknown}.` };
  }
  if (PATH_TOOLS.has(tool) && !safeRelativePath(value.path)) return { ok: false, tool, error: "Tool path must be project-relative." };
  if (tool === "write_file" && typeof value.content !== "string") return { ok: false, tool, error: "write_file requires string content." };
  if (tool === "write_file" && value.createIfMissing !== undefined && typeof value.createIfMissing !== "boolean") return { ok: false, tool, error: "createIfMissing must be boolean." };
  if (tool === "set_parameters" && (!value.values || typeof value.values !== "object" || Array.isArray(value.values))) return { ok: false, tool, error: "set_parameters requires object values." };
  if (tool === "export_model" && !["stl-binary", "stl-ascii", "3mf", "off", "amf", "svg", "dxf", "png"].includes(String(value.format))) return { ok: false, tool, error: "Unsupported export format." };
  for (const field of ["width", "height", "limit"]) if (value[field] !== undefined && (typeof value[field] !== "number" || !Number.isFinite(value[field]))) return { ok: false, tool, error: `${field} must be a finite number.` };
  return { ok: true, tool, arguments: value };
}

export function applyMcpPermission(state: McpToolPermissionState, tool: McpToolName, permission: McpPermission): McpToolPermissionState {
  return { ...state, [tool]: permission };
}

export function requiresMcpPermission(tool: McpToolName): boolean {
  return MUTATING_TOOLS.has(tool);
}
