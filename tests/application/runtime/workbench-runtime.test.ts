import { describe, expect, it, vi } from "vitest";

import type {
  EngineService,
  RenderFailure,
  RenderSuccess2D,
  RenderSuccess3D,
} from "../../../src/application/engine/contracts";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { RenderMemoryCache, type RenderCache } from "../../../src/application/render-cache/render-cache";
import type { RenderDiskCacheStorage } from "../../../src/application/render-cache/render-disk-cache";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";

function successfulEngine(): EngineService {
  const result: RenderSuccess3D = {
    kind: "3d",
    mesh: { format: "stl-binary", bytes: new Uint8Array(684) },
    stats: {
      triangles: 12,
      boundingBox: { min: [0, 0, 0], max: [10, 20, 30] },
      engineTimeMs: 8,
    },
    diagnostics: [],
    rawLog: "rendered",
  };
  return {
    render: vi.fn().mockReturnValue({ jobId: "render-1", done: Promise.resolve(result) }),
    export: vi.fn(),
    version: vi.fn().mockResolvedValue({ version: "2021.01", path: "native", features: [] }),
    cancel: vi.fn(),
  };
}

function cacheableEngine(): EngineService {
  const engine = successfulEngine();
  vi.mocked(engine.version).mockResolvedValue({
    version: "2026.06.12",
    path: "native",
    features: [],
    buildIdentity: "native:sha256:engine-a",
  });
  return engine;
}

