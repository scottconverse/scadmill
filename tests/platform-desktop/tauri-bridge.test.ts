import { describe, expect, it, vi } from "vitest";

import type {
  EngineOutputEvent,
  ExportRequest,
  RenderRequest,
} from "../../src/application/engine/contracts";
import { createTauriBridge } from "../../src/platform-desktop/tauri-bridge";

const request: RenderRequest = {
  entryFile: "main.scad",
  files: new Map([["main.scad", "cube(10);"]]),
  parameters: {},
  quality: "preview",
  timeoutMs: 30_000,
};

describe("createTauriBridge", () => {
  it("sends the complete text-and-byte project and forwards ordered native output events", async () => {
    const events: EngineOutputEvent[] = [];
    const invoke = vi.fn().mockImplementation((_command, args) => {
      args.onOutput.emit({
        sequence: 0,
        elapsedMs: 4,
        stream: "stderr",
        raw: "WARNING: staged\n",
      });
      return Promise.resolve({
        kind: "failure",
        reason: "cancelled",
        rawLog: "WARNING: staged\n",
      });
    });
    const projectRequest: RenderRequest = {
      ...request,
      entryFile: "models/main.scad",
      files: new Map<string, string | Uint8Array>([
        ["models/main.scad", "include <../parts/body.scad>; body();"],
        ["parts/body.scad", "module body() { cube(10); }"],
        ["assets/reference.stl", new Uint8Array([0, 255, 1])],
      ]),
      timeoutMs: 12_345,
    };
    const channelFactory = vi.fn((handler: (event: EngineOutputEvent) => void) => ({
      emit: handler,
    }));
    const bridge = createTauriBridge(invoke, channelFactory);

    await bridge.render("job-project", projectRequest, (event) => events.push(event));

    expect(invoke).toHaveBeenCalledWith("render_native", {
      jobId: "job-project",
      entryFile: "models/main.scad",
      files: [
        {
          path: "models/main.scad",
          text: true,
          contentsBase64: "aW5jbHVkZSA8Li4vcGFydHMvYm9keS5zY2FkPjsgYm9keSgpOw==",
        },
        {
          path: "parts/body.scad",
          text: true,
          contentsBase64: "bW9kdWxlIGJvZHkoKSB7IGN1YmUoMTApOyB9",
        },
        { path: "assets/reference.stl", text: false, contentsBase64: "AP8B" },
      ],
      quality: "preview",
      parameters: {},
      previewFacetLimit: 48,
      timeoutMs: 12_345,
      onOutput: expect.any(Object),
    });
    expect(events).toEqual([
      { sequence: 0, elapsedMs: 4, stream: "stderr", raw: "WARNING: staged\n" },
    ]);
  });

  it("decodes native mesh bytes and maps geometry statistics", async () => {
    const invoke = vi.fn().mockResolvedValue({
      kind: "3d",
      format: "stl-binary",
      meshBase64: "AQID",
      triangleCount: 12,
      bounds: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] },
      rawLog: "rendered",
      engineTimeMs: 9,
    });
    const bridge = createTauriBridge(invoke);

    const result = await bridge.render("job-1", request, vi.fn());

    expect(result).toEqual({
      kind: "3d",
      mesh: {
        format: "stl-binary",
        bytes: new Uint8Array([1, 2, 3]),
      },
      stats: {
        triangles: 12,
        boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
        engineTimeMs: 9,
      },
      diagnostics: [],
      rawLog: "rendered",
    });
    expect(invoke).toHaveBeenCalledWith("render_native", {
      jobId: "job-1",
      entryFile: "main.scad",
      files: [{
        path: "main.scad",
        text: true,
        contentsBase64: "Y3ViZSgxMCk7",
      }],
      quality: "preview",
      parameters: {},
      previewFacetLimit: 48,
      timeoutMs: 30_000,
      onOutput: expect.any(Object),
    });
  });

  it("records optional geometry statistics reported by the engine", async () => {
    const invoke = vi.fn().mockResolvedValue({
      kind: "3d",
      format: "stl-binary",
      meshBase64: "AQID",
      triangleCount: 12,
      bounds: { min: [0, 0, 0], max: [5, 5, 5], size: [5, 5, 5] },
      volumeMm3: 125.5,
      rawLog: "Vertices: 8\nFacets: 6\n",
      engineTimeMs: 11,
    });

    const result = await createTauriBridge(invoke).render("job-stats", request, vi.fn());

    expect(result).toMatchObject({
      kind: "3d",
      stats: { vertices: 8, triangles: 12, volumeMm3: 125.5, engineTimeMs: 11 },
    });
  });

  it("maps the native raw log into structured diagnostics", async () => {
    const rawLog = [
      "WARNING: Ignoring unknown variable 'missing' in file main.scad, line 4",
      "ECHO: \"hi\", 42",
    ].join("\n");
    const invoke = vi.fn().mockResolvedValue({
      kind: "3d",
      format: "stl-binary",
      meshBase64: "AQID",
      triangleCount: 12,
      bounds: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] },
      rawLog,
      engineTimeMs: 9,
    });

    const result = await createTauriBridge(invoke).render("job-diagnostics", request, vi.fn());

    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        message: "Ignoring unknown variable 'missing' in file main.scad, line 4",
        file: "main.scad",
        line: 4,
      },
      { severity: "echo", message: "\"hi\", 42" },
    ]);
    expect(result.rawLog).toBe(rawLog);
  });

  it("preserves the actual project-relative entry path reported by the native engine", async () => {
    const nestedRequest: RenderRequest = {
      ...request,
      entryFile: "parts/body.scad",
      files: new Map([["parts/body.scad", "cube(10);"]]),
    };
    const invoke = vi.fn().mockResolvedValue({
      kind: "3d",
      format: "stl-binary",
      meshBase64: "AQID",
      triangleCount: 12,
      bounds: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] },
      rawLog: "WARNING: Example in file parts/body.scad, line 6",
      engineTimeMs: 9,
    });

    const result = await createTauriBridge(invoke).render("job-nested", nestedRequest, vi.fn());

    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        message: "Example in file parts/body.scad, line 6",
        file: "parts/body.scad",
        line: 6,
      },
    ]);
  });

  it("preserves a native engine failure and parses its exact raw diagnostics", async () => {
    const rawLog = [
      "ERROR: Parser error: syntax error in file main.scad, line 2",
      "Can't parse file 'main.scad'!",
    ].join("\n");
    const invoke = vi.fn().mockResolvedValue({
      kind: "failure",
      reason: "engine-error",
      exitCode: 1,
      rawLog,
    });

    const result = await createTauriBridge(invoke).render("job-failure", request, vi.fn());

    expect(result).toEqual({
      kind: "failure",
      reason: "engine-error",
      exitCode: 1,
      diagnostics: [
        {
          severity: "error",
          message: "Parser error: syntax error in file main.scad, line 2",
          file: "main.scad",
          line: 2,
        },
      ],
      rawLog,
    });
  });

  it("omits a null native exit code from the normative failure result", async () => {
    const invoke = vi.fn().mockResolvedValue({
      kind: "failure",
      reason: "engine-missing",
      exitCode: null,
      rawLog: "OpenSCAD engine was not found",
    });

    const result = await createTauriBridge(invoke).render("job-missing", request, vi.fn());

    expect(result).toEqual({
      kind: "failure",
      reason: "engine-missing",
      diagnostics: [],
      rawLog: "OpenSCAD engine was not found",
    });
  });

  it("forwards every typed parameter override to the native command", async () => {
    const invoke = vi.fn().mockResolvedValue({
      kind: "failure",
      reason: "cancelled",
      rawLog: "",
    });
    const parameterRequest: RenderRequest = {
      ...request,
      parameters: {
        size: 20,
        centered: true,
        label: "quoted \"text\"",
        points: [1, -2.5, 3],
      },
    };

    await createTauriBridge(invoke).render("job-parameters", parameterRequest, vi.fn());

    expect(invoke).toHaveBeenCalledWith("render_native", {
      jobId: "job-parameters",
      entryFile: "main.scad",
      files: [{
        path: "main.scad",
        text: true,
        contentsBase64: "Y3ViZSgxMCk7",
      }],
      quality: "preview",
      parameters: parameterRequest.parameters,
      previewFacetLimit: 48,
      timeoutMs: 30_000,
      onOutput: expect.any(Object),
    });
  });

  it("maps an engine-selected 2D SVG render without inspecting source", async () => {
    const invoke = vi.fn().mockResolvedValue({
      kind: "2d",
      svg: "<svg viewBox=\"0 -5 4 5\"></svg>",
      bounds: { min: [0, 0], max: [4, 5] },
      rawLog: "Top level object is a 2D object",
    });

    const result = await createTauriBridge(invoke).render("job-2d", request, vi.fn());

    expect(result).toEqual({
      kind: "2d",
      svg: "<svg viewBox=\"0 -5 4 5\"></svg>",
      boundingBox: { min: [0, 0], max: [4, 5] },
      diagnostics: [],
      rawLog: "Top level object is a 2D object",
    });
  });

  it("runs every export at full quality and decodes its artifact", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      artifactBase64: "AQID",
      fileExtension: "3mf",
      rawLog: "exported",
    });
    const exportRequest: ExportRequest = {
      entryFile: request.entryFile,
      files: request.files,
      parameters: {},
      timeoutMs: 600_000,
      format: "3mf",
    };

    const result = await createTauriBridge(invoke).export("job-export", exportRequest, vi.fn());

    expect(result).toEqual({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      fileExtension: "3mf",
      diagnostics: [],
      rawLog: "exported",
    });
    expect(invoke).toHaveBeenCalledWith("export_native", expect.objectContaining({
      jobId: "job-export",
      quality: "full",
      previewFacetLimit: null,
      timeoutMs: 600_000,
      format: "3mf",
    }));
  });

  it("forwards cancellation and maps an unavailable version probe to null", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const bridge = createTauriBridge(invoke);

    bridge.cancel("job-cancel");
    await expect(bridge.version()).resolves.toBeNull();

    expect(invoke).toHaveBeenCalledWith("cancel_native", { jobId: "job-cancel" });
    expect(invoke).toHaveBeenCalledWith("native_engine_version");
  });

  it("preserves the native executable build identity from version discovery", async () => {
    const invoke = vi.fn().mockResolvedValue({
      version: "2026.07",
      buildIdentity: "native:sha256:abc123",
    });
    const bridge = createTauriBridge(invoke);

    await expect(bridge.version()).resolves.toEqual({
      version: "2026.07",
      path: "native",
      features: [],
      buildIdentity: "native:sha256:abc123",
    });
  });

  it("forwards the configured engine path to render, export, and version discovery", async () => {
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "render_native") {
        return Promise.resolve({ kind: "failure", reason: "cancelled", rawLog: "" });
      }
      if (command === "export_native") {
        return Promise.resolve({ ok: false, rawLog: "cancelled" });
      }
      return Promise.resolve("2021.01");
    });
    const bridge = createTauriBridge(
      invoke,
      (handler) => ({ emit: handler }),
      () => " C:\\OpenSCAD\\openscad.exe ",
    );
    const exportRequest: ExportRequest = {
      entryFile: request.entryFile,
      files: request.files,
      parameters: {},
      timeoutMs: 600_000,
      format: "stl-binary",
    };

    await bridge.render("job-configured-render", request, vi.fn());
    await bridge.export("job-configured-export", exportRequest, vi.fn());
    await bridge.version();

    expect(invoke).toHaveBeenCalledWith("render_native", expect.objectContaining({
      configuredEnginePath: "C:\\OpenSCAD\\openscad.exe",
    }));
    expect(invoke).toHaveBeenCalledWith("export_native", expect.objectContaining({
      configuredEnginePath: "C:\\OpenSCAD\\openscad.exe",
    }));
    expect(invoke).toHaveBeenCalledWith("native_engine_version", {
      configuredEnginePath: "C:\\OpenSCAD\\openscad.exe",
    });
  });
});
