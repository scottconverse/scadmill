import type { McpToolHandler } from "./mcp-dispatcher";
import type { McpToolName } from "./mcp-tools";
import type {
  Diagnostic,
  EngineService,
  ExportFormat,
  ParamValue,
  RenderResult,
} from "../engine/contracts";
import type { WorkbenchRuntime } from "../runtime/workbench-runtime-contracts";
import { buildRuntimeRenderFileMap } from "../runtime/project-render-files";
import { parseProjectPath } from "../files/project-path";
import type { ProjectFileContent } from "../files/project-snapshot";
import { parameterDocument } from "../parameters/parameter-state";
import type { ParameterValue } from "../parameters/customizer-schema";
import { extractCustomizerParameters } from "../parameters/customizer-parser";
import type { McpPendingReview } from "./mcp-review-queue";

export interface WorkbenchMcpHandlerOptions {
  readonly runtime: WorkbenchRuntime;
  readonly engine?: EngineService;
  readonly reviewId?: () => string;
  readonly onPendingReview?: (review: McpPendingReview) => void;
}

interface TargetDocument {
  readonly path: string;
  readonly source: string;
  readonly dirty: boolean;
  readonly documentId: string;
}

interface PreviewRecord {
  readonly renderId: string;
  readonly quality: "preview";
  readonly diagnostics: readonly Diagnostic[];
}

function isTextPath(path: string): boolean {
  return /\.(?:scad|txt|md|json|ya?ml|toml|csv|svg|dxf|js|ts|css|html)$/iu.test(path);
}

function fileKind(path: string, content: ProjectFileContent): "scad" | "text" | "binary" {
  if (/\.scad$/iu.test(path)) return "scad";
  if (typeof content === "string" || isTextPath(path)) return "text";
  return "binary";
}

function fileSize(content: ProjectFileContent): number {
  return typeof content === "string"
    ? new TextEncoder().encode(content).byteLength
    : content.byteLength;
}

function finiteLimit(value: unknown, fallback: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}

function parameterValue(value: unknown): ParameterValue | undefined {
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return typeof value === "number" && !Number.isFinite(value) ? undefined : value;
  }
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    return undefined;
  }
  return value;
}

function effectiveParameterValues(document: ReturnType<typeof parameterDocument>): Readonly<Record<string, ParamValue>> {
  const values: Record<string, ParamValue> = {};
  for (const parameter of document.parameters) {
    values[parameter.name] = (document.overrides[parameter.name] ?? parameter.defaultValue) as ParamValue;
  }
  return values;
}

function controlDescription(control: ReturnType<typeof parameterDocument>["parameters"][number]["control"]): Record<string, unknown> {
  switch (control.kind) {
    case "slider": return { control: "slider", min: control.minimum, max: control.maximum, ...(control.step === undefined ? {} : { step: control.step }) };
    case "dropdown": return { control: "dropdown", options: control.options };
    case "checkbox": return { control: "checkbox" };
    case "number": return { control: "number", step: control.step };
    case "vector": return { control: "vector" };
    case "text": return { control: "text" };
  }
}

function mimeType(format: ExportFormat): string {
  switch (format) {
    case "stl-binary": return "model/stl";
    case "stl-ascii": return "model/stl";
    case "3mf": return "model/3mf";
    case "off": return "model/off";
    case "amf": return "application/amf+xml";
    case "svg": return "image/svg+xml";
    case "dxf": return "image/vnd.dxf";
    case "png": return "image/png";
  }
}

function extension(format: ExportFormat): string {
  return format === "stl-binary" || format === "stl-ascii" ? "stl" : format;
}

