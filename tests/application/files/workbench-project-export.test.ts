import { describe, expect, it, vi } from "vitest";

import type {
  EngineService,
  ExportRequest,
  ExportResult,
  RenderJob,
} from "../../../src/application/engine/contracts";
import type { ArtifactDestination } from "../../../src/application/files/artifact-destination";
import {
  startWorkbenchBatchProjectExport,
  startWorkbenchProjectExport,
} from "../../../src/application/files/workbench-project-export";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";

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

function exportJob(result: ExportResult): RenderJob<ExportResult> {
  return {
    jobId: "c5-export",
    done: Promise.resolve(result),
    subscribeOutput: () => () => undefined,
  };
}

describe("workbench project export Customizer integration", () => {
  it("forwards a copied active override snapshot to full export without rewriting source", async () => {
    const requests: ExportRequest[] = [];
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn((request) => {
        requests.push(request);
        return exportJob({
          ok: true,
          bytes: binaryStl(),
          diagnostics: [],
          rawLog: "",
        });
      }),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const destination: ArtifactDestination = {
      available: true,
      save: vi.fn(async ({ suggestedName }) => ({ location: `Downloads/${suggestedName}` })),
    };
    const runtime = createWorkbenchRuntime(engine, { artifactDestination: destination });
    const source = "width = 10; point = [1, 2]; __proto__ = [0, 1]; cube(width);";
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source,
    });
    await runtime.dispatch({
      kind: "update-parameters",
      origin: "user",
      action: { kind: "set-value", documentId: "document-main", name: "width", value: 25 },
    });
    await runtime.dispatch({
      kind: "update-parameters",
      origin: "user",
      action: { kind: "set-value", documentId: "document-main", name: "point", value: [3, 4] },
    });
    await runtime.dispatch({
      kind: "update-parameters",
      origin: "user",
      action: {
        kind: "set-value",
        documentId: "document-main",
        name: "__proto__",
        value: [5, 6],
      },
    });
    const storedPoint = runtime.parameters.getState().documents
      .get("document-main")?.overrides.point;

    const operation = startWorkbenchProjectExport(runtime, engine, "stl-binary");

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      entryFile: "main.scad",
      format: "stl-binary",
      parameters: { width: 25, point: [3, 4] },
      timeoutMs: runtime.settings.getState().fullTimeoutMs,
    });
    expect(requests[0].files).toEqual(new Map([["main.scad", source]]));
    expect(requests[0].parameters.point).not.toBe(storedPoint);
    expect(Object.getPrototypeOf(requests[0].parameters)).toBe(Object.prototype);
    expect(Object.hasOwn(requests[0].parameters, "__proto__")).toBe(true);
    expect(Reflect.get(requests[0].parameters, "__proto__")).toEqual([5, 6]);
    expect("quality" in requests[0]).toBe(false);
    expect("previewFacetLimit" in requests[0]).toBe(false);
    expect(runtime.documents.getState().documents[0]?.source).toBe(source);
    await expect(operation.done).resolves.toMatchObject({ fileName: "main.stl" });
    runtime.dispose();
  });

  it("AC-15.d saves one full export for each of three selected parameter sets", async () => {
    const requests: ExportRequest[] = [];
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn((request) => {
        requests.push(request);
        return {
          ...exportJob({ ok: true, bytes: binaryStl(), diagnostics: [], rawLog: "" }),
          jobId: `batch-${requests.length}`,
        };
      }),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const destination: ArtifactDestination = {
      available: true,
      save: vi.fn(async ({ suggestedName }) => ({ location: `Downloads/${suggestedName}` })),
    };
    const runtime = createWorkbenchRuntime(engine, { artifactDestination: destination });
    const sets = [
      { name: "Small", values: { width: 10 } },
      { name: "Medium", values: { width: 20 } },
      { name: "Large", values: { width: 30 } },
    ] as const;

    const operation = startWorkbenchBatchProjectExport(
      runtime,
      engine,
      "stl-binary",
      sets,
      "{model}-{set}.{ext}",
    );
    const result = await operation.done;

    expect(requests.map(({ parameters }) => parameters)).toEqual([
      { width: 10 }, { width: 20 }, { width: 30 },
    ]);
    expect(requests.every((request) => !("quality" in request))).toBe(true);
    expect(vi.mocked(destination.save).mock.calls.map(([request]) => request.suggestedName)).toEqual([
      "main-Small.stl", "main-Medium.stl", "main-Large.stl",
    ]);
    expect(result.items.map(({ status }) => status)).toEqual(["success", "success", "success"]);
    runtime.dispose();
  });
});
