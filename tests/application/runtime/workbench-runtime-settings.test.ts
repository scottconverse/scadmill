import { describe, expect, it, vi } from "vitest";
import type { EngineService } from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import type { SettingsPersistence } from "../../../src/application/settings/settings-persistence";
import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";
import { customThemePreference } from "../../../src/application/theme/theme-registry";

const engine: EngineService = {
  render: vi.fn(),
  export: vi.fn(),
  version: vi.fn(),
  cancel: vi.fn(),
};

function memoryPersistence(): SettingsPersistence & { value: string | null } {
  return {
    value: null,
    load() {
      return this.value === null
        ? { kind: "missing" as const }
        : { kind: "loaded" as const, serializedSettings: this.value };
    },
    save(value) { this.value = value; },
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("runtime settings persistence", () => {
  it("keeps malformed durable settings visible and blocks every persisted mutation", async () => {
    const save = vi.fn();
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({ kind: "loaded", serializedSettings: "{malformed" }),
        save,
      },
    });
    const before = runtime.settings.getState();

    expect(before.persistenceStatus).toEqual({
      status: "load-error",
      reason: "invalid-data",
    });
    await expect(runtime.dispatch({
      kind: "replace-settings",
      origin: "user",
      settings: {
        ...before.profile,
        editor: { ...before.profile.editor, fontSize: 18 },
      },
    })).rejects.toThrow("not loaded safely");
    await expect(runtime.dispatch({
      kind: "restore-settings-section",
      origin: "user",
      section: "editor",
    })).rejects.toThrow("not loaded safely");
    await expect(runtime.dispatch({
      kind: "set-theme",
      origin: "user",
      theme: "high-contrast",
    })).rejects.toThrow("not loaded safely");
    await expect(runtime.dispatch({
      kind: "set-auto-render",
      origin: "user",
      enabled: !before.autoRender,
    })).rejects.toThrow("not loaded safely");

    expect(runtime.settings.getState()).toEqual(before);
    expect(runtime.history.getState()).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it("writes each accepted settings profile exactly once", async () => {
    const save = vi.fn();
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: { load: () => ({ kind: "missing" }), save },
    });

    await runtime.dispatch({
      kind: "replace-settings",
      origin: "user",
      settings: {
        ...runtime.settings.getState().profile,
        editor: { ...runtime.settings.getState().profile.editor, fontSize: 18 },
      },
    });

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("applies a complete profile immediately and reloads it in a fresh runtime", async () => {
    const persistence = memoryPersistence();
    const first = createWorkbenchRuntime(engine, { settingsPersistence: persistence });
    const profile = first.settings.getState().profile;
    const changed = {
      ...profile,
      editor: { ...profile.editor, fontSize: 19 },
      rendering: { ...profile.rendering, autoRender: false },
      privacy: { updateChecks: false },
    };
    await first.dispatch({ kind: "replace-settings", origin: "user", settings: changed });

    expect(first.settings.getState()).toMatchObject({
      editor: { fontSize: 19 },
      autoRender: false,
      profile: { privacy: { updateChecks: false } },
    });
    const restarted = createWorkbenchRuntime(engine, { settingsPersistence: persistence });
    expect(restarted.settings.getState().profile).toEqual(changed);
  });

  it("restores only the requested section and persists the result", async () => {
    const persistence = memoryPersistence();
    const runtime = createWorkbenchRuntime(engine, { settingsPersistence: persistence });
    const profile = runtime.settings.getState().profile;
    await runtime.dispatch({
      kind: "replace-settings",
      origin: "user",
      settings: { ...profile, editor: { ...profile.editor, fontSize: 20 }, privacy: { updateChecks: false } },
    });
    await runtime.dispatch({ kind: "restore-settings-section", origin: "user", section: "editor" });

    expect(runtime.settings.getState().editor.fontSize).toBe(14);
    expect(runtime.settings.getState().profile.privacy.updateChecks).toBe(false);
    expect(persistence.value).toContain('"fontSize": 14');
  });

  it("preserves imported custom themes when changing the selected theme", async () => {
    const persistence = memoryPersistence();
    const runtime = createWorkbenchRuntime(engine, { settingsPersistence: persistence });
    const customTheme = {
      ...SHIPPED_THEMES[0],
      meta: { ...SHIPPED_THEMES[0].meta, name: "Workshop blue" },
    };
    await runtime.dispatch({
      kind: "replace-settings",
      origin: "user",
      settings: {
        ...runtime.settings.getState().profile,
        theme: {
          preference: customThemePreference(customTheme.meta.name),
          customThemes: [customTheme],
        },
      },
    });

    await expect(runtime.dispatch({
      kind: "set-theme",
      origin: "user",
      theme: "dark",
    })).resolves.toBeUndefined();

    expect(runtime.settings.getState().profile.theme).toEqual({
      preference: "dark",
      customThemes: [customTheme],
    });
  });

  it("rejects an invalid replacement before changing memory, persistence, or history", async () => {
    const persistence = memoryPersistence();
    const runtime = createWorkbenchRuntime(engine, { settingsPersistence: persistence });
    const before = runtime.settings.getState();
    const invalid = {
      ...before.profile,
      editor: { ...before.profile.editor, fontSize: 999 },
    } as typeof before.profile;

    await expect(runtime.dispatch({
      kind: "replace-settings",
      origin: "user",
      settings: invalid,
    })).rejects.toThrow("exact version-1 schema");

    expect(runtime.settings.getState()).toEqual(before);
    expect(runtime.history.getState()).toEqual([]);
    expect(persistence.value).toBeNull();
  });

  it("rolls back an immediately applied profile when durable persistence rejects", async () => {
    const persistence: SettingsPersistence = {
      load: () => ({ kind: "missing" }),
      save: async () => {
        throw new Error("disk full");
      },
    };
    const runtime = createWorkbenchRuntime(engine, { settingsPersistence: persistence });
    const before = runtime.settings.getState();
    const changed = {
      ...before.profile,
      editor: { ...before.profile.editor, fontSize: 19 },
    };

    await expect(runtime.dispatch({
      kind: "replace-settings",
      origin: "user",
      settings: changed,
    })).rejects.toThrow("disk full");

    expect(runtime.settings.getState()).toEqual(before);
    expect(runtime.history.getState()).toEqual([]);
  });

  it("rolls back to the durable profile when two overlapping replacements both reject", async () => {
    const firstWrite = deferred();
    const secondWrite = deferred();
    const writes = [firstWrite, secondWrite];
    const persistence: SettingsPersistence = {
      load: () => ({ kind: "missing" }),
      save: () => writes.shift()?.promise ?? Promise.resolve(),
    };
    const runtime = createWorkbenchRuntime(engine, { settingsPersistence: persistence });
    const before = runtime.settings.getState();
    const first = runtime.dispatch({
      kind: "replace-settings",
      origin: "user",
      settings: {
        ...before.profile,
        editor: { ...before.profile.editor, fontSize: 18 },
      },
    });
    const second = runtime.dispatch({
      kind: "replace-settings",
      origin: "user",
      settings: {
        ...before.profile,
        editor: { ...before.profile.editor, fontSize: 19 },
      },
    });
    const firstResult = expect(first).rejects.toThrow("first write failed");
    const secondResult = expect(second).rejects.toThrow("second write failed");

    firstWrite.reject(new Error("first write failed"));
    await firstResult;
    secondWrite.reject(new Error("second write failed"));
    await secondResult;

    expect(runtime.settings.getState()).toEqual(before);
    expect(runtime.history.getState()).toEqual([]);
  });

  it("does not complete a settings command before desktop persistence finishes", async () => {
    const write = deferred();
    const persistence: SettingsPersistence = {
      load: () => ({ kind: "missing" }),
      save: () => write.promise,
    };
    const runtime = createWorkbenchRuntime(engine, { settingsPersistence: persistence });
    const changed = {
      ...runtime.settings.getState().profile,
      editor: { ...runtime.settings.getState().profile.editor, fontSize: 19 },
    };
    const command = runtime.dispatch({
      kind: "replace-settings",
      origin: "user",
      settings: changed,
    });
    let completed = false;
    void command.then(() => { completed = true; });
    await Promise.resolve();

    expect(completed).toBe(false);
    expect(runtime.settings.getState().editor.fontSize).toBe(19);
    write.resolve();
    await command;
    expect(completed).toBe(true);
  });
});