describe("createWorkbenchRuntime", () => {
  it("renders animation frames as preview requests with a validated $t override", async () => {
    const renderEngine = successfulEngine();
    const runtime = createWorkbenchRuntime(renderEngine, {
      initialScratchSource: "width = 10; cube(width + $t);",
      renderCache: null,
    });
    await runtime.dispatch({
      kind: "update-parameters",
      origin: "user",
      action: { kind: "set-value", documentId: "document-main", name: "width", value: 25 },
    });
    const historyBeforeFrame = runtime.history.getState();

    await runtime.dispatch({
      kind: "render-active",
      origin: "system",
      quality: "preview",
      animationTime: 0.25,
    });

    expect(renderEngine.render).toHaveBeenCalledWith(expect.objectContaining({
      quality: "preview",
      parameters: { width: 25, $t: 0.25 },
    }));
    expect(runtime.render.getState()).toMatchObject({
      status: "success",
      quality: "preview",
      parameterValues: { width: 25 },
    });
    expect(runtime.history.getState()).toEqual(historyBeforeFrame);
    await expect(runtime.dispatch({
      kind: "render-active",
      origin: "system",
      quality: "full",
      animationTime: 0.5,
    })).rejects.toThrow("Animation frames must use preview quality");
    await expect(runtime.dispatch({
      kind: "render-active",
      origin: "system",
      quality: "preview",
      animationTime: Number.NaN,
    })).rejects.toThrow("Animation time must be between 0 and 1");
  });

  it("caches equal animation times and keeps different frames distinct", async () => {
    const renderEngine = cacheableEngine();
    const runtime = createWorkbenchRuntime(renderEngine, {
      renderCache: new RenderMemoryCache(),
    });

    await runtime.dispatch({ kind: "render-active", origin: "system", quality: "preview", animationTime: 0.1 });
    await runtime.dispatch({ kind: "render-active", origin: "system", quality: "preview", animationTime: 0.1 });
    expect(runtime.render.getState()).toMatchObject({ status: "success", cached: true });
    await runtime.dispatch({ kind: "render-active", origin: "system", quality: "preview", animationTime: 0.2 });

    expect(renderEngine.render).toHaveBeenCalledTimes(2);
    expect(runtime.history.getState()).toEqual([]);
  });

  it("persists disk-cache consent per project and never enables scratch implicitly", async () => {
    const enabled = new Map<string, boolean>();
    const preferencePersistence = {
      load: (workspaceIdentity: string) => enabled.get(workspaceIdentity) ?? false,
      save: (workspaceIdentity: string, value: boolean) => { enabled.set(workspaceIdentity, value); },
    };
    const records = new Map<string, Uint8Array>();
    const diskStorage: RenderDiskCacheStorage = {
      read: async (projectIdentity, key) => records.get(`${projectIdentity}:${key}`),
      write: vi.fn(async (projectIdentity, key, bytes) => { records.set(`${projectIdentity}:${key}`, bytes); }),
      remove: async (projectIdentity, key) => { records.delete(`${projectIdentity}:${key}`); },
      list: async (projectIdentity) => [...records]
        .filter(([key]) => key.startsWith(`${projectIdentity}:`))
        .map(([key, bytes]) => ({ key: key.slice(projectIdentity.length + 1), byteSize: bytes.byteLength, lastAccessMs: 1 })),
    };
    const projectA = createProjectSnapshot("project-a", new Map([["Untitled", "cube(1);"]]), "identity-a");
    const initialEngine = cacheableEngine();
    const runtime = createWorkbenchRuntime(initialEngine, {
      initialProject: projectA,
      renderDiskCacheStorage: diskStorage,
      renderDiskCachePreferencePersistence: preferencePersistence,
    });

    expect(runtime.project.getState()).toMatchObject({ diskRenderCacheEnabled: false });
    await runtime.dispatch({ kind: "set-project-disk-render-cache", origin: "user", enabled: true });
    expect(runtime.project.getState()).toMatchObject({ diskRenderCacheEnabled: true });
    expect(enabled.get("identity-a")).toBe(true);
    const restartedEngine = cacheableEngine();
    const restarted = createWorkbenchRuntime(restartedEngine, {
      initialProject: projectA,
      renderDiskCacheStorage: diskStorage,
      renderDiskCachePreferencePersistence: preferencePersistence,
    });
    expect(restarted.project.getState()).toMatchObject({ diskRenderCacheEnabled: true });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    expect(diskStorage.write).toHaveBeenCalledTimes(1);
    await restarted.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    expect(restartedEngine.render).not.toHaveBeenCalled();
    expect(restarted.render.getState()).toMatchObject({ status: "success", cached: true });

    const projectB = createProjectSnapshot("project-b", new Map([["main.scad", "sphere(2);"]]), "identity-b");
    await runtime.dispatch({
      kind: "replace-project-confirmed",
      origin: "user",
      snapshot: projectB,
      displayName: "Project B",
      entryFile: "main.scad",
    });
    expect(runtime.project.getState()).toMatchObject({ diskRenderCacheEnabled: false });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    expect(diskStorage.write).toHaveBeenCalledTimes(1);

    const scratch = createWorkbenchRuntime(cacheableEngine(), {
      renderDiskCacheStorage: diskStorage,
      renderDiskCachePreferencePersistence: preferencePersistence,
    });
    await expect(scratch.dispatch({
      kind: "set-project-disk-render-cache",
      origin: "user",
      enabled: true,
    })).rejects.toThrow("available only for opened projects");
    expect(enabled.has("scratch")).toBe(false);

    const failedPreference = createWorkbenchRuntime(cacheableEngine(), {
      initialProject: projectA,
      renderDiskCacheStorage: diskStorage,
      renderDiskCachePreferencePersistence: {
        load: () => false,
        save: () => { throw new Error("profile full"); },
      },
    });
    await expect(failedPreference.dispatch({
      kind: "set-project-disk-render-cache",
      origin: "user",
      enabled: true,
    })).rejects.toThrow("profile full");
    expect(failedPreference.project.getState()).toMatchObject({ diskRenderCacheEnabled: false });
  });

  it("does not publish a successful project render before its disk-cache write settles", async () => {
    let releaseWrite: () => void = () => undefined;
    let markWriteStarted: () => void = () => undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const writeSettled = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const diskStorage: RenderDiskCacheStorage = {
      read: async () => undefined,
      write: vi.fn(async () => {
        markWriteStarted();
        await writeSettled;
      }),
      remove: async () => undefined,
      list: async () => [],
    };
    const project = createProjectSnapshot(
      "durable-cache-project",
      new Map([["main.scad", "cube(10);"]]),
      "durable-cache-identity",
    );
    const runtime = createWorkbenchRuntime(cacheableEngine(), {
      initialProject: project,
      renderDiskCacheStorage: diskStorage,
      renderDiskCachePreferencePersistence: {
        load: () => true,
        save: () => undefined,
      },
    });

    const render = runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });
    await writeStarted;

    expect(runtime.render.getState()).toMatchObject({ status: "rendering", quality: "full" });
    releaseWrite();
    await render;
    expect(runtime.render.getState()).toMatchObject({
      status: "success",
      quality: "full",
      cached: false,
    });
  });

  it("reuses an unchanged successful render without a second engine invocation", async () => {
    const engine = cacheableEngine();
    const cache = new RenderMemoryCache();
    const cacheGet = vi.spyOn(cache, "get");
    const cacheTouch = vi.spyOn(cache, "touch");
    const runtime = createWorkbenchRuntime(engine, { renderCache: cache });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    const presentationBefore = runtime.viewer.getState().documents.get("document-main")?.presentation;
    cacheTouch.mockClear();
    const viewerUpdate = vi.fn();
    const layoutUpdate = vi.fn();
    const unsubscribeViewer = runtime.viewer.subscribe(viewerUpdate);
    const unsubscribeLayout = runtime.layout.subscribe(layoutUpdate);
    const started = performance.now();
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    unsubscribeViewer();
    unsubscribeLayout();

    expect(performance.now() - started).toBeLessThan(100);
    expect(cacheGet).not.toHaveBeenCalled();
    expect(cacheTouch).toHaveBeenCalledOnce();
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(engine.version).toHaveBeenCalledTimes(1);
    expect(viewerUpdate).toHaveBeenCalledOnce();
    expect(layoutUpdate).not.toHaveBeenCalled();
    const presentationAfter = runtime.viewer.getState().documents.get("document-main")?.presentation;
    expect(presentationAfter?.result).toBe(presentationBefore?.result);
    expect(presentationAfter?.modelIdentity).toBe(presentationBefore?.modelIdentity);
    expect(presentationAfter?.renderIdentity).not.toBe(presentationBefore?.renderIdentity);
    expect(runtime.render.getState()).toMatchObject({
      status: "success",
      cached: true,
      result: { kind: "3d" },
    });
    expect(runtime.console.getState().runs).toHaveLength(1);
  });

  it("does not reuse a presented result after the cache rejects it", async () => {
    const engine = cacheableEngine();
    const runtime = createWorkbenchRuntime(engine, { renderCache: new RenderMemoryCache(0) });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(runtime.render.getState()).toMatchObject({ status: "success", cached: false });
  });

  it("loads the requested cached result before reusing it as the current presentation", async () => {
    const engine = cacheableEngine();
    let job = 0;
    vi.mocked(engine.render).mockImplementation((request) => {
      const fill = Number(request.parameters.size ?? 1);
      const rendered: RenderSuccess3D = {
        kind: "3d",
        mesh: { format: "stl-binary", bytes: new Uint8Array(128).fill(fill) },
        stats: { triangles: fill, engineTimeMs: 1 },
        diagnostics: [],
        rawLog: `size ${fill}`,
      };
      job += 1;
      return {
        jobId: `render-${job}`,
        done: Promise.resolve(rendered),
        subscribeOutput: () => () => undefined,
      };
    });
    const cache = new RenderMemoryCache();
    const cacheGet = vi.spyOn(cache, "get");
    const runtime = createWorkbenchRuntime(engine, {
      renderCache: cache,
      initialScratchSource: "size = 1; cube(size);",
    });
    const setSize = (value: number) => runtime.dispatch({
      kind: "update-parameters" as const,
      origin: "user" as const,
      action: { kind: "set-value" as const, documentId: "document-main", name: "size", value },
    });

    await setSize(1);
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    const firstPresentation = runtime.render.getState().presentationToken;
    await setSize(2);
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    const secondPresentation = runtime.render.getState().presentationToken;
    await setSize(1);
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    const returnedPresentation = runtime.render.getState().presentationToken;

    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(cacheGet).toHaveBeenCalledOnce();
    expect(firstPresentation).toEqual(expect.any(String));
    expect(new Set([firstPresentation, secondPresentation, returnedPresentation])).toHaveProperty("size", 3);
    const cachedA = runtime.render.getState().result;
    expect(cachedA?.kind).toBe("3d");
    if (cachedA?.kind !== "3d") throw new Error("Expected cached A geometry.");
    expect(cachedA.mesh.bytes[0]).toBe(1);

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    const reusedPresentation = runtime.render.getState().presentationToken;
    expect(cacheGet).toHaveBeenCalledOnce();
    expect(runtime.render.getState().result).toBe(cachedA);
    expect(reusedPresentation).not.toBe(returnedPresentation);
    expect(runtime.viewer.getState().documents.get("document-main")?.presentation?.renderIdentity)
      .toBe(runtime.modelHistory.getState().at(-1)?.snapshotId);
    expect(runtime.modelHistory.getState()).toHaveLength(4);
  });

  it("checks a cold disk-capable tier before invoking the engine", async () => {
    const engine = cacheableEngine();
    const cached: RenderSuccess3D = {
      kind: "3d",
      mesh: { format: "stl-binary", bytes: new Uint8Array([1, 2, 3]) },
      stats: { triangles: 1, engineTimeMs: 1 },
      diagnostics: [],
      rawLog: "disk cache",
    };
    const cache: RenderCache = {
      requiresColdLookup: true,
      get: vi.fn(async () => ({ tier: "disk" as const, result: cached })),
      put: vi.fn(async () => undefined),
    };
    const files = new Map<string, string>([["main.scad", Array.from({ length: 64 }, (_, index) => `include <lib-${index}.scad>`).join("\n")]]);
    for (let index = 0; index < 64; index += 1) files.set(`lib-${index}.scad`, `cube(${index});`);
    const runtime = createWorkbenchRuntime(engine, {
      renderCache: cache,
      initialProject: createProjectSnapshot("cold-project", files, "cold-project"),
      initialScratchSource: files.get("main.scad"),
      initialScratchPath: "main.scad",
    });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

    expect(engine.render).not.toHaveBeenCalled();
    expect(cache.get).toHaveBeenCalledOnce();
    expect(runtime.render.getState()).toMatchObject({ status: "success", cached: true, result: cached });
  });

  it("does not cache failures and changes every output-affecting cache key", async () => {
    const failure: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [],
      rawLog: "failed",
    };
    const success = await successfulEngine().render({
      entryFile: "main.scad",
      files: new Map(),
      parameters: {},
      quality: "preview",
      timeoutMs: 30_000,
    }).done;
    const engine = cacheableEngine();
    vi.mocked(engine.render)
      .mockReturnValueOnce({ jobId: "failed", subscribeOutput: () => () => undefined, done: Promise.resolve(failure) })
      .mockReturnValueOnce({ jobId: "recovered", subscribeOutput: () => () => undefined, done: Promise.resolve(success) })
      .mockReturnValueOnce({ jobId: "full", subscribeOutput: () => () => undefined, done: Promise.resolve(success) });
    const runtime = createWorkbenchRuntime(engine);

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });

    expect(engine.render).toHaveBeenCalledTimes(3);
    expect(runtime.render.getState()).toMatchObject({ status: "success", cached: false, quality: "full" });
  });

  it("does not present a result after cancellation during application hashing", async () => {
    let releaseDigest!: () => void;
    const digestReleased = new Promise<void>((resolve) => { releaseDigest = resolve; });
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async () => {
      await digestReleased;
      return new ArrayBuffer(32);
    });
    const engine = successfulEngine();
    const runtime = createWorkbenchRuntime(engine, { renderCache: null });
    try {
      const pending = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

      await vi.waitFor(() => expect(digest).toHaveBeenCalledTimes(1));
      await runtime.dispatch({ kind: "cancel-render", origin: "user" });
      releaseDigest();
      await pending;

      expect(engine.cancel).toHaveBeenCalledWith("render-1");
      expect(runtime.viewer.getState().documents.get("document-main")?.presentation).toBeUndefined();
    } finally {
      digest.mockRestore();
    }
  });

  it("publishes the viewer result before an optional cache write finishes", async () => {
    let releasePut!: () => void;
    const putReleased = new Promise<void>((resolve) => { releasePut = resolve; });
    const cache: RenderCache = {
      get: async () => undefined,
      put: vi.fn(async () => putReleased),
    };
    const runtime = createWorkbenchRuntime(cacheableEngine(), { renderCache: cache });
    const pending = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledOnce());
    expect(runtime.viewer.getState().documents.get("document-main")?.presentation).toMatchObject({
      result: { kind: "3d" },
    });
    expect(runtime.modelHistory.getState()).toHaveLength(1);
    releasePut();
    await pending;
  });

  it("routes edits and renders through one command history", async () => {
    const engine = successfulEngine();
    const runtime = createWorkbenchRuntime(engine, {
      makeId: (() => {
        let next = 0;
        return () => `command-${++next}`;
      })(),
      now: () => new Date("2026-07-10T04:00:00.000Z"),
    });

    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube([10, 20, 30]);",
    });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

    expect(runtime.documents.getState()).toMatchObject({
      activeDocumentId: "document-main",
      documents: [{
        id: "document-main",
        path: "main.scad",
        source: "cube([10, 20, 30]);",
        revision: 1,
        savedRevision: 0,
      }],
    });
    expect(runtime.render.getState()).toMatchObject({
      status: "success",
      jobId: "render-1",
      quality: "preview",
      documentId: "document-main",
      entryFile: "main.scad",
      result: { kind: "3d", stats: { triangles: 12 } },
    });
    expect(runtime.viewer.getState().documents.get("document-main")?.presentation).toMatchObject({
      modelIdentity: runtime.render.getState().presentationToken,
      quality: "preview",
      result: { kind: "3d", stats: { triangles: 12 } },
    });
    expect(engine.render).toHaveBeenCalledWith({
      entryFile: "main.scad",
      files: new Map([["main.scad", "cube([10, 20, 30]);"]]),
      parameters: {},
      previewFacetLimit: 48,
      quality: "preview",
      timeoutMs: 30_000,
    });
    expect(runtime.history.getState()).toEqual([
      {
        commandId: "command-1",
        timestamp: "2026-07-10T04:00:00.000Z",
        origin: "user",
        kind: "edit-document",
        summary: "Edit main.scad",
        undoable: true,
      },
      {
        commandId: "command-2",
        timestamp: "2026-07-10T04:00:00.000Z",
        origin: "user",
        kind: "render-active",
        summary: "Render main.scad at preview quality",
        undoable: false,
      },
    ]);
  });

  it("presents a successful two-dimensional render in the active document viewer", async () => {
    const drawing: RenderSuccess2D = {
      kind: "2d",
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L30 0 L30 -20 Z"/></svg>',
      boundingBox: { min: [0, 0], max: [30, 20] },
      diagnostics: [],
      rawLog: "rendered 2D",
    };
    const engine = successfulEngine();
    vi.mocked(engine.render).mockReturnValue({
      jobId: "render-2d",
      subscribeOutput: () => () => undefined,
      done: Promise.resolve(drawing),
    });
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "render-2d-command" });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

    expect(runtime.viewer.getState().documents.get("document-main")?.presentation).toMatchObject({
      modelIdentity: runtime.render.getState().presentationToken,
      quality: "preview",
      result: {
        ...drawing,
        geometryIdentity: expect.stringMatching(/^sha256:/u),
      },
    });
  });

  it("identifies equal geometry across distinct engine-owned byte arrays", async () => {
    const engine = successfulEngine();
    const first = await engine.render({
      entryFile: "main.scad",
      files: new Map(),
      parameters: {},
      quality: "preview",
      timeoutMs: 30_000,
    }).done;
    if (first.kind !== "3d") throw new Error("Expected the test engine to return 3D geometry.");
    vi.mocked(engine.render)
      .mockReturnValueOnce({
        jobId: "render-first",
        subscribeOutput: () => () => undefined,
        done: Promise.resolve({
          ...first,
          mesh: { ...first.mesh, bytes: first.mesh.bytes.slice() },
        }),
      })
      .mockReturnValueOnce({
        jobId: "render-second",
        subscribeOutput: () => () => undefined,
        done: Promise.resolve({
          ...first,
          mesh: { ...first.mesh, bytes: first.mesh.bytes.slice() },
        }),
      });
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "render-command" });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    const firstModelIdentity = runtime.viewer.getState().documents
      .get("document-main")?.presentation?.modelIdentity;
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });

    expect(runtime.viewer.getState().documents.get("document-main")?.presentation).toMatchObject({
      modelIdentity: firstModelIdentity,
      geometryDelta: { kind: "unchanged" },
      result: { kind: "3d", mesh: { geometryIdentity: expect.stringMatching(/^sha256:/u) } },
    });
  });

  it("compares a later success with the prior success rather than an intervening failure", async () => {
    const first = await successfulEngine().render({
      entryFile: "main.scad",
      files: new Map(),
      parameters: {},
      quality: "preview",
      timeoutMs: 30_000,
    }).done;
    if (first.kind !== "3d") throw new Error("Expected 3D geometry.");
    const failure: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [{ severity: "error", message: "render failed" }],
      rawLog: "render failed",
    };
    const changedBytes = first.mesh.bytes.slice();
    changedBytes[0] = 1;
    const results = [
      { ...first, stats: { ...first.stats, volumeMm3: 100 } },
      failure,
      {
        ...first,
        mesh: { ...first.mesh, bytes: changedBytes },
        stats: { ...first.stats, volumeMm3: 150 },
      },
    ];
    let next = 0;
    const engine = successfulEngine();
    vi.mocked(engine.render).mockImplementation(() => ({
      jobId: `render-${next + 1}`,
      subscribeOutput: () => () => undefined,
      done: Promise.resolve(results[next++]),
    }));
    const runtime = createWorkbenchRuntime(engine);

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });

    expect(runtime.viewer.getState().documents.get("document-main")?.presentation)
      .toMatchObject({ geometryDelta: { kind: "changed", volumeMm3: 50 } });
  });

  it("routes real tab lifecycle mutations once and ignores blocked or stale operations", async () => {
    const runtime = createWorkbenchRuntime(successfulEngine(), {
      makeId: (() => {
        let next = 0;
        return () => `tab-command-${++next}`;
      })(),
      now: () => new Date("2026-07-10T05:00:00.000Z"),
    });

    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    await runtime.dispatch({
      kind: "move-document",
      origin: "user",
      documentId: "document-wheel",
      toIndex: 0,
    });
    await runtime.dispatch({
      kind: "close-document",
      origin: "user",
      documentId: "document-main",
    });
    await runtime.dispatch({ kind: "reopen-document", origin: "user" });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "ai-panel",
      documentId: "document-wheel",
      source: "cylinder(r = 5, h = 2);",
    });
    await runtime.dispatch({
      kind: "close-document",
      origin: "user",
      documentId: "document-wheel",
    });

    expect(runtime.documents.getState()).toMatchObject({
      activeDocumentId: "document-main",
      documents: [
        { id: "document-wheel", source: "cylinder(r = 5, h = 2);", revision: 1 },
        { id: "document-main", source: "cube(10);", revision: 0 },
      ],
      recentlyClosed: [],
    });
    expect(runtime.history.getState().map(({ kind, origin }) => ({ kind, origin }))).toEqual([
      { kind: "open-document", origin: "external-agent" },
      { kind: "activate-document", origin: "user" },
      { kind: "move-document", origin: "user" },
      { kind: "close-document", origin: "user" },
      { kind: "reopen-document", origin: "user" },
      { kind: "edit-document", origin: "ai-panel" },
    ]);
    expect(runtime.history.getState().map(({ commandId, summary, undoable }) => ({
      commandId,
      summary,
      undoable,
    }))).toEqual([
      { commandId: "tab-command-1", summary: "Open parts/wheel.scad", undoable: true },
      { commandId: "tab-command-2", summary: "Activate main.scad", undoable: true },
      { commandId: "tab-command-3", summary: "Move parts/wheel.scad to tab 1", undoable: true },
      { commandId: "tab-command-4", summary: "Close main.scad", undoable: true },
      { commandId: "tab-command-5", summary: "Reopen main.scad", undoable: true },
      { commandId: "tab-command-6", summary: "Edit parts/wheel.scad", undoable: true },
    ]);
  });

  it("does not record identity collisions or invalid move requests", async () => {
    const runtime = createWorkbenchRuntime(successfulEngine(), {
      makeId: () => "document-command",
      now: () => new Date("2026-07-10T05:10:00.000Z"),
    });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: { id: "document-main", path: "spoof.scad", source: "sphere(9);" },
    });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    await runtime.dispatch({
      kind: "move-document",
      origin: "external-agent",
      documentId: "document-main",
      toIndex: 999,
    });

    expect(runtime.documents.getState().documents.map(({ id }) => id)).toEqual([
      "document-main",
      "document-wheel",
    ]);
    expect(runtime.history.getState()).toEqual([{
      commandId: "document-command",
      timestamp: "2026-07-10T05:10:00.000Z",
      origin: "external-agent",
      kind: "open-document",
      summary: "Open parts/wheel.scad",
      undoable: true,
    }]);
  });

  it("renders the active document snapshot with every open text buffer", async () => {
    const engine = successfulEngine();
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "render-command" });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });

    expect(engine.render).toHaveBeenCalledWith({
      entryFile: "parts/wheel.scad",
      files: new Map([
        ["main.scad", "cube(10);"],
        ["parts/wheel.scad", "cylinder(r = 4, h = 2);"],
      ]),
      parameters: {},
      quality: "full",
      timeoutMs: 600_000,
    });
    expect(runtime.render.getState()).toMatchObject({
      status: "success",
      documentId: "document-wheel",
      entryFile: "parts/wheel.scad",
    });
  });

  it("does not carry a completed mesh into a new document render", async () => {
    const completed = successfulEngine().render({
      entryFile: "main.scad",
      files: new Map(),
      parameters: {},
      quality: "preview",
      timeoutMs: 30_000,
    }).done;
    let resolveSecond!: (result: Awaited<typeof completed>) => void;
    const second = new Promise<Awaited<typeof completed>>((resolve) => {
      resolveSecond = resolve;
    });
    const engine = successfulEngine();
    vi.mocked(engine.render)
      .mockReturnValueOnce({
        jobId: "render-main",
        subscribeOutput: () => () => undefined,
        done: completed,
      })
      .mockReturnValueOnce({
        jobId: "render-wheel",
        subscribeOutput: () => () => undefined,
        done: second,
      });
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "render-command" });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    const pending = runtime.dispatch({
      kind: "render-active",
      origin: "user",
      quality: "preview",
    });

    expect(runtime.render.getState()).toEqual({
      status: "rendering",
      jobId: "render-wheel",
      startedAtMonotonicMs: expect.any(Number),
      startedAtMs: expect.any(Number),
      quality: "preview",
      documentId: "document-wheel",
      entryFile: "parts/wheel.scad",
      sourceRevision: 0,
      projectRevision: 0,
      parameterValues: {},
      sourceFiles: new Map([
        ["main.scad", "cube(10);"],
        ["parts/wheel.scad", "cylinder(r = 4, h = 2);"],
      ]),
    });
    resolveSecond(await completed);
    await pending;
  });

  it("identifies a completed render by source revision and does not surface a stale failure", async () => {
    const failure: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [{ severity: "error", message: "Parser error" }],
      rawLog: "Parser error",
    };
    let resolveRender!: (result: RenderFailure) => void;
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "render-revision-zero",
        done: new Promise<RenderFailure>((resolve) => {
          resolveRender = resolve;
        }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "revision-command" });
    const pending = runtime.dispatch({
      kind: "render-active",
      origin: "user",
      quality: "preview",
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    resolveRender(failure);
    await pending;

    expect(runtime.render.getState()).toMatchObject({
      status: "failure",
      documentId: "document-main",
      sourceRevision: 0,
      result: failure,
    });
    expect(runtime.documents.getState().documents[0].revision).toBe(1);
    expect(runtime.layout.getState().consoleOpen).toBe(false);
  });

  it("ignores an older render that resolves after a newer job starts", async () => {
    const base = await successfulEngine().render({
      entryFile: "main.scad",
      files: new Map(),
      parameters: {},
      quality: "preview",
      timeoutMs: 30_000,
    }).done;
    if (base.kind !== "3d") throw new Error("Expected the test engine to return 3D geometry.");
    let resolveFirst!: (result: RenderSuccess3D) => void;
    let resolveSecond!: (result: RenderSuccess3D) => void;
    const engine = successfulEngine();
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    vi.mocked(engine.render)
      .mockReturnValueOnce({
        jobId: "render-first",
        subscribeOutput: () => () => undefined,
        done: new Promise<RenderSuccess3D>((resolve) => { resolveFirst = resolve; }),
      })
      .mockReturnValueOnce({
        jobId: "render-second",
        subscribeOutput: () => () => undefined,
        done: new Promise<RenderSuccess3D>((resolve) => { resolveSecond = resolve; }),
      });
    const runtime = createWorkbenchRuntime(engine, {
      makeId: () => "render-command",
      renderCache: null,
    });

    const first = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    const second = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    expect(engine.cancel).toHaveBeenCalledWith("render-first");
    resolveFirst({ ...base, stats: { ...base.stats, triangles: 1 } });
    await first;
    expect(runtime.render.getState()).toMatchObject({ status: "rendering", jobId: "render-second" });
    expect(runtime.render.getState().result).toBeUndefined();

    resolveSecond({ ...base, stats: { ...base.stats, triangles: 2 } });
    await second;
    expect(runtime.render.getState()).toMatchObject({
      status: "success",
      jobId: "render-second",
      result: { stats: { triangles: 2 } },
    });
    expect(digest).toHaveBeenCalledTimes(1);
  });

  it("routes an explicit cancel command to only the active native job", async () => {
    let resolveRender!: (result: RenderFailure) => void;
    const engine = successfulEngine();
    vi.mocked(engine.render).mockReturnValue({
      jobId: "render-cancelled",
      subscribeOutput: () => () => undefined,
      done: new Promise<RenderFailure>((resolve) => { resolveRender = resolve; }),
    });
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "cancel-command" });
    const pending = runtime.dispatch({
      kind: "render-active",
      origin: "user",
      quality: "preview",
    });

    await runtime.dispatch({ kind: "cancel-render", origin: "user" });
    expect(engine.cancel).toHaveBeenCalledTimes(1);
    expect(engine.cancel).toHaveBeenCalledWith("render-cancelled");

    resolveRender({
      kind: "failure",
      reason: "cancelled",
      diagnostics: [],
      rawLog: "cancelled",
    });
    await pending;
    await runtime.dispatch({ kind: "cancel-render", origin: "user" });
    expect(engine.cancel).toHaveBeenCalledTimes(1);
  });

  it("records editor command invocations on the shared command bus", async () => {
    const runtime = createWorkbenchRuntime(successfulEngine(), {
      makeId: () => "editor-command-id",
    });

    await runtime.dispatch({
      kind: "editor-command",
      origin: "user",
      outcome: { command: "toggle-comment", status: "handled" },
    });

    expect(runtime.history.getState()).toContainEqual({
      commandId: "editor-command-id",
      timestamp: expect.any(String),
      origin: "user",
      kind: "editor-command",
      summary: "Editor command: toggle-comment",
      undoable: false,
    });
  });

  it("debounces rapid edits into exactly one completed automatic preview", async () => {
    vi.useFakeTimers();
    try {
      const engine = successfulEngine();
      let completed = 0;
      vi.mocked(engine.render).mockImplementation(() => ({
        jobId: "auto-render",
        subscribeOutput: () => () => undefined,
        done: Promise.resolve<RenderFailure>({
          kind: "failure",
          reason: "engine-error",
          diagnostics: [],
          rawLog: "test",
        }).then((result) => {
          completed += 1;
          return result;
        }),
      }));
      const runtime = createWorkbenchRuntime(engine, { makeId: () => "auto-command" });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });

      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "cube(11);",
      });
      await vi.advanceTimersByTimeAsync(400);
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "cube(12);",
      });
      await vi.advanceTimersByTimeAsync(799);
      expect(engine.render).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(engine.render).toHaveBeenCalledTimes(1);
      expect(engine.render).toHaveBeenCalledWith(expect.objectContaining({
        entryFile: "main.scad",
        quality: "preview",
        timeoutMs: 30_000,
      }));
      expect(completed).toBe(1);
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the configured default quality for automatic renders", async () => {
    vi.useFakeTimers();
    try {
      const engine = successfulEngine();
      const runtime = createWorkbenchRuntime(engine, { makeId: () => "auto-full-command" });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });
      await runtime.dispatch({
        kind: "replace-settings",
        origin: "user",
        settings: {
          ...runtime.settings.getState().profile,
          rendering: {
            ...runtime.settings.getState().profile.rendering,
            defaultQuality: "full",
          },
        },
      });
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "cube(22);",
      });

      await vi.advanceTimersByTimeAsync(800);

      expect(engine.render).toHaveBeenCalledTimes(1);
      expect(engine.render).toHaveBeenCalledWith(expect.objectContaining({
        quality: "full",
        timeoutMs: 600_000,
      }));
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a welcome sample after an initially unavailable engine becomes ready", async () => {
    vi.useFakeTimers();
    try {
      const engine = successfulEngine();
      const runtime = createWorkbenchRuntime(engine, { makeId: () => "welcome-engine-race" });

      await runtime.dispatch({
        kind: "open-welcome-sample-confirmed",
        origin: "user",
        documentId: "document-main",
        path: "gear_knob.scad",
        source: "knob_diameter = 34; cylinder(d = knob_diameter, h = 14);",
      });
      await vi.advanceTimersByTimeAsync(800);
      expect(engine.render).not.toHaveBeenCalled();

      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });
      await vi.advanceTimersByTimeAsync(800);

      expect(engine.render).toHaveBeenCalledTimes(1);
      expect(engine.render).toHaveBeenCalledWith(expect.objectContaining({
        entryFile: "gear_knob.scad",
        quality: "preview",
      }));
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("can turn automatic rendering off and disposes a pending timer", async () => {
    vi.useFakeTimers();
    try {
      const engine = successfulEngine();
      const runtime = createWorkbenchRuntime(engine, { makeId: () => "auto-off-command" });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });
      await runtime.dispatch({ kind: "set-auto-render", origin: "user", enabled: false });
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "cube(20);",
      });
      await vi.advanceTimersByTimeAsync(800);
      expect(engine.render).not.toHaveBeenCalled();

      await runtime.dispatch({ kind: "set-auto-render", origin: "user", enabled: true });
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "cube(21);",
      });
      runtime.dispose();
      await vi.advanceTimersByTimeAsync(800);
      expect(engine.render).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("streams and finishes each engine run in a separate console record", async () => {
    let emit!: (event: {
      sequence: number;
      elapsedMs: number;
      stream: "stdout" | "stderr";
      raw: string;
    }) => void;
    let resolve!: (result: RenderFailure) => void;
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "streamed-run",
        subscribeOutput(listener: typeof emit) {
          emit = listener;
          return vi.fn();
        },
        done: new Promise<RenderFailure>((done) => { resolve = done; }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const times = [100, 112];
    const runtime = createWorkbenchRuntime(engine, {
      makeId: () => "stream-command",
      nowMs: () => times.shift() ?? 112,
    });

    const pending = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    emit({ sequence: 0, elapsedMs: 3, stream: "stdout", raw: "ECHO: one\n" });
    expect(runtime.console.getState()).toMatchObject({
      retainedLineCount: 1,
      runs: [{ jobId: "streamed-run", status: "running", lines: [{ raw: "ECHO: one\n" }] }],
    });
    resolve({
      kind: "failure",
      reason: "engine-error",
      exitCode: 1,
      diagnostics: [{ severity: "echo", message: "one" }],
      rawLog: "ECHO: one\n",
    });
    await pending;

    expect(runtime.console.getState().runs[0]).toMatchObject({
      status: "engine-error",
      durationMs: 12,
      exitCode: 1,
      diagnostics: [{ severity: "echo", message: "one" }],
      lines: [{ raw: "ECHO: one\n" }],
    });
  });

  it("clears console history without erasing the current render result", async () => {
    const runtime = createWorkbenchRuntime(successfulEngine(), { makeId: () => "clear-command" });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    expect(runtime.console.getState().runs).toHaveLength(1);
    expect(runtime.render.getState().result).toBeDefined();

    await runtime.dispatch({ kind: "clear-console", origin: "user" });

    expect(runtime.console.getState().runs).toEqual([]);
    expect(runtime.render.getState().result).toBeDefined();
    expect(runtime.history.getState().at(-1)?.undoable).toBe(true);

    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    expect(runtime.console.getState().runs).toHaveLength(1);
    expect(runtime.render.getState().result).toBeDefined();

    await runtime.dispatch({ kind: "history-redo", origin: "user" });
    expect(runtime.console.getState().runs).toEqual([]);
    expect(runtime.render.getState().result).toBeDefined();
  });

  it("does not auto-open an empty console for a current background-tab failure", async () => {
    const failure: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [{ severity: "error", message: "Parser error" }],
      rawLog: "Parser error",
    };
    let resolveRender!: (result: RenderFailure) => void;
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "render-main",
        done: new Promise<RenderFailure>((resolve) => { resolveRender = resolve; }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "background-command" });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    const pending = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-wheel",
    });
    resolveRender(failure);
    await pending;

    expect(runtime.render.getState()).toMatchObject({
      status: "failure",
      documentId: "document-main",
      result: failure,
    });
    expect(runtime.layout.getState().consoleOpen).toBe(false);
  });

  it("does not auto-open the console when an edit-revert changed the source revision", async () => {
    const failure: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [{ severity: "error", message: "Old parser error" }],
      rawLog: "Old parser error",
    };
    let resolveRender!: (result: RenderFailure) => void;
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "render-revision-zero",
        done: new Promise<RenderFailure>((resolve) => { resolveRender = resolve; }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "revert-command" });
    const pending = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(10);",
    });
    resolveRender(failure);
    await pending;

    expect(runtime.documents.getState().documents[0].revision).toBe(2);
    expect(runtime.layout.getState().consoleOpen).toBe(false);
  });

  it("records one command for a real theme change and ignores a no-op selection", async () => {
    const engine = successfulEngine();
    const runtime = createWorkbenchRuntime(engine, {
      makeId: () => "theme-command",
      now: () => new Date("2026-07-10T06:30:00.000Z"),
    });

    expect(runtime.settings.getState()).toMatchObject({
      theme: "system",
      autoRender: true,
      engineAvailable: false,
      renderDebounceMs: 800,
      previewTimeoutMs: 30_000,
      fullTimeoutMs: 600_000,
      previewFacetLimit: 48,
    });
    expect(runtime.settings.getState().editor).toMatchObject({ fontSize: 14, tabWidth: 4 });
    expect(runtime.settings.getState().keybindings.renderPreview).toBe("F5");

    await runtime.dispatch({ kind: "set-theme", origin: "user", theme: "high-contrast" });
    await runtime.dispatch({ kind: "set-theme", origin: "user", theme: "high-contrast" });

    expect(runtime.settings.getState()).toMatchObject({ theme: "high-contrast" });
    expect(runtime.history.getState()).toEqual([
      {
        commandId: "theme-command",
        timestamp: "2026-07-10T06:30:00.000Z",
        origin: "user",
        kind: "set-theme",
        summary: "Switch theme to High contrast",
        undoable: true,
      },
    ]);
    expect(engine.render).not.toHaveBeenCalled();
  });
});
