import { describe, expect, it, vi } from "vitest";

import type { EngineService, ExportResult, RenderJob } from "../../../src/application/engine/contracts";
import type { ArtifactDestination } from "../../../src/application/files/artifact-destination";
import {
  type ProjectExportError,
  startProjectExport,
} from "../../../src/application/files/project-export";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../../../src/application/files/project-snapshot";

function binaryStl(): Uint8Array {
  const bytes = new Uint8Array(84 + 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  const vertices = [[0, 0, 0], [2, 0, 0], [0, 3, 4]];
  vertices.flat().forEach((coordinate, index) => {
    view.setFloat32(96 + index * 4, coordinate, true);
  });
  return bytes;
}

function exportJob(result: ExportResult, jobId = "export-job"): RenderJob<ExportResult> {
  return {
    jobId,
    done: Promise.resolve(result),
    subscribeOutput: () => () => undefined,
  };
}

function setup(result: ExportResult = {
  ok: true,
  bytes: binaryStl(),
  fileExtension: "stl",
  diagnostics: [],
  rawLog: "",
}) {
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(() => exportJob(result)),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const destination: ArtifactDestination = {
    available: true,
    save: vi.fn(async ({ suggestedName }) => ({ location: `Downloads/${suggestedName}` })),
  };
  const snapshot = createProjectSnapshot("project", new Map<string, ProjectFileContent>([
    ["parts/cube.scad", "cube(10);"],
    ["parts/logo.png", new Uint8Array([1, 2, 3])],
  ]));
  return { destination, engine, snapshot };
}

describe("project export", () => {
  it("uses the full-only engine export contract and saves before reporting exact STL facts", async () => {
    const { destination, engine, snapshot } = setup();

    const operation = startProjectExport({
      engine,
      destination,
      snapshot,
      entryFile: "parts/cube.scad",
      format: "stl-binary",
      parameters: { size: 10 },
      timeoutMs: 600_000,
    });

    expect(engine.export).toHaveBeenCalledWith({
      entryFile: "parts/cube.scad",
      files: snapshot.files,
      format: "stl-binary",
      parameters: { size: 10 },
      timeoutMs: 600_000,
    });
    expect("quality" in vi.mocked(engine.export).mock.calls[0][0]).toBe(false);
    await expect(operation.done).resolves.toEqual({
      format: "stl-binary",
      location: "Downloads/cube.stl",
      fileName: "cube.stl",
      fileSizeBytes: 134,
      triangleCount: 1,
      boundingBox: { min: [0, 0, 0], max: [2, 3, 4], size: [2, 3, 4] },
      diagnostics: [],
    });
    expect(destination.save).toHaveBeenCalledWith({
      suggestedName: "cube.stl",
      bytes: binaryStl(),
      mimeType: "model/stl",
    });
  });

  it("uses a validated batch-provided output filename", async () => {
    const { destination, engine, snapshot } = setup();
    const operation = startProjectExport({
      engine,
      destination,
      snapshot,
      entryFile: "parts/cube.scad",
      format: "stl-binary",
      parameters: { size: 20 },
      timeoutMs: 600_000,
      outputFileName: "cube-Tall.stl",
    });

    await expect(operation.done).resolves.toMatchObject({ fileName: "cube-Tall.stl" });
    expect(destination.save).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: "cube-Tall.stl",
    }));
    expect(() => startProjectExport({
      engine,
      destination,
      snapshot,
      entryFile: "parts/cube.scad",
      format: "stl-binary",
      parameters: {},
      timeoutMs: 600_000,
      outputFileName: "../escape.stl",
    })).toThrow(/file name/iu);
  });

  it("does not save failed or byte-less engine output and exposes engine diagnostics", async () => {
    for (const result of [
      { ok: false, diagnostics: [{ severity: "error" as const, message: "Unknown module" }], rawLog: "ERROR" },
      { ok: true, diagnostics: [], rawLog: "no bytes" },
    ]) {
      const { destination, engine, snapshot } = setup(result);
      const operation = startProjectExport({
        engine,
        destination,
        snapshot,
        entryFile: "parts/cube.scad",
        format: "3mf",
        parameters: {},
        timeoutMs: 1_000,
      });

      await expect(operation.done).rejects.toMatchObject({ phase: "engine" });
      expect(destination.save).not.toHaveBeenCalled();
    }
  });

  it("distinguishes a destination failure and forwards cancellation to the engine job", async () => {
    const { destination, engine, snapshot } = setup();
    vi.mocked(destination.save).mockRejectedValueOnce(new Error("disk full"));
    const operation = startProjectExport({
      engine,
      destination,
      snapshot,
      entryFile: "parts/cube.scad",
      format: "stl-binary",
      parameters: {},
      timeoutMs: 1_000,
    });

    operation.cancel();
    expect(engine.cancel).toHaveBeenCalledWith("export-job");
    await expect(operation.done).rejects.toEqual(expect.objectContaining({
      phase: "destination",
      message: "The model rendered, but cube.stl could not be saved: disk full",
    } satisfies Partial<ProjectExportError>));
  });

  it("rejects an unavailable destination before starting engine work", () => {
    const { destination, engine, snapshot } = setup();
    Object.assign(destination, { available: false });

    expect(() => startProjectExport({
      engine,
      destination,
      snapshot,
      entryFile: "parts/cube.scad",
      format: "3mf",
      parameters: {},
      timeoutMs: 1_000,
    })).toThrow(/destination is unavailable/iu);
    expect(engine.export).not.toHaveBeenCalled();
  });

  it("does not save malformed binary STL or claim a blank destination receipt", async () => {
    const malformed = new Uint8Array(84);
    new DataView(malformed.buffer).setUint32(80, 1, true);
    const malformedSetup = setup({
      ok: true,
      bytes: malformed,
      diagnostics: [],
      rawLog: "",
    });
    const malformedOperation = startProjectExport({
      engine: malformedSetup.engine,
      destination: malformedSetup.destination,
      snapshot: malformedSetup.snapshot,
      entryFile: "parts/cube.scad",
      format: "stl-binary",
      parameters: {},
      timeoutMs: 1_000,
    });

    await expect(malformedOperation.done).rejects.toMatchObject({ phase: "engine" });
    expect(malformedSetup.destination.save).not.toHaveBeenCalled();

    const blankReceiptSetup = setup();
    vi.mocked(blankReceiptSetup.destination.save).mockResolvedValueOnce({ location: "   " });
    const blankReceiptOperation = startProjectExport({
      engine: blankReceiptSetup.engine,
      destination: blankReceiptSetup.destination,
      snapshot: blankReceiptSetup.snapshot,
      entryFile: "parts/cube.scad",
      format: "stl-binary",
      parameters: {},
      timeoutMs: 1_000,
    });
    await expect(blankReceiptOperation.done).rejects.toMatchObject({ phase: "destination" });
  });

  it.each([
    ["3mf", "cube.3mf", "model/3mf"],
    ["stl-ascii", "cube.stl", "model/stl"],
    ["off", "cube.off", "application/octet-stream"],
    ["amf", "cube.amf", "application/x-amf"],
  ] as const)("runs a cancellable binary-STL companion for exact %s mesh facts", async (
    format,
    fileName,
    mimeType,
  ) => {
    const primaryBytes = new TextEncoder().encode(`primary-${format}`);
    const context = setup();
    vi.mocked(context.engine.export).mockImplementation((request) => request.format === "stl-binary"
      ? exportJob({ ok: true, bytes: binaryStl(), diagnostics: [], rawLog: "" }, "summary-job")
      : exportJob({ ok: true, bytes: primaryBytes, diagnostics: [], rawLog: "" }, "artifact-job"));

    const operation = startProjectExport({
      engine: context.engine,
      destination: context.destination,
      snapshot: context.snapshot,
      entryFile: "parts/cube.scad",
      format,
      parameters: {},
      timeoutMs: 1_000,
    });
    operation.cancel();

    expect(vi.mocked(context.engine.export).mock.calls.map(([request]) => request.format)).toEqual([
      format,
      "stl-binary",
    ]);
    expect(vi.mocked(context.engine.export).mock.calls.every(([request]) => !("quality" in request)))
      .toBe(true);
    expect(context.engine.cancel).toHaveBeenCalledWith("artifact-job");
    expect(context.engine.cancel).toHaveBeenCalledWith("summary-job");
    await expect(operation.done).resolves.toMatchObject({
      format,
      fileName,
      fileSizeBytes: primaryBytes.byteLength,
      triangleCount: 1,
      boundingBox: { min: [0, 0, 0], max: [2, 3, 4], size: [2, 3, 4] },
    });
    expect(context.destination.save).toHaveBeenCalledWith({
      suggestedName: fileName,
      bytes: primaryBytes,
      mimeType,
    });
  });
});
