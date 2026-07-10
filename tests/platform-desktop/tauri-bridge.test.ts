import { describe, expect, it, vi } from "vitest";

import type { RenderRequest } from "../../src/application/engine/contracts";
import { createTauriBridge } from "../../src/platform-desktop/tauri-bridge";

const request: RenderRequest = {
  entryFile: "main.scad",
  files: new Map([["main.scad", "cube(10);"]]),
  parameters: {},
  quality: "preview",
  timeoutMs: 30_000,
};

describe("createTauriBridge", () => {
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

    const result = await bridge.render("job-1", request);

    expect(result).toEqual({
      kind: "3d",
      mesh: { format: "stl-binary", bytes: new Uint8Array([1, 2, 3]) },
      stats: {
        triangles: 12,
        boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
        engineTimeMs: 9,
      },
      diagnostics: [],
      rawLog: "rendered",
    });
    expect(invoke).toHaveBeenCalledWith("render_native", {
      source: "cube(10);",
      quality: "preview",
      parameters: {},
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

    const result = await createTauriBridge(invoke).render("job-diagnostics", request);

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

  it("maps the native temporary entry filename back to the project entry path", async () => {
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
      rawLog: "WARNING: Example in file main.scad, line 6",
      engineTimeMs: 9,
    });

    const result = await createTauriBridge(invoke).render("job-nested", nestedRequest);

    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        message: "Example in file main.scad, line 6",
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

    const result = await createTauriBridge(invoke).render("job-failure", request);

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

    const result = await createTauriBridge(invoke).render("job-missing", request);

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

    await createTauriBridge(invoke).render("job-parameters", parameterRequest);

    expect(invoke).toHaveBeenCalledWith("render_native", {
      source: "cube(10);",
      quality: "preview",
      parameters: parameterRequest.parameters,
    });
  });
});
