import type {
  Diagnostic,
  EngineInfo,
  EngineOutputEvent,
  ExportResult,
  ParamValue,
  RenderResult,
} from "../application/engine/contracts";
import { parseEngineLog } from "../application/diagnostics/parse-engine-log";
import { PINNED_OPENSCAD_WASM_BUILD_IDENTITY } from "../application/engine/engine-pin";
import { parseProjectPath, validateProjectLayout } from "../application/files/project-path";
import { closedMeshVolumeMm3 } from "../application/geometry/stl";
import { parseThreeMf } from "../application/geometry/three-mf";
import type {
  WasmExportRequest,
  WasmProjectFile,
  WasmRenderRequest,
} from "./wasm-engine-protocol";
import {
  decodeOpenScadWasmModuleFactory,
  type OpenScadWasmModule,
  type OpenScadWasmModuleOptions,
} from "./openscad-wasm-module";

export interface OpenScadWasmRuntimeOptions {
  readonly locateFile: (path: string) => string;
  readonly wasmBinary?: Uint8Array;
  readonly now?: () => number;
}

export interface OpenScadWasmRuntime {
  version(): Promise<EngineInfo | null>;
  render(
    request: WasmRenderRequest,
    onOutput?: (event: EngineOutputEvent) => void,
  ): Promise<RenderResult>;
  export(
    request: WasmExportRequest,
    onOutput?: (event: EngineOutputEvent) => void,
  ): Promise<ExportResult>;
}

type OutputStream = EngineOutputEvent["stream"];

interface OutputByte {
  readonly stream: OutputStream;
  readonly byte: number;
}

const THREE_D_FALLBACK_MESSAGE = "Current top level object is not a 3D object.";
const DEFAULT_PREVIEW_FACET_LIMIT = 48;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The OpenSCAD WASM operation failed.";
}

function codePointOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function formatNumber(name: string, value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Invalid parameter ${name}: numbers must be finite.`);
  return Object.is(value, -0) ? "-0" : String(value);
}

function formatString(name: string, value: string): string {
  let output = '"';
  for (const character of value) {
    if (character === "\\") output += "\\\\";
    else if (character === '"') output += '\\"';
    else if (character === "\n") output += "\\n";
    else if (character === "\r") output += "\\r";
    else if (character === "\t") output += "\\t";
    else if (/\p{Cc}/u.test(character)) {
      throw new Error(`Invalid parameter ${name}: strings contain an unsupported control character.`);
    } else output += character;
  }
  return `${output}"`;
}

function formatValue(name: string, value: ParamValue): string {
  if (typeof value === "number") return formatNumber(name, value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return formatString(name, value);
  return `[${value.map((number) => formatNumber(name, number)).join(", ")}]`;
}

function parameterArguments(parameters: Readonly<Record<string, ParamValue>>): string[] {
  const names = Object.keys(parameters).sort(codePointOrder);
  const arguments_: string[] = [];
  for (const name of names) {
    if (!/^\$?[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      throw new Error(`Invalid parameter ${name}: name must be an OpenSCAD identifier.`);
    }
    arguments_.push("-D", `${name}=${formatValue(name, parameters[name])}`);
  }
  return arguments_;
}

function previewArguments(request: WasmRenderRequest): string[] {
  if (request.quality !== "preview") return [];
  const limit = request.previewFacetLimit ?? DEFAULT_PREVIEW_FACET_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 0xffff_ffff) {
    throw new Error("Preview facet limit must be an unsigned 32-bit integer.");
  }
  return ["-D", `$fn=${limit}`];
}

function isTuple(value: unknown, dimensions: number): value is number[] {
  return Array.isArray(value) && value.length === dimensions && value.every(Number.isFinite);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBoundsSummary(source: string): { min: [number, number]; max: [number, number] } {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value) || !isRecord(value.geometry)) {
    throw new Error("OpenSCAD returned an invalid geometry summary.");
  }
  const geometry = value.geometry;
  const bounds = geometry.bounding_box;
  const minimum = isRecord(bounds) ? bounds.min : undefined;
  const maximum = isRecord(bounds) ? bounds.max : undefined;
  if (
    geometry.dimensions !== 2
    || !isTuple(minimum, 2)
    || !isTuple(maximum, 2)
    || minimum.some((coordinate, axis) => coordinate > maximum[axis])
  ) {
    throw new Error("OpenSCAD returned an invalid two-dimensional bounding box.");
  }
  return {
    min: [minimum[0], minimum[1]],
    max: [maximum[0], maximum[1]],
  };
}

