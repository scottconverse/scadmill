import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../../../src/application/files/project-snapshot";
import type { ParameterAction } from "../../../src/application/parameters/parameter-state";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { viewerDocument } from "../../../src/application/viewer/viewer-state";

function engine(): EngineService {
  return {
    render: vi.fn().mockReturnValue({
      jobId: "history-render",
      done: Promise.resolve({
        kind: "failure",
        reason: "engine-error",
        diagnostics: [],
        rawLog: "history test",
      }),
      subscribeOutput: () => () => undefined,
    }),
    export: vi.fn(),
    version: vi.fn().mockResolvedValue({ version: "2026.06.12", path: "native", features: [] }),
    cancel: vi.fn(),
  };
}

function observable(runtime: ReturnType<typeof createWorkbenchRuntime>) {
  const document = runtime.documents.getState().documents.find(({ id }) => id === "document-main");
  const parameters = runtime.parameters.getState().documents.get("document-main");
  return {
    source: document?.source,
    overrides: parameters ? { ...parameters.overrides } : undefined,
    revisionsAligned: document?.revision === parameters?.revision,
  };
}

function memoryStorage(files: Map<string, ProjectFileContent>): ProjectStorage {
  return {
    snapshot: async (projectId) => createProjectSnapshot(projectId, files),
    write: async (_projectId, path, content) => { files.set(path, content); },
    move: async (_projectId, from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`Missing ${from}`);
      files.delete(from);
      files.set(to, content);
    },
    trash: async (_projectId, path) => { files.delete(path); },
    reveal: async () => undefined,
  };
}