export function createWorkbenchMcpHandler({ runtime, engine, reviewId = () => globalThis.crypto.randomUUID(), onPendingReview }: WorkbenchMcpHandlerOptions): McpToolHandler {
  let lastPreview = new Map<string, PreviewRecord>();

  const documents = () => runtime.documents.getState().documents;
  const target = (pathValue: unknown, required = true): TargetDocument | undefined => {
    const requested = pathValue === undefined
      ? documents().find(({ id }) => id === runtime.documents.getState().activeDocumentId)
      : documents().find(({ path }) => path.toLowerCase() === String(pathValue).toLowerCase());
    if (requested) return { path: requested.path, source: requested.source, dirty: requested.source !== requested.savedSource, documentId: requested.id };
    if (pathValue !== undefined) {
      const path = parseProjectPath(String(pathValue));
      const content = runtime.project.getState().snapshot.files.get(path);
      if (typeof content === "string") return { path, source: content, dirty: false, documentId: "" };
    }
    if (required) throw new Error(`Project file ${String(pathValue ?? "active")} is not open.`);
    return undefined;
  };

  const fileMap = () => buildRuntimeRenderFileMap(runtime.project.getState(), runtime.documents.getState());
  const paramsFor = (documentId: string, overrides?: unknown): Readonly<Record<string, ParamValue>> => {
    const document = documentId ? parameterDocument(runtime.parameters.getState(), documentId) : undefined;
    const values: Record<string, ParamValue> = { ...(document ? effectiveParameterValues(document) : {}) };
    if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
      for (const [name, raw] of Object.entries(overrides)) {
        const value = parameterValue(raw);
        if (value !== undefined && (!document || document.parameters.some((parameter) => parameter.name === name))) values[name] = value as ParamValue;
      }
    }
    return values;
  };

  return {
    async call(name: McpToolName, args: Record<string, unknown>): Promise<unknown> {
      switch (name) {
        case "list_files": {
          const files = [...fileMap()].map(([path, content]) => ({ path, sizeBytes: fileSize(content), kind: fileKind(path, content) }));
          return { files: files.sort((left, right) => left.path.localeCompare(right.path)) };
        }
        case "read_file": {
          const found = target(args.path);
          if (!found) throw new Error(`Project file ${String(args.path)} is not a text file.`);
          return { path: found.path, content: found.source, dirty: found.dirty };
        }
        case "write_file": {
          const path = parseProjectPath(String(args.path));
          const existing = target(path, false);
          if (!existing && !args.createIfMissing) throw new Error(`Project file ${path} does not exist.`);
          const commandId = `mcp-review-${reviewId()}`;
          onPendingReview?.({ commandId, tool: "write_file", arguments: { ...args, path }, createdAt: new Date().toISOString() });
          return { status: "pending_review", commandId };
        }
        case "render_preview": {
          if (!engine) throw new Error("The MCP preview engine is unavailable on this platform.");
          const found = target(args.path);
          if (!found) throw new Error(`Project file ${String(args.path)} does not exist.`);
          const settings = runtime.settings.getState();
          const job = engine.render({
            entryFile: found.path,
            files: fileMap(),
            parameters: paramsFor(found.documentId, args.parameters),
            quality: "preview",
            timeoutMs: settings.previewTimeoutMs,
            previewFacetLimit: settings.previewFacetLimit,
          });
          const result: RenderResult = await job.done;
          const diagnostics = result.diagnostics;
          lastPreview = new Map(lastPreview).set(found.path.toLowerCase(), { renderId: job.jobId, quality: "preview", diagnostics });
          return { kind: result.kind, stats: result.kind === "3d" ? result.stats : null, diagnostics };
        }
        case "export_model": {
          if (!engine) throw new Error("The MCP export engine is unavailable on this platform.");
          const found = target(args.path);
          if (!found) throw new Error(`Project file ${String(args.path)} does not exist.`);
          const format = String(args.format) as ExportFormat;
          const parameterDocumentState = found.documentId ? parameterDocument(runtime.parameters.getState(), found.documentId) : undefined;
          const selectedSet = typeof args.parameterSet === "string" ? parameterDocumentState?.sets.find(({ name }) => name === args.parameterSet) : undefined;
          const values = selectedSet
            ? Object.fromEntries(Object.entries(selectedSet.values).map(([name, value]) => [name, Array.isArray(value) ? [...value] : value])) as Readonly<Record<string, ParamValue>>
            : paramsFor(found.documentId, args.parameters);
          const result = await engine.export({ entryFile: found.path, files: fileMap(), parameters: values, format, timeoutMs: runtime.settings.getState().fullTimeoutMs }).done;
          if (!result.ok || !result.bytes) return { status: "failed", diagnostics: result.diagnostics };
          const saved = await runtime.artifacts.save({ suggestedName: `${found.path.split("/").at(-1)?.replace(/\.[^.]*$/u, "") ?? "model"}.${extension(format)}`, bytes: result.bytes, mimeType: mimeType(format) });
          return { status: "ok", outputPath: saved.location, sizeBytes: result.bytes.byteLength, diagnostics: result.diagnostics };
        }
        case "get_diagnostics": {
          const found = target(args.path, false);
          const render = runtime.render.getState();
          const preview = found ? lastPreview.get(found.path.toLowerCase()) : undefined;
          const current = found && render.entryFile?.toLowerCase() === found.path.toLowerCase() ? render : undefined;
          return { ...(current?.jobId || preview?.renderId ? { renderId: current?.jobId ?? preview?.renderId } : {}), quality: current?.quality ?? preview?.quality ?? null, diagnostics: current?.result?.diagnostics ?? preview?.diagnostics ?? [] };
        }
        case "get_parameters": {
          const found = target(args.path);
          if (!found) return { parameters: [], activeSet: undefined };
          const state = found.documentId ? parameterDocument(runtime.parameters.getState(), found.documentId) : undefined;
          const extracted = state?.parameters ?? extractCustomizerParameters(found.source);
          const overrides: Readonly<Record<string, ParameterValue>> = state?.overrides ?? {};
          return { parameters: extracted.filter(({ hidden }) => !hidden).map((parameter) => ({ name: parameter.name, type: Array.isArray(parameter.defaultValue) ? "vector" : typeof parameter.defaultValue, default: parameter.defaultValue, current: overrides[parameter.name] ?? parameter.defaultValue, section: parameter.group ?? undefined, description: parameter.description, ...controlDescription(parameter.control) })), activeSet: state?.selectedSet };
        }
        case "set_parameters": {
          const found = target(args.path);
          if (!found) throw new Error(`Project file ${String(args.path)} does not exist.`);
          const state = found.documentId ? parameterDocument(runtime.parameters.getState(), found.documentId) : { parameters: extractCustomizerParameters(found.source) };
          const known = new Set(state.parameters.filter(({ hidden }) => !hidden).map(({ name }) => name));
          const unknownNames = Object.keys(args.values as Record<string, unknown>).filter((name) => !known.has(name));
          const commandId = `mcp-review-${reviewId()}`;
          onPendingReview?.({ commandId, tool: "set_parameters", arguments: { ...args }, createdAt: new Date().toISOString() });
          return { status: "pending_review", commandId, unknownNames };
        }
        case "take_screenshot":
          throw new Error("Viewport screenshots require the desktop renderer and are unavailable through the web handler.");
        case "get_history": {
          const limit = finiteLimit(args.limit, 50, 200);
          return { entries: runtime.history.getState().slice(0, limit) };
        }
      }
    },
  };
}