function reportedStatistic(rawLog: string, label: string): number | undefined {
  const match = new RegExp(`(?:^|\\n)\\s*${label}:\\s*([0-9]+(?:\\.[0-9]+)?)`, "iu")
    .exec(rawLog);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

function resolveDiagnosticFile(reportedFile: string, files: readonly WasmProjectFile[]): string {
  const normalized = reportedFile.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (files.some(({ path }) => path === normalized)) return normalized;
  const matches = files.filter(({ path }) =>
    normalized.endsWith(`/${path}`) || path.endsWith(`/${normalized}`)
  );
  return matches.length === 1 ? matches[0].path : normalized;
}

function diagnostics(rawLog: string, files: readonly WasmProjectFile[]): Diagnostic[] {
  return parseEngineLog(rawLog, {
    resolveFile: (file) => resolveDiagnosticFile(file, files),
  }).diagnostics;
}

function renderFailure(message: string, rawLog = message, exitCode?: number): RenderResult {
  return {
    kind: "failure",
    reason: "engine-error",
    ...(exitCode !== undefined ? { exitCode } : {}),
    diagnostics: diagnostics(rawLog, []),
    rawLog,
  };
}

function exportFailure(message: string, rawLog = message): ExportResult {
  return { ok: false, diagnostics: diagnostics(rawLog, []), rawLog };
}

function adapterFailureDetails(
  rawLog: string,
  message: string,
  files: readonly WasmProjectFile[],
): { readonly diagnostics: Diagnostic[]; readonly rawLog: string } {
  const adapterMessage = `ScadMill WASM adapter: ${message}`;
  if (!rawLog) {
    return {
      diagnostics: [{ severity: "error", message: adapterMessage }],
      rawLog: message,
    };
  }
  const separator = rawLog.endsWith("\n") ? "" : "\n";
  return {
    diagnostics: [
      ...diagnostics(rawLog, files),
      { severity: "error", message: adapterMessage },
    ],
    rawLog: `${rawLog}${separator}[ScadMill WASM adapter error] ${message}\n`,
  };
}

class OutputCapture {
  private readonly bytes: OutputByte[] = [];
  private readonly lines: Record<OutputStream, number[]> = { stdout: [], stderr: [] };
  private readonly pendingOrder: Record<OutputStream, number | null> = {
    stdout: null,
    stderr: null,
  };
  private sequence = 0;
  private finished = false;

  constructor(
    private readonly started: number,
    private readonly now: () => number,
    private readonly onOutput: (event: EngineOutputEvent) => void,
  ) {}

  accept(stream: OutputStream, byte: number): void {
    if (this.finished || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error("OpenSCAD WASM emitted an invalid output byte.");
    }
    const line = this.lines[stream];
    if (line.length === 0) this.pendingOrder[stream] = this.bytes.length;
    this.bytes.push({ stream, byte });
    line.push(byte);
    if (byte === 10) this.emit(stream);
  }

  rawLog(): string {
    const decoders: Record<OutputStream, TextDecoder> = {
      stdout: new TextDecoder(),
      stderr: new TextDecoder(),
    };
    let output = "";
    for (const { stream, byte } of this.bytes) {
      output += decoders[stream].decode(Uint8Array.of(byte), { stream: true });
    }
    output += decoders.stdout.decode();
    output += decoders.stderr.decode();
    return output;
  }

  elapsedMs(): number {
    return Math.max(0, this.now() - this.started);
  }

  finish(): void {
    if (this.finished) return;
    const pending = (["stdout", "stderr"] as const)
      .filter((stream) => this.lines[stream].length > 0)
      .sort((left, right) =>
        (this.pendingOrder[left] ?? Number.MAX_SAFE_INTEGER)
        - (this.pendingOrder[right] ?? Number.MAX_SAFE_INTEGER)
      );
    for (const stream of pending) {
      this.emit(stream);
    }
    this.finished = true;
  }

  private emit(stream: OutputStream): void {
    const bytes = this.lines[stream].splice(0);
    this.pendingOrder[stream] = null;
    const event = {
      sequence: this.sequence++,
      elapsedMs: this.elapsedMs(),
      stream,
      raw: new TextDecoder().decode(Uint8Array.from(bytes)),
    };
    try {
      this.onOutput(event);
    } catch {
      // Output observers are outside the engine lifecycle and cannot cancel or corrupt it.
    }
  }
}

class CaptureRouter {
  private active: OutputCapture | null = null;

  readonly stdout = (byte: number): void => this.route("stdout", byte);
  readonly stderr = (byte: number): void => this.route("stderr", byte);

  start(capture: OutputCapture): void {
    if (this.active) throw new Error("The OpenSCAD WASM runtime is already busy.");
    this.active = capture;
  }

  finish(capture: OutputCapture): void {
    if (this.active === capture) this.active = null;
    capture.finish();
  }

  private route(stream: OutputStream, byte: number): void {
    this.active?.accept(stream, byte);
  }
}

interface Workspace {
  readonly root: string;
  readonly project: string;
  readonly output: string;
}

const exportFormats = {
  "stl-binary": ["binstl", "stl"],
  "stl-ascii": ["asciistl", "stl"],
  "3mf": ["3mf", "3mf"],
  off: ["off", "off"],
  amf: ["amf", "amf"],
  svg: ["svg", "svg"],
  dxf: ["dxf", "dxf"],
  png: ["png", "png"],
} as const;

const colorThreeMfArguments = [
  "--backend", "Manifold",
  "--enable", "lazy-union",
  "-O", "export-3mf/color-mode=model",
  "-O", "export-3mf/material-type=color",
] as const;

class Runtime implements OpenScadWasmRuntime {
  private workspaceSequence = 0;

  constructor(
    private readonly module: OpenScadWasmModule,
    private readonly router: CaptureRouter,
    private readonly now: () => number,
  ) {}

  async version(): Promise<EngineInfo | null> {
    const capture = this.capture();
    this.router.start(capture);
    try {
      if (this.module.callMain(["--version"]) !== 0) return null;
      const version = capture.rawLog().split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.startsWith("OpenSCAD version "))
        ?.slice("OpenSCAD version ".length);
      return version
        ? { version, path: "wasm", features: [], buildIdentity: PINNED_OPENSCAD_WASM_BUILD_IDENTITY }
        : null;
    } catch {
      return null;
    } finally {
      this.router.finish(capture);
    }
  }

  async render(
    request: WasmRenderRequest,
    onOutput: (event: EngineOutputEvent) => void = () => undefined,
  ): Promise<RenderResult> {
    const capture = this.capture(onOutput);
    let workspace: Workspace | undefined;
    let result: RenderResult;
    this.router.start(capture);
    try {
      const definitions = parameterArguments(request.parameters);
      const facets = previewArguments(request);
      workspace = this.stage(request.entryFile, request.files);
      const threeMfPath = `${workspace.output}/model.3mf`;
      const threeMfExit = this.module.callMain([
        "--export-format", "3mf",
        ...colorThreeMfArguments,
        ...definitions,
        ...facets,
        "-o", threeMfPath,
        request.entryFile,
      ]);
      const threeMfRawLog = capture.rawLog();
      if (threeMfExit === 0) {
        const bytes = this.readBytes(threeMfPath);
        const parsed = parseThreeMf(bytes);
        const vertices = reportedStatistic(threeMfRawLog, "Vertices");
        const volumeMm3 = closedMeshVolumeMm3(parsed.positions);
        result = {
          kind: "3d",
          mesh: { format: "3mf", bytes, parts: parsed.parts },
          stats: {
            ...(vertices !== undefined ? { vertices } : {}),
            triangles: parsed.triangleCount,
            boundingBox: {
              min: [...parsed.bounds.min],
              max: [...parsed.bounds.max],
            },
            volumeMm3,
            engineTimeMs: capture.elapsedMs(),
          },
          diagnostics: diagnostics(threeMfRawLog, request.files),
          rawLog: threeMfRawLog,
        };
      } else if (threeMfRawLog.includes(THREE_D_FALLBACK_MESSAGE)) {
        const svgPath = `${workspace.output}/model.svg`;
        const summaryPath = `${workspace.output}/model-summary.json`;
        const svgExit = this.module.callMain([
          "--export-format", "svg",
          ...definitions,
          ...facets,
          "-o", svgPath,
          request.entryFile,
          "--summary", "geometry",
          "--summary", "bounding-box",
          "--summary-file", summaryPath,
        ]);
        const rawLog = capture.rawLog();
        if (svgExit !== 0) {
          result = {
            ...renderFailure("OpenSCAD could not render SVG output.", rawLog, svgExit),
            diagnostics: diagnostics(rawLog, request.files),
          };
        } else {
          result = {
            kind: "2d",
            svg: this.readText(svgPath),
            boundingBox: parseBoundsSummary(this.readText(summaryPath)),
            diagnostics: diagnostics(rawLog, request.files),
            rawLog,
          };
        }
      } else {
        result = {
          ...renderFailure("OpenSCAD could not render color-preserving 3MF output.", threeMfRawLog, threeMfExit),
          diagnostics: diagnostics(threeMfRawLog, request.files),
        };
      }
    } catch (error) {
      const rawLog = capture.rawLog();
      const message = errorMessage(error);
      const failure = adapterFailureDetails(rawLog, message, request.files);
      result = {
        kind: "failure",
        reason: "engine-error",
        ...failure,
      };
    } finally {
      this.router.finish(capture);
      if (workspace) {
        try {
          this.removeWorkspace(workspace);
        } catch (error) {
          const message = errorMessage(error);
          result = renderFailure(message, message);
        }
      }
    }
    return result;
  }

  async export(
    request: WasmExportRequest,
    onOutput: (event: EngineOutputEvent) => void = () => undefined,
  ): Promise<ExportResult> {
    const capture = this.capture(onOutput);
    let workspace: Workspace | undefined;
    let result: ExportResult;
    this.router.start(capture);
    try {
      const definitions = parameterArguments(request.parameters);
      const [format, extension] = exportFormats[request.format];
      const imageArguments: string[] = [];
      if (request.format === "png") {
        imageArguments.push("--render=true");
        if (request.image) {
          if (
            !Number.isSafeInteger(request.image.width)
            || request.image.width <= 0
            || !Number.isSafeInteger(request.image.height)
            || request.image.height <= 0
          ) throw new Error("PNG width and height must be positive integers.");
          imageArguments.push(`--imgsize=${request.image.width},${request.image.height}`);
          if (request.image.camera) {
            throw new Error(
              "Explicit PNG cameras are unavailable because the pinned engine CLI cannot preserve CameraPose.up (Q-0021).",
            );
          }
        }
      }
      workspace = this.stage(request.entryFile, request.files);
      const outputPath = `${workspace.output}/model.${extension}`;
      const exitCode = this.module.callMain([
        "--export-format", format,
        ...(request.format === "3mf" ? colorThreeMfArguments : []),
        ...definitions,
        "-o", outputPath,
        request.entryFile,
        ...imageArguments,
      ]);
      const rawLog = capture.rawLog();
      result = exitCode === 0
        ? {
            ok: true,
            bytes: this.readBytes(outputPath),
            fileExtension: extension,
            diagnostics: diagnostics(rawLog, request.files),
            rawLog,
          }
        : {
            ok: false,
            diagnostics: diagnostics(rawLog, request.files),
            rawLog,
          };
    } catch (error) {
      const rawLog = capture.rawLog();
      const message = errorMessage(error);
      const failure = adapterFailureDetails(rawLog, message, request.files);
      result = {
        ok: false,
        ...failure,
      };
    } finally {
      this.router.finish(capture);
      if (workspace) {
        try {
          this.removeWorkspace(workspace);
        } catch (error) {
          const message = errorMessage(error);
          result = exportFailure(message, message);
        }
      }
    }
    return result;
  }

  private capture(onOutput: (event: EngineOutputEvent) => void = () => undefined): OutputCapture {
    return new OutputCapture(this.now(), this.now, onOutput);
  }

  private stage(entryFile: string, files: readonly WasmProjectFile[]): Workspace {
    parseProjectPath(entryFile);
    validateProjectLayout(files.map(({ path }) => path));
    const entry = files.find(({ path }) => path === entryFile);
    if (!entry || typeof entry.contents !== "string") {
      throw new Error(`The entry document ${entryFile} is missing or is not UTF-8 text.`);
    }
    const root = `/scadmill/jobs/job-${++this.workspaceSequence}`;
    const workspace = { root, project: `${root}/project`, output: `${root}/output` };
    try {
      this.module.FS.mkdirTree(workspace.project);
      this.module.FS.mkdirTree(workspace.output);
      for (const file of [...files].sort((left, right) => codePointOrder(left.path, right.path))) {
        const destination = `${workspace.project}/${file.path}`;
        const parent = destination.slice(0, destination.lastIndexOf("/"));
        this.module.FS.mkdirTree(parent);
        this.module.FS.writeFile(destination, file.contents);
      }
      this.module.FS.chdir(workspace.project);
      return workspace;
    } catch (error) {
      this.removePartialWorkspace(workspace);
      throw error;
    }
  }

  private readBytes(path: string): Uint8Array {
    const value = this.module.FS.readFile(path, { encoding: "binary" });
    if (!(value instanceof Uint8Array)) throw new Error(`OpenSCAD output ${path} is not binary.`);
    return value.slice();
  }

  private readText(path: string): string {
    const value = this.module.FS.readFile(path, { encoding: "utf8" });
    if (typeof value !== "string") throw new Error(`OpenSCAD output ${path} is not text.`);
    return value;
  }

  private removeWorkspace(workspace: Workspace): void {
    this.module.FS.chdir("/");
    this.removeTree(workspace.root);
    for (const parent of ["/scadmill/jobs", "/scadmill"]) {
      if (this.module.FS.readdir(parent).every((entry) => entry === "." || entry === "..")) {
        this.module.FS.rmdir(parent);
      }
    }
  }

  private removePartialWorkspace(workspace: Workspace): void {
    try {
      this.module.FS.chdir("/");
    } catch {
      // Continue with absolute paths so the staging error remains the reported failure.
    }
    try {
      this.removeTree(workspace.root);
    } catch {
      // A partially-created root may not exist or may itself be unreadable.
    }
    for (const parent of ["/scadmill/jobs", "/scadmill"]) {
      try {
        if (this.module.FS.readdir(parent).every((entry) => entry === "." || entry === "..")) {
          this.module.FS.rmdir(parent);
        }
      } catch {
        // Best effort only: never replace the original mkdir/write failure.
      }
    }
  }

  private removeTree(path: string): void {
    for (const entry of this.module.FS.readdir(path)) {
      if (entry === "." || entry === "..") continue;
      const child = `${path}/${entry}`;
      if (this.module.FS.isDir(this.module.FS.stat(child).mode)) this.removeTree(child);
      else this.module.FS.unlink(child);
    }
    this.module.FS.rmdir(path);
  }
}

export async function createOpenScadWasmRuntime(
  namespace: unknown,
  options: OpenScadWasmRuntimeOptions,
): Promise<OpenScadWasmRuntime> {
  const router = new CaptureRouter();
  const factory = decodeOpenScadWasmModuleFactory(namespace);
  const moduleOptions: OpenScadWasmModuleOptions = {
    noInitialRun: true,
    noExitRuntime: true,
    locateFile: options.locateFile,
    stdout: router.stdout,
    stderr: router.stderr,
    ...(options.wasmBinary ? { wasmBinary: options.wasmBinary.slice() } : {}),
  };
  const module = await factory(moduleOptions);
  return new Runtime(module, router, options.now ?? (() => performance.now()));
}

export type { OpenScadWasmModuleOptions };
