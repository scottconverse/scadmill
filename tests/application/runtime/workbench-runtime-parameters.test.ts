import { describe, expect, it, vi } from "vitest";
import type {
  EngineService,
  RenderRequest,
  RenderSuccess3D,
} from "../../../src/application/engine/contracts";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { parameterDocument } from "../../../src/application/parameters/parameter-state";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";

const success: RenderSuccess3D = {
  kind: "3d",
  mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
  stats: { engineTimeMs: 1 },
  diagnostics: [],
  rawLog: "",
};

function captureEngine(requests: RenderRequest[]): EngineService {
  return {
    render: vi.fn((request: RenderRequest) => {
      requests.push(request);
      return { jobId: `job-${requests.length}`, done: Promise.resolve(success), subscribeOutput: () => () => undefined };
    }),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
}

describe("workbench customizer integration", () => {
  it("always debounces control changes to preview even when editor auto-render defaults to full", async () => {
    vi.useFakeTimers();
    try {
      const requests: RenderRequest[] = [];
      const runtime = createWorkbenchRuntime(captureEngine(requests), {
        rendering: { defaultQuality: "full" },
      });
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "width = 10; cube(width);",
      });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value: 25 },
      });

      await vi.advanceTimersByTimeAsync(800);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.quality).toBe("preview");
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains preview intent for its document across tab switches without rendering the other tab", async () => {
    vi.useFakeTimers();
    try {
      const requests: RenderRequest[] = [];
      const runtime = createWorkbenchRuntime(captureEngine(requests), {
        initialScratchSource: "width = 10; cube(width);",
      });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });
      await runtime.dispatch({
        kind: "open-document",
        origin: "user",
        document: { id: "document-b", path: "b.scad", source: "cube(2);" },
      });
      await runtime.dispatch({
        kind: "activate-document",
        origin: "user",
        documentId: "document-main",
      });
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value: 25 },
      });
      await runtime.dispatch({
        kind: "activate-document",
        origin: "user",
        documentId: "document-b",
      });

      await vi.advanceTimersByTimeAsync(800);
      expect(requests).toEqual([]);

      await runtime.dispatch({
        kind: "activate-document",
        origin: "user",
        documentId: "document-main",
      });
      await vi.advanceTimersByTimeAsync(800);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.entryFile).toBe("main.scad");
      expect(requests[0]?.parameters).toEqual({ width: 25 });
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps independent pending previews when both documents change before either debounce fires", async () => {
    vi.useFakeTimers();
    try {
      const requests: RenderRequest[] = [];
      const runtime = createWorkbenchRuntime(captureEngine(requests), {
        initialScratchSource: "width = 10; cube(width);",
      });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });
      await runtime.dispatch({
        kind: "open-document",
        origin: "user",
        document: { id: "document-b", path: "b.scad", source: "depth = 2; cube(depth);" },
      });
      await runtime.dispatch({
        kind: "activate-document",
        origin: "user",
        documentId: "document-main",
      });
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value: 25 },
      });
      await runtime.dispatch({
        kind: "activate-document",
        origin: "user",
        documentId: "document-b",
      });
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-b", name: "depth", value: 3 },
      });
      await vi.advanceTimersByTimeAsync(800);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.entryFile).toBe("b.scad");
      expect(requests[0]?.parameters).toEqual({ depth: 3 });

      await runtime.dispatch({
        kind: "activate-document",
        origin: "user",
        documentId: "document-main",
      });
      await vi.advanceTimersByTimeAsync(800);
      expect(requests).toHaveLength(2);
      expect(requests[1]?.entryFile).toBe("main.scad");
      expect(requests[1]?.parameters).toEqual({ width: 25 });
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears pending preview intent after a manual render or closing its document", async () => {
    vi.useFakeTimers();
    try {
      const requests: RenderRequest[] = [];
      const runtime = createWorkbenchRuntime(captureEngine(requests), {
        initialScratchSource: "width = 10; cube(width);",
      });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value: 20 },
      });
      await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });
      await vi.advanceTimersByTimeAsync(800);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.quality).toBe("full");

      await runtime.dispatch({
        kind: "open-document",
        origin: "user",
        document: { id: "document-b", path: "b.scad", source: "cube(2);" },
      });
      await runtime.dispatch({
        kind: "activate-document",
        origin: "user",
        documentId: "document-main",
      });
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value: 30 },
      });
      await runtime.dispatch({
        kind: "close-document",
        origin: "user",
        documentId: "document-main",
      });
      await vi.advanceTimersByTimeAsync(800);
      expect(requests).toHaveLength(1);

      await runtime.dispatch({ kind: "reopen-document", origin: "user" });
      await vi.advanceTimersByTimeAsync(800);
      expect(requests).toHaveLength(1);
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("replaces old pending intent with the replacement project's active preview", async () => {
    vi.useFakeTimers();
    try {
      const requests: RenderRequest[] = [];
      const runtime = createWorkbenchRuntime(captureEngine(requests), {
        initialScratchSource: "width = 10; cube(width);",
      });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value: 25 },
      });
      await runtime.dispatch({
        kind: "replace-project-confirmed",
        origin: "user",
        snapshot: createProjectSnapshot("replacement", new Map([
          ["main.scad", "height = 12; cube(height);"],
        ])),
        displayName: "Replacement",
        entryFile: "main.scad",
      });
      await vi.advanceTimersByTimeAsync(800);

      expect(requests).toHaveLength(1);
      expect(requests[0]?.files.get("main.scad")).toBe("height = 12; cube(height);");
      expect(requests[0]?.parameters).toEqual({});
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders active compatible overrides without rewriting the source", async () => {
    vi.useFakeTimers();
    try {
      const requests: RenderRequest[] = [];
      const runtime = createWorkbenchRuntime(captureEngine(requests));
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "width = 10; cube(width);",
      });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value: 25 },
      });

      await vi.advanceTimersByTimeAsync(799);
      expect(requests).toEqual([]);
      expect(runtime.documents.getState().documents[0].source).toBe("width = 10; cube(width);");

      await vi.advanceTimersByTimeAsync(1);
      expect(requests).toHaveLength(1);
      expect(requests[0].quality).toBe("preview");
      expect(requests[0].parameters).toEqual({ width: 25 });
      expect(runtime.documents.getState().documents[0].source).toBe("width = 10; cube(width);");
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes exactly the assignment RHS and clears the now-redundant override", async () => {
    const runtime = createWorkbenchRuntime(captureEngine([]));
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "width   =   10; // [1:100]\ncube(width);",
    });
    await runtime.dispatch({
      kind: "update-parameters",
      origin: "user",
      action: { kind: "set-value", documentId: "document-main", name: "width", value: 32 },
    });
    await runtime.dispatch({
      kind: "write-parameter-values",
      origin: "user",
      documentId: "document-main",
    });

    expect(runtime.documents.getState().documents[0].source).toBe(
      "width   =   32; // [1:100]\ncube(width);",
    );
    expect(runtime.parameters.getState().documents.get("document-main")?.overrides).toEqual({});
  });

  it("drops a renamed parameter override on the next source revision", async () => {
    const runtime = createWorkbenchRuntime(captureEngine([]));
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "width = 10; cube(width);",
    });
    await runtime.dispatch({
      kind: "update-parameters",
      origin: "user",
      action: { kind: "set-value", documentId: "document-main", name: "width", value: 25 },
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "height = 10; cube(height);",
    });

    const parameters = runtime.parameters.getState().documents.get("document-main");
    expect(parameters?.parameters.map(({ name }) => name)).toEqual(["height"]);
    expect(parameters?.overrides).toEqual({});
  });

  it("rebuilds parameter state when a confirmed project replaces the workspace", async () => {
    const runtime = createWorkbenchRuntime(captureEngine([]));
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "width = 10; cube(width);",
    });
    await runtime.dispatch({
      kind: "update-parameters",
      origin: "user",
      action: { kind: "set-value", documentId: "document-main", name: "width", value: 25 },
    });
    await runtime.dispatch({
      kind: "replace-project-confirmed",
      origin: "user",
      snapshot: createProjectSnapshot("replacement", new Map([
        ["main.scad", "height = 12; cube(height);"],
      ])),
      displayName: "Replacement",
      entryFile: "main.scad",
    });

    const documentId = runtime.documents.getState().activeDocumentId;
    const parameters = runtime.parameters.getState();
    expect([...parameters.documents]).toHaveLength(1);
    expect(parameters.documents.get(documentId)?.parameters.map(({ name }) => name)).toEqual([
      "height",
    ]);
    expect(parameters.documents.get(documentId)?.overrides).toEqual({});
    runtime.dispose();
  });

  it("resets stale parameter state when a closed identity is opened as a fresh document", async () => {
    const runtime = createWorkbenchRuntime(captureEngine([]));
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "width = 10; cube(width);",
    });
    await runtime.dispatch({
      kind: "mark-document-autosaved",
      origin: "system",
      documentId: "document-main",
      revision: 1,
      source: "width = 10; cube(width);",
    });
    await runtime.dispatch({
      kind: "update-parameters",
      origin: "user",
      action: { kind: "set-value", documentId: "document-main", name: "width", value: 25 },
    });
    await runtime.dispatch({
      kind: "open-document",
      origin: "user",
      document: { id: "other", path: "other.scad", source: "cube(2);" },
    });
    await runtime.dispatch({
      kind: "close-document",
      origin: "user",
      documentId: "document-main",
    });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: { id: "document-main", path: "main.scad", source: "height = 12; cube(height);" },
    });

    const parameters = parameterDocument(runtime.parameters.getState(), "document-main");
    expect(parameters.parameters.map(({ name }) => name)).toEqual(["height"]);
    expect(parameters.overrides).toEqual({});
    runtime.dispose();
  });
});
