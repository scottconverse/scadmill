import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import { decodeProjectZip, encodeProjectZip } from "../../../src/application/files/project-zip";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { encodeShareLink } from "../../../src/application/files/share-link";
import {
  createWorkbenchProjectPortabilityController,
  type ImportedProjectStorage,
} from "../../../src/application/files/workbench-portability";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";

function engine(): EngineService {
  return {
    cancel: vi.fn(),
    export: vi.fn(),
    render: vi.fn(),
    version: vi.fn(),
  };
}

describe("workbench project portability adapter", () => {
  it("exports dirty open buffers with untouched binary project files", async () => {
    let archive = new Uint8Array();
    const snapshot = createProjectSnapshot("assembly", new Map<string, string | Uint8Array>([
      ["main.scad", "cube(10);"],
      ["asset.stl", Uint8Array.of(65, 66, 67)],
    ]));
    const runtime = createWorkbenchRuntime(engine(), {
      artifactDestination: {
        available: true,
        save: async ({ bytes }) => {
          archive = bytes.slice();
          return { location: "assembly.zip" };
        },
      },
      initialProject: snapshot,
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: runtime.documents.getState().activeDocumentId,
      source: "sphere(12);",
    });
    const controller = createWorkbenchProjectPortabilityController(runtime, {
      replace: vi.fn(),
    }, {
      copyText: vi.fn(),
      currentHref: () => "https://studio.example/",
      makeProjectId: () => "imported",
    });

    await controller.exportProjectZip();
    const decoded = decodeProjectZip("decoded", archive);

    expect(decoded.files.get("main.scad" as never)).toBe("sphere(12);");
    expect(decoded.files.get("asset.stl" as never)).toEqual(Uint8Array.of(65, 66, 67));
  });

  it("persists an imported ZIP before replacing the workbench project", async () => {
    const source = createProjectSnapshot("source", new Map([
      ["main.scad", "cylinder(8);"],
    ]));
    let archive = new Uint8Array();
    const exportingRuntime = createWorkbenchRuntime(engine(), {
      artifactDestination: {
        available: true,
        save: async ({ bytes }) => {
          archive = bytes.slice();
          return { location: "source.zip" };
        },
      },
      initialProject: source,
    });
    await createWorkbenchProjectPortabilityController(exportingRuntime, { replace: vi.fn() }, {
      copyText: vi.fn(),
      currentHref: () => "https://studio.example/",
      makeProjectId: () => "unused",
    }).exportProjectZip();

    const order: string[] = [];
    const storage: ImportedProjectStorage = {
      replace: async () => { order.push("persist"); },
    };
    const freshRuntime = createWorkbenchRuntime(engine(), { makeId: () => "imported-main" });
    freshRuntime.project.subscribe(() => { order.push("replace-workbench"); });
    const controller = createWorkbenchProjectPortabilityController(freshRuntime, storage, {
      copyText: vi.fn(),
      currentHref: () => "https://studio.example/",
      makeProjectId: () => "imported-project",
    });

    await controller.importProjectZip({
      name: "Assembly.zip",
      size: archive.byteLength,
      arrayBuffer: async () => archive.slice().buffer,
    });

    expect(order.slice(0, 2)).toEqual(["persist", "replace-workbench"]);
    expect(freshRuntime.project.getState()).toMatchObject({
      mode: "project",
      displayName: "Assembly",
    });
    expect(freshRuntime.documents.getState().documents[0]).toMatchObject({
      path: "main.scad",
      source: "cube(10);",
    });
  });

  it("opens a shared link in a new scratch tab", async () => {
    const source = "// shared\nsphere(4);";
    const href = await encodeShareLink(source, "https://maker.example/editor");
    const runtime = createWorkbenchRuntime(engine());
    const controller = createWorkbenchProjectPortabilityController(runtime, { replace: vi.fn() }, {
      copyText: vi.fn(),
      currentHref: () => href,
      makeProjectId: () => "imported",
    });

    const shared = await controller.openStartupShare();

    expect(shared?.origin).toBe("maker.example");
    expect(runtime.documents.getState().documents).toHaveLength(2);
    expect(runtime.documents.getState().documents.find(
      ({ id }) => id === runtime.documents.getState().activeDocumentId,
    )?.source).toBe(source);
    expect(runtime.project.getState().mode).toBe("scratch");
  });

  it("opens a startup share in a distinct dirty tab without replacing restored scratch", async () => {
    const restoredSource = "// restored autosave\ncube(42);";
    const sharedSource = "// shared\nsphere(4);";
    const href = await encodeShareLink(sharedSource, "https://maker.example/editor");
    const runtime = createWorkbenchRuntime(engine(), {
      initialScratchPath: "Untitled",
      initialScratchSource: restoredSource,
      makeId: () => "shared-document",
    });
    const original = runtime.documents.getState().documents[0];
    const controller = createWorkbenchProjectPortabilityController(runtime, { replace: vi.fn() }, {
      copyText: vi.fn(),
      currentHref: () => href,
      makeProjectId: () => "imported",
    });

    await controller.openStartupShare();

    const workspace = runtime.documents.getState();
    expect(workspace.documents).toHaveLength(2);
    expect(workspace.documents.find(({ id }) => id === original.id)).toMatchObject({
      source: restoredSource,
      savedSource: restoredSource,
    });
    expect(workspace.documents.find(({ id }) => id === workspace.activeDocumentId)).toMatchObject({
      id: "shared-document",
      source: sharedSource,
      savedSource: "",
    });
  });

  it("refuses to replace dirty tabs during project ZIP import", async () => {
    const runtime = createWorkbenchRuntime(engine());
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(99);",
    });
    const replace = vi.fn();
    const controller = createWorkbenchProjectPortabilityController(runtime, { replace }, {
      copyText: vi.fn(),
      currentHref: () => "https://studio.example/",
      makeProjectId: () => "imported",
    });
    const archive = encodeProjectZip(createProjectSnapshot("incoming", new Map([
      ["main.scad", "sphere(5);"],
    ])));

    await expect(controller.importProjectZip({
      name: "incoming.zip",
      size: archive.byteLength,
      arrayBuffer: async () => archive.slice().buffer,
    })).rejects.toThrow(/unsaved/iu);
    expect(replace).not.toHaveBeenCalled();
    expect(runtime.project.getState().mode).toBe("scratch");
  });
});
