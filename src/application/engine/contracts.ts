export type Quality = "preview" | "full";
export type MeshFormat = "stl-binary" | "stl-ascii" | "3mf" | "off" | "amf";
export type FlatFormat = "svg" | "dxf";
export type ImageFormat = "png";
export type ExportFormat = MeshFormat | FlatFormat | ImageFormat;
export type ParamValue = number | boolean | string | number[];

export interface RenderRequest {
  entryFile: string;
  files: ReadonlyMap<string, string | Uint8Array>;
  parameters: Readonly<Record<string, ParamValue>>;
  quality: Quality;
  timeoutMs: number;
  previewFacetLimit?: number;
}

export interface Diagnostic {
  severity: "error" | "warning" | "echo" | "trace" | "info";
  message: string;
  file?: string;
  line?: number;
}

export interface RenderStats {
  vertices?: number;
  triangles?: number;
  boundingBox?: { min: [number, number, number]; max: [number, number, number] };
  volumeMm3?: number;
  engineTimeMs: number;
}

export interface RenderSuccess3D {
  kind: "3d";
  mesh: { format: MeshFormat; bytes: Uint8Array; geometryIdentity?: string };
  stats: RenderStats;
  diagnostics: Diagnostic[];
  rawLog: string;
}

export interface RenderSuccess2D {
  kind: "2d";
  svg: string;
  geometryIdentity?: string;
  boundingBox: { min: [number, number]; max: [number, number] };
  diagnostics: Diagnostic[];
  rawLog: string;
}

export interface RenderFailure {
  kind: "failure";
  reason: "engine-error" | "timeout" | "cancelled" | "engine-missing";
  exitCode?: number;
  diagnostics: Diagnostic[];
  rawLog: string;
}

export type RenderResult = RenderSuccess3D | RenderSuccess2D | RenderFailure;

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

export interface ExportRequest extends Omit<RenderRequest, "quality"> {
  format: ExportFormat;
  image?: { width: number; height: number; camera?: CameraPose };
}

export interface ExportResult {
  ok: boolean;
  bytes?: Uint8Array;
  fileExtension?: string;
  diagnostics: Diagnostic[];
  rawLog: string;
}

export interface EngineInfo {
  version: string;
  path: "native" | "wasm";
  features: string[];
  /** Verified artifact or executable digest; absent means cache reuse is disabled. */
  buildIdentity?: string;
}

export interface EngineOutputEvent {
  sequence: number;
  elapsedMs: number;
  stream: "stdout" | "stderr";
  raw: string;
}

export interface RenderJob<T> {
  jobId: string;
  done: Promise<T>;
  subscribeOutput(listener: (event: EngineOutputEvent) => void): () => void;
}

export interface EngineService {
  render(request: RenderRequest): RenderJob<RenderResult>;
  export(request: ExportRequest): RenderJob<ExportResult>;
  version(): Promise<EngineInfo | null>;
  cancel(jobId: string): void;
}