describe("AC-11.a reversible command history", () => {
  it("publishes a source diff detail with editor, AI, and external edit entries", async () => {
    const runtime = createWorkbenchRuntime(engine(), {
      makeId: (() => { let id = 0; return () => `detail-${++id}`; })(),
      rendering: { autoRender: false },
    });
    for (const [origin, source] of [
      ["user", "cube(11);"],
      ["ai-panel", "sphere(4);"],
      ["external-agent", "cylinder(8, 2, 2);"],
    ] as const) {
      await runtime.dispatch({
        kind: "edit-document",
        origin,
        documentId: "document-main",
        source,
      });
    }

    expect([...runtime.historyDetails.getState().entries()]).toEqual([
      ["detail-1", { kind: "source-diff", path: "main.scad", before: "cube(10);", after: "cube(11);" }],
      ["detail-2", { kind: "source-diff", path: "main.scad", before: "cube(11);", after: "sphere(4);" }],
      ["detail-3", { kind: "source-diff", path: "main.scad", before: "sphere(4);", after: "cylinder(8, 2, 2);" }],
    ]);
  });

  it("undoes and redoes a scripted edit/parameter/source-write sequence without adding history", async () => {
    const runtime = createWorkbenchRuntime(engine(), {
      initialScratchSource: "width = 10; depth = 5; cube([width, depth, 1]);",
      makeId: (() => { let id = 0; return () => `history-${++id}`; })(),
      rendering: { autoRender: false },
    });
    const actions = [
      {
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "width = 12; depth = 5; cube([width, depth, 1]);",
      },
      {
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value: 20 },
      },
      {
        kind: "update-parameters",
        origin: "external-agent",
        action: {
          kind: "set-values",
          documentId: "document-main",
          values: { width: 30, depth: 8 },
        },
      },
      { kind: "write-parameter-values", origin: "user", documentId: "document-main" },
    ] as const;
    const states = [observable(runtime)];

    for (const [index, action] of actions.entries()) {
      await runtime.dispatch(action);
      states.push(observable(runtime));
      expect(runtime.history.getState()).toHaveLength(index + 1);
      expect(runtime.history.getState().at(-1)?.undoable).toBe(true);
      expect(observable(runtime).revisionsAligned).toBe(true);
    }
    const originalHistory = runtime.history.getState();

    for (let index = actions.length - 1; index >= 0; index -= 1) {
      await runtime.dispatch({ kind: "history-undo", origin: "user" });
      expect(observable(runtime)).toEqual(states[index]);
      expect(runtime.history.getState()).toEqual(originalHistory);
    }
    for (let index = 1; index <= actions.length; index += 1) {
      await runtime.dispatch({ kind: "history-redo", origin: "user" });
      expect(observable(runtime)).toEqual(states[index]);
      expect(runtime.history.getState()).toEqual(originalHistory);
    }
  });

  it("installs the inverse before publishing an undoable entry", async () => {
    const runtime = createWorkbenchRuntime(engine(), { rendering: { autoRender: false } });
    let reactiveUndo: Promise<void> | undefined;
    const unsubscribe = runtime.history.subscribe((entries) => {
      if (entries.at(-1)?.undoable) {
        reactiveUndo = runtime.dispatch({ kind: "history-undo", origin: "user" });
      }
    });

    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    await reactiveUndo;

    expect(observable(runtime).source).toBe("cube(10);");
    expect(runtime.history.getState()).toHaveLength(1);
    unsubscribe();
  });

  it("undoes and redoes a user-confirmed external reload without losing older edit history", async () => {
    const runtime = createWorkbenchRuntime(engine(), { rendering: { autoRender: false } });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    await runtime.dispatch({
      kind: "resolve-external-change",
      origin: "user",
      documentId: "document-main",
      diskSource: "sphere(4);",
      choice: "reload",
    });

    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    expect(observable(runtime).source).toBe("cube(11);");
    await runtime.dispatch({ kind: "history-redo", origin: "user" });
    expect(observable(runtime).source).toBe("sphere(4);");
    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    expect(observable(runtime).source).toBe("cube(10);");
    expect(runtime.history.getState()).toHaveLength(2);
  });

  it("reverses Welcome and MCP settings through the same command history", async () => {
    const savedWelcomePreferences: boolean[] = [];
    const runtime = createWorkbenchRuntime(engine(), {
      rendering: { autoRender: false },
      welcomePreferencePersistence: {
        load: () => false,
        save: (enabled) => { savedWelcomePreferences.push(enabled); },
      },
    });
    const commands = [
      { kind: "set-welcome-on-launch", origin: "user", enabled: true },
      { kind: "set-mcp-enabled", origin: "user", enabled: true },
      {
        kind: "set-mcp-permission",
        origin: "user",
        tool: "write_file",
        permission: "allow-session",
      },
    ] as const;
    for (const command of commands) await runtime.dispatch(command);
    expect(runtime.controls.getState()).toMatchObject({
      showWelcomeOnLaunch: true,
      mcpEnabled: true,
      mcpPermissions: { write_file: "allow-session" },
    });
    expect(runtime.history.getState().slice(-3).every(({ undoable }) => undoable)).toBe(true);

    for (let index = 0; index < commands.length; index += 1) {
      await runtime.dispatch({ kind: "history-undo", origin: "user" });
    }
    expect(runtime.controls.getState()).toMatchObject({
      showWelcomeOnLaunch: false,
      mcpEnabled: false,
      mcpPermissions: { write_file: "deny" },
    });
    expect(savedWelcomePreferences).toEqual([true, false]);

    for (let index = 0; index < commands.length; index += 1) {
      await runtime.dispatch({ kind: "history-redo", origin: "user" });
    }
    expect(runtime.controls.getState()).toMatchObject({
      showWelcomeOnLaunch: true,
      mcpEnabled: true,
      mcpPermissions: { write_file: "allow-session" },
    });
    expect(savedWelcomePreferences).toEqual([true, false, true]);
  });

  it("retains preview quality when undoing parameter values written into source", async () => {
    vi.useFakeTimers();
    try {
      const nativeEngine = engine();
      const runtime = createWorkbenchRuntime(nativeEngine, {
        initialScratchSource: "width = 10; cube(width);",
        rendering: { defaultQuality: "full" },
      });
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value: 20 },
      });
      await runtime.dispatch({
        kind: "write-parameter-values",
        origin: "user",
        documentId: "document-main",
      });
      await runtime.dispatch({ kind: "history-undo", origin: "user" });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });

      await vi.advanceTimersByTimeAsync(800);

      expect(nativeEngine.render).toHaveBeenCalledOnce();
      expect(vi.mocked(nativeEngine.render).mock.calls[0]?.[0].quality).toBe("preview");
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the redo branch after a fresh mutation", async () => {
    const runtime = createWorkbenchRuntime(engine(), { rendering: { autoRender: false } });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "ai-panel",
      documentId: "document-main",
      source: "sphere(7);",
    });
    await runtime.dispatch({ kind: "history-redo", origin: "user" });

    expect(observable(runtime).source).toBe("sphere(7);");
    expect(runtime.history.getState().map(({ kind, origin }) => ({ kind, origin }))).toEqual([
      { kind: "edit-document", origin: "user" },
      { kind: "edit-document", origin: "ai-panel" },
    ]);
  });

  it("reverses the scripted settings, layout, viewer, and parameter UI-state families", async () => {
    const runtime = createWorkbenchRuntime(engine(), {
      initialScratchSource: "width = 10; cube(width);",
      rendering: { autoRender: false },
    });
    const snapshot = () => ({
      settings: runtime.settings.getState().profile,
      layout: runtime.layout.getState(),
      viewer: runtime.viewer.getState(),
      parameters: runtime.parameters.getState(),
    });
    const commands = [
      { kind: "set-theme", origin: "user", theme: "dark" },
      {
        kind: "update-layout",
        origin: "user",
        action: { kind: "toggle-panel", panel: "console" },
      },
      {
        kind: "update-viewer",
        origin: "user",
        action: { kind: "set-mode", documentId: "document-main", mode: "3d" },
      },
      {
        kind: "update-parameters",
        origin: "user",
        action: { kind: "save-set", documentId: "document-main", name: "baseline" },
      },
    ] as const;
    const states = [snapshot()];

    for (const [index, command] of commands.entries()) {
      await runtime.dispatch(command);
      states.push(snapshot());
      expect(runtime.history.getState()).toHaveLength(index + 1);
      expect(runtime.history.getState().at(-1)?.undoable).toBe(true);
    }
    const originalHistory = runtime.history.getState();

    for (let index = commands.length - 1; index >= 0; index -= 1) {
      await runtime.dispatch({ kind: "history-undo", origin: "user" });
      expect(snapshot()).toEqual(states[index]);
      expect(runtime.history.getState()).toEqual(originalHistory);
    }
    for (let index = 1; index <= commands.length; index += 1) {
      await runtime.dispatch({ kind: "history-redo", origin: "user" });
      expect(snapshot()).toEqual(states[index]);
      expect(runtime.history.getState()).toEqual(originalHistory);
    }
  });

  it("reverses document open, activation, movement, close, and reopen as one entry each", async () => {
    const runtime = createWorkbenchRuntime(engine(), { rendering: { autoRender: false } });
    const snapshot = () => ({
      documents: runtime.documents.getState(),
      parameters: runtime.parameters.getState(),
    });
    const commands = [
      {
        kind: "open-document",
        origin: "user",
        document: { id: "document-b", path: "b.scad", source: "sphere(2);" },
      },
      { kind: "activate-document", origin: "user", documentId: "document-main" },
      { kind: "move-document", origin: "user", documentId: "document-b", toIndex: 0 },
      { kind: "close-document", origin: "user", documentId: "document-b" },
      { kind: "reopen-document", origin: "user" },
    ] as const;
    const states = [snapshot()];

    for (const [index, command] of commands.entries()) {
      await runtime.dispatch(command);
      states.push(snapshot());
      expect(runtime.history.getState()).toHaveLength(index + 1);
      expect(runtime.history.getState().at(-1)?.undoable).toBe(true);
    }
    const originalHistory = runtime.history.getState();

    for (let index = commands.length - 1; index >= 0; index -= 1) {
      await runtime.dispatch({ kind: "history-undo", origin: "user" });
      expect(snapshot()).toEqual(states[index]);
    }
    for (let index = 1; index <= commands.length; index += 1) {
      await runtime.dispatch({ kind: "history-redo", origin: "user" });
      expect(snapshot()).toEqual(states[index]);
    }
    expect(runtime.history.getState()).toEqual(originalHistory);
  });

  it("compensates project create, rename, move, and delete operations during undo and redo", async () => {
    const files = new Map<string, ProjectFileContent>([
      ["main.scad", "cube(10);"],
      ["lib.scad", "module part() { sphere(2); }"],
    ]);
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage: memoryStorage(files),
      rendering: { autoRender: false },
    });
    const snapshot = () => ({
      files: [...files.entries()],
      project: runtime.project.getState(),
      documents: runtime.documents.getState(),
    });
    const commands = [
      { kind: "rename-project-file", origin: "user", path: "lib.scad", newName: "part.scad" },
      {
        kind: "move-project-file",
        origin: "user",
        path: "part.scad",
        destinationPath: "lib/part.scad",
      },
      { kind: "create-project-file", origin: "user", path: "extra.scad", source: "cube(3);" },
      { kind: "activate-document", origin: "user", documentId: "document-main" },
    ] as const;
    const states = [snapshot()];
    for (const command of commands) {
      await runtime.dispatch(command);
      states.push(snapshot());
    }
    const extraId = runtime.documents.getState().documents.find(({ path }) => path === "extra.scad")?.id;
    if (!extraId) throw new Error("Created document was not opened.");
    await runtime.dispatch({ kind: "close-document", origin: "user", documentId: extraId });
    states.push(snapshot());
    await runtime.dispatch({ kind: "delete-project-file", origin: "user", path: "extra.scad" });
    states.push(snapshot());
    expect(runtime.history.getState().every(({ undoable }) => undoable)).toBe(true);
    const originalHistory = runtime.history.getState();

    for (let index = states.length - 2; index >= 0; index -= 1) {
      await runtime.dispatch({ kind: "history-undo", origin: "user" });
      expect(snapshot()).toEqual(states[index]);
    }
    for (let index = 1; index < states.length; index += 1) {
      await runtime.dispatch({ kind: "history-redo", origin: "user" });
      expect(snapshot()).toEqual(states[index]);
    }
    expect(runtime.history.getState()).toEqual(originalHistory);
  });

  it("restores persisted annotation paths when a project-file rename is undone and redone", async () => {
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(10);"]]);
    let serialized: string | null = null;
    const persistence = {
      load: () => serialized,
      save: (value: string) => { serialized = value; },
    };
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage: memoryStorage(files),
      workspaceMetadataPersistence: persistence,
      rendering: { autoRender: false },
    });
    await runtime.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "add-annotation",
        documentId: "document-main",
        annotation: { id: "rename-note", point: [1, 2, 3], text: "Rename survives" },
      },
    });
    await runtime.dispatch({
      kind: "rename-project-file",
      origin: "user",
      path: "main.scad",
      newName: "renamed.scad",
    });

    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    const afterUndo = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      workspaceMetadataPersistence: persistence,
      rendering: { autoRender: false },
    });
    expect(viewerDocument(afterUndo.viewer.getState(), "document-main").annotations).toEqual([
      { id: "rename-note", point: [1, 2, 3], text: "Rename survives" },
    ]);

    await runtime.dispatch({ kind: "history-redo", origin: "user" });
    const afterRedo = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      initialScratchPath: "renamed.scad",
      initialScratchSource: "cube(10);",
      workspaceMetadataPersistence: persistence,
      rendering: { autoRender: false },
    });
    expect(viewerDocument(afterRedo.viewer.getState(), "document-main").annotations).toEqual([
      { id: "rename-note", point: [1, 2, 3], text: "Rename survives" },
    ]);
  });

  it("does not resurrect an async redo frame after a newer mutation branches history", async () => {
    let releaseUndo!: () => void;
    const undoSave = new Promise<void>((resolve) => { releaseUndo = resolve; });
    let saves = 0;
    const runtime = createWorkbenchRuntime(engine(), {
      rendering: { autoRender: false },
      settingsPersistence: {
        load: () => ({ kind: "missing" }),
        save: async () => {
          saves += 1;
          if (saves === 2) await undoSave;
        },
      },
    });
    await runtime.dispatch({ kind: "set-theme", origin: "user", theme: "dark" });

    const pendingUndo = runtime.dispatch({ kind: "history-undo", origin: "user" });
    await Promise.resolve();
    expect(runtime.settings.getState().theme).toBe("system");
    const pendingBranch = runtime.dispatch({
      kind: "update-layout",
      origin: "user",
      action: { kind: "toggle-panel", panel: "console" },
    });
    releaseUndo();
    await pendingUndo;
    await pendingBranch;
    await runtime.dispatch({ kind: "history-redo", origin: "user" });

    expect(runtime.settings.getState().theme).toBe("system");
    expect(runtime.layout.getState().consoleOpen).toBe(true);
  });

  it("serializes rapid async and sync undo operations in chronological order", async () => {
    let releaseThemeUndo!: () => void;
    const themeUndoSave = new Promise<void>((resolve) => { releaseThemeUndo = resolve; });
    let saves = 0;
    const runtime = createWorkbenchRuntime(engine(), {
      rendering: { autoRender: false },
      settingsPersistence: {
        load: () => ({ kind: "missing" }),
        save: async () => {
          saves += 1;
          if (saves === 2) await themeUndoSave;
        },
      },
    });
    await runtime.dispatch({
      kind: "update-layout",
      origin: "user",
      action: { kind: "toggle-panel", panel: "console" },
    });
    await runtime.dispatch({ kind: "set-theme", origin: "user", theme: "dark" });

    const firstUndo = runtime.dispatch({ kind: "history-undo", origin: "user" });
    await Promise.resolve();
    const secondUndo = runtime.dispatch({ kind: "history-undo", origin: "user" });
    releaseThemeUndo();
    await Promise.all([firstUndo, secondUndo]);
    expect(runtime.settings.getState().theme).toBe("system");
    expect(runtime.layout.getState().consoleOpen).toBe(false);

    await runtime.dispatch({ kind: "history-redo", origin: "user" });
    expect(runtime.layout.getState().consoleOpen).toBe(true);
    expect(runtime.settings.getState().theme).toBe("system");
    await runtime.dispatch({ kind: "history-redo", origin: "user" });
    expect(runtime.settings.getState().theme).toBe("dark");
  });

  it("queues a newer edit behind an async project-file undo", async () => {
    const files = new Map<string, ProjectFileContent>([
      ["main.scad", "cube(10);"],
      ["lib.scad", "module part() { sphere(2); }"],
    ]);
    let releaseUndoMove!: () => void;
    let signalUndoStarted!: () => void;
    const undoMove = new Promise<void>((resolve) => { releaseUndoMove = resolve; });
    const undoStarted = new Promise<void>((resolve) => { signalUndoStarted = resolve; });
    let moves = 0;
    const storage = memoryStorage(files);
    storage.move = async (_projectId, from, to) => {
      moves += 1;
      if (moves === 2) {
        signalUndoStarted();
        await undoMove;
      }
      const content = files.get(from);
      if (content === undefined) throw new Error(`Missing ${from}`);
      files.delete(from);
      files.set(to, content);
    };
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage: storage,
      rendering: { autoRender: false },
    });
    await runtime.dispatch({
      kind: "rename-project-file",
      origin: "user",
      path: "lib.scad",
      newName: "part.scad",
    });

    const pendingUndo = runtime.dispatch({ kind: "history-undo", origin: "user" });
    await undoStarted;
    const pendingEdit = runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "sphere(9);",
    });
    expect(runtime.documents.getState().documents[0]?.source).toBe("cube(10);");
    releaseUndoMove();
    await Promise.all([pendingUndo, pendingEdit]);

    expect([...files.keys()]).toEqual(["main.scad", "lib.scad"]);
    expect(runtime.documents.getState().documents[0]?.source).toBe("sphere(9);");
    await runtime.dispatch({ kind: "history-redo", origin: "user" });
    expect([...files.keys()]).toEqual(["main.scad", "lib.scad"]);
    expect(runtime.documents.getState().documents[0]?.source).toBe("sphere(9);");
  });

  it("orders a later edit above an earlier async project mutation without losing either state", async () => {
    const files = new Map<string, ProjectFileContent>([
      ["main.scad", "cube(10);"],
      ["lib.scad", "module part() { sphere(2); }"],
    ]);
    let releaseRename!: () => void;
    let signalRenameStarted!: () => void;
    const renameGate = new Promise<void>((resolve) => { releaseRename = resolve; });
    const renameStarted = new Promise<void>((resolve) => { signalRenameStarted = resolve; });
    const storage = memoryStorage(files);
    storage.move = async (_projectId, from, to) => {
      signalRenameStarted();
      await renameGate;
      const content = files.get(from);
      if (content === undefined) throw new Error(`Missing ${from}`);
      files.delete(from);
      files.set(to, content);
    };
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage: storage,
      rendering: { autoRender: false },
    });
    const rename = runtime.dispatch({
      kind: "rename-project-file",
      origin: "user",
      path: "lib.scad",
      newName: "part.scad",
    });
    await renameStarted;
    const edit = runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "sphere(9);",
    });
    expect(runtime.documents.getState().documents[0]?.source).toBe("cube(10);");
    releaseRename();
    await Promise.all([rename, edit]);
    expect(runtime.history.getState().map(({ kind }) => kind)).toEqual([
      "rename-project-file",
      "edit-document",
    ]);

    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    expect(runtime.documents.getState().documents[0]?.source).toBe("cube(10);");
    expect([...files.keys()]).toEqual(["main.scad", "part.scad"]);
    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    expect([...files.keys()]).toEqual(["main.scad", "lib.scad"]);
    expect(runtime.documents.getState().documents[0]?.source).toBe("cube(10);");

    await runtime.dispatch({ kind: "history-redo", origin: "user" });
    expect([...files.keys()]).toEqual(["main.scad", "part.scad"]);
    expect(runtime.documents.getState().documents[0]?.source).toBe("cube(10);");
    await runtime.dispatch({ kind: "history-redo", origin: "user" });
    expect(runtime.documents.getState().documents[0]?.source).toBe("sphere(9);");
  });

  it("publishes frames in dispatch order when an earlier optimistic setting save is slow", async () => {
    let releaseThemeSave!: () => void;
    const themeSave = new Promise<void>((resolve) => { releaseThemeSave = resolve; });
    const runtime = createWorkbenchRuntime(engine(), {
      rendering: { autoRender: false },
      settingsPersistence: {
        load: () => ({ kind: "missing" }),
        save: async () => { await themeSave; },
      },
    });
    const theme = runtime.dispatch({ kind: "set-theme", origin: "user", theme: "dark" });
    const edit = runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "sphere(9);",
    });
    expect(runtime.settings.getState().theme).toBe("dark");
    expect(runtime.documents.getState().documents[0]?.source).toBe("sphere(9);");
    expect(runtime.history.getState()).toEqual([]);
    releaseThemeSave();
    await Promise.all([theme, edit]);
    expect(runtime.history.getState().map(({ kind }) => kind)).toEqual([
      "set-theme",
      "edit-document",
    ]);

    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    expect(runtime.documents.getState().documents[0]?.source).toBe("cube(10);");
    expect(runtime.settings.getState().theme).toBe("dark");
    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    expect(runtime.settings.getState().theme).toBe("system");
  });

  it("reverses the persisted per-project disk-cache preference", async () => {
    const preferences = new Map<string, boolean>();
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", new Map([["main.scad", "cube(10);"]])),
      renderDiskCachePreferencePersistence: {
        load: (identity) => preferences.get(identity) ?? false,
        save: (identity, enabled) => { preferences.set(identity, enabled); },
      },
      renderDiskCacheStorage: {
        read: async () => undefined,
        write: async () => undefined,
        remove: async () => undefined,
        list: async () => [],
        clear: async () => undefined,
      },
    });
    await runtime.dispatch({
      kind: "set-project-disk-render-cache",
      origin: "user",
      enabled: true,
    });
    expect(runtime.history.getState().at(-1)?.undoable).toBe(true);

    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    expect(runtime.project.getState().diskRenderCacheEnabled).toBe(false);
    expect(preferences.get("project-a")).toBe(false);

    await runtime.dispatch({ kind: "history-redo", origin: "user" });
    expect(runtime.project.getState().diskRenderCacheEnabled).toBe(true);
    expect(preferences.get("project-a")).toBe(true);
  });

  it("undoes and redoes annotation persistence with the viewer frame", async () => {
    let serialized: string | null = null;
    const persistence = {
      load: () => serialized,
      save: (value: string) => { serialized = value; },
    };
    const options = {
      initialProject: createProjectSnapshot("project-a", new Map([["main.scad", "cube(10);"]])),
      workspaceMetadataPersistence: persistence,
      rendering: { autoRender: false },
    } as const;
    const runtime = createWorkbenchRuntime(engine(), options);
    await runtime.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "add-annotation",
        documentId: "document-main",
        annotation: { id: "note-a", point: [1, 2, 3], text: "Hole center" },
      },
    });

    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    const afterUndo = createWorkbenchRuntime(engine(), options);
    expect(viewerDocument(afterUndo.viewer.getState(), "document-main").annotations).toEqual([]);

    await runtime.dispatch({ kind: "history-redo", origin: "user" });
    const afterRedo = createWorkbenchRuntime(engine(), options);
    expect(viewerDocument(afterRedo.viewer.getState(), "document-main").annotations).toEqual([
      { id: "note-a", point: [1, 2, 3], text: "Hole center" },
    ]);
  });

  it("frames every user-owned parameter action variant", async () => {
    type Scenario = (runtime: ReturnType<typeof createWorkbenchRuntime>) => Promise<ParameterAction>;
    const setWidth = (runtime: ReturnType<typeof createWorkbenchRuntime>, value: number) =>
      runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value },
      });
    const saveBaseline = async (runtime: ReturnType<typeof createWorkbenchRuntime>) => {
      await setWidth(runtime, 20);
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "save-set", documentId: "document-main", name: "baseline" },
      });
    };
    const scenarios: readonly Scenario[] = [
      async (runtime) => {
        await setWidth(runtime, 20);
        return { kind: "reset-value", documentId: "document-main", name: "width" };
      },
      async (runtime) => {
        await runtime.dispatch({
          kind: "update-parameters",
          origin: "user",
          action: {
            kind: "set-values",
            documentId: "document-main",
            values: { width: 20, depth: 8 },
          },
        });
        return { kind: "reset-all", documentId: "document-main" };
      },
      async (runtime) => {
        await setWidth(runtime, 20);
        return { kind: "save-set", documentId: "document-main", name: "baseline" };
      },
      async (runtime) => {
        await saveBaseline(runtime);
        await setWidth(runtime, 30);
        return { kind: "apply-set", documentId: "document-main", name: "baseline" };
      },
      async (runtime) => {
        await saveBaseline(runtime);
        return {
          kind: "rename-set",
          documentId: "document-main",
          from: "baseline",
          to: "production",
        };
      },
      async (runtime) => {
        await saveBaseline(runtime);
        return { kind: "delete-set", documentId: "document-main", name: "baseline" };
      },
      async () => ({
        kind: "replace-sets",
        documentId: "document-main",
        sets: [{ name: "imported", values: { width: 18, depth: 7 } }],
      }),
      async (runtime) => {
        await setWidth(runtime, 20);
        return { kind: "clear-overrides", documentId: "document-main" };
      },
    ];

    for (const prepare of scenarios) {
      const runtime = createWorkbenchRuntime(engine(), {
        initialScratchSource: "width = 10; depth = 5; cube([width, depth, 1]);",
        rendering: { autoRender: false },
      });
      const action = await prepare(runtime);
      const before = runtime.parameters.getState();
      const historyBefore = runtime.history.getState().length;
      await runtime.dispatch({ kind: "update-parameters", origin: "user", action });
      const after = runtime.parameters.getState();
      expect(runtime.history.getState()).toHaveLength(historyBefore + 1);
      expect(runtime.history.getState().at(-1)?.undoable).toBe(true);

      await runtime.dispatch({ kind: "history-undo", origin: "user" });
      expect(runtime.parameters.getState()).toEqual(before);
      await runtime.dispatch({ kind: "history-redo", origin: "user" });
      expect(runtime.parameters.getState()).toEqual(after);
    }
  });
});
