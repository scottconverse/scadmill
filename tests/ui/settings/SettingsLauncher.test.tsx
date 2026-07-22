// @vitest-environment happy-dom
import { createRef } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import {
  createDefaultPersistedSettings,
  parsePersistedSettings,
  serializePersistedSettings,
} from "../../../src/application/settings/settings-codec";
import { EPHEMERAL_SECRET_STORE } from "../../../src/application/settings/secret-store";
import type { SecretStore } from "../../../src/application/settings/secret-store";
import { messages } from "../../../src/messages/en";
import { SettingsLauncher, type SettingsLauncherHandle } from "../../../src/ui/settings/SettingsLauncher";

const engine: EngineService = {
  render: vi.fn(),
  export: vi.fn(),
  version: vi.fn(),
  cancel: vi.fn(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, reject, resolve };
}

describe("SettingsLauncher", () => {
  it("opens at the requested AI section and restores focus to the invoking control", async () => {
    const runtime = createWorkbenchRuntime(engine);
    const launcherRef = createRef<SettingsLauncherHandle>();
    const view = render(
      <main className="workbench">
        <button
          onClick={(event) => launcherRef.current?.open("ai", event.currentTarget)}
          type="button"
        >Configure AI</button>
        <SettingsLauncher
          engineLabel="OpenSCAD 2026.06.12"
          ref={launcherRef}
          runtime={runtime}
          secretStore={EPHEMERAL_SECRET_STORE}
        />
      </main>,
    );
    const invokingControl = view.getByRole("button", { name: "Configure AI" });

    invokingControl.focus();
    fireEvent.click(invokingControl);

    expect(view.getByRole("dialog", { name: messages.settingsTitle })).toBeVisible();
    await waitFor(() => expect(view.getByLabelText(messages.aiProvider)).toHaveFocus());
    fireEvent.click(view.getByRole("button", { name: messages.closeSettings }));
    await waitFor(() => expect(invokingControl).toHaveFocus());
  });

  it("keeps the dialog open until the latest AI endpoint is durably persisted", async () => {
    const pendingSave = deferred<void>();
    const save = vi.fn((_serializedSettings: string) => pendingSave.promise);
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: { load: () => ({ kind: "missing" }), save },
    });
    const view = render(
      <SettingsLauncher engineLabel="OpenSCAD 2026.06.12" runtime={runtime} secretStore={EPHEMERAL_SECRET_STORE} />,
    );
    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    fireEvent.change(view.getByLabelText(messages.aiEndpoint), { target: { value: "https://configured.example/v1/chat/completions" } });

    const close = view.getByRole("button", { name: messages.closeSettings });
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(close).toBeDisabled();
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    expect(view.getByRole("dialog")).toBeVisible();

    pendingSave.resolve(undefined);
    await waitFor(() => expect(close).toBeEnabled());
    expect(parsePersistedSettings(save.mock.calls[0]?.[0] ?? "").ai.endpoint).toBe("https://configured.example/v1/chat/completions");
    fireEvent.click(close);
    expect(view.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("portals the modal outside the inert workbench and restores focus on close", async () => {
    const runtime = createWorkbenchRuntime(engine);
    const view = render(
      <main className="workbench">
        <SettingsLauncher
          engineLabel="OpenSCAD 2026.06.12"
          runtime={runtime}
          secretStore={EPHEMERAL_SECRET_STORE}
        />
      </main>,
    );
    const workbench = view.container.querySelector<HTMLElement>(".workbench");
    if (!workbench) throw new Error("Workbench fixture did not render.");
    const launcher = view.getByRole("button", { name: messages.openSettings });

    launcher.focus();
    fireEvent.click(launcher);

    const dialog = view.getByRole("dialog", { name: messages.settingsTitle });
    await waitFor(() => expect(workbench.inert).toBe(true));
    expect(workbench.contains(dialog)).toBe(false);
    expect(dialog.closest(".settings-modal-layer")?.parentElement).toBe(document.body);

    fireEvent.click(view.getByRole("button", { name: messages.closeSettings }));
    await waitFor(() => expect(workbench.inert).toBe(false));
    await waitFor(() => expect(launcher).toHaveFocus());
  });

  it("shows a malformed durable-settings error before the user attempts an edit", () => {
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({ kind: "loaded", serializedSettings: "{malformed" }),
        save: vi.fn(),
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={EPHEMERAL_SECRET_STORE}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    expect(view.getByRole("alert")).toHaveTextContent(messages.settingsLoadFailed);
  });

  it("blocks AI persistence side effects when durable settings were not loaded safely", async () => {
    const settingsSave = vi.fn();
    const secretLoad = vi.fn().mockResolvedValue("existing-key");
    const secretSave = vi.fn().mockResolvedValue(undefined);
    const secretClear = vi.fn().mockResolvedValue(undefined);
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({ kind: "loaded", serializedSettings: "{malformed" }),
        save: settingsSave,
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: secretLoad,
          save: secretSave,
          clear: secretClear,
        }}
      />,
    );
    const before = runtime.settings.getState();

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    await act(async () => { await Promise.resolve(); });
    const secretInput = view.getByLabelText(messages.aiApiKey);
    const saveSecret = view.getByRole("button", { name: messages.saveAiKey });
    const clearSecret = view.getByRole("button", { name: messages.clearAiKey });
    const persistenceToggle = view.getByLabelText(messages.persistWebSecret);
    const restoreAi = view.getByRole("button", { name: messages.restoreSectionDefaults("ai") });
    expect(secretInput).toBeDisabled();
    expect(saveSecret).toBeDisabled();
    expect(clearSecret).toBeDisabled();
    expect(persistenceToggle).toBeDisabled();
    expect(restoreAi).toBeDisabled();
    fireEvent.change(secretInput, { target: { value: "replacement-key" } });
    fireEvent.click(saveSecret);
    fireEvent.click(clearSecret);
    fireEvent.click(persistenceToggle);
    fireEvent.click(restoreAi);
    await Promise.resolve();
    await Promise.resolve();

    expect(secretLoad).not.toHaveBeenCalled();
    expect(secretSave).not.toHaveBeenCalled();
    expect(secretClear).not.toHaveBeenCalled();
    expect(settingsSave).not.toHaveBeenCalled();
    expect(runtime.settings.getState()).toEqual(before);
    expect(runtime.history.getState()).toEqual([]);
  });

  it("shows a durable-write failure after the optimistic setting rolls back", async () => {
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({ kind: "missing" }),
        save: () => Promise.reject(new Error("disk full")),
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={EPHEMERAL_SECRET_STORE}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    fireEvent.change(view.getByLabelText(messages.editorFontSize), { target: { value: "18" } });

    expect(await view.findByText(messages.settingsSaveFailed)).toHaveAttribute("role", "alert");
    await waitFor(() => expect(view.getByLabelText(messages.editorFontSize)).toHaveValue(14));
    expect(runtime.settings.getState().profile.editor.fontSize).toBe(14);
  });

  it("moves a web secret back to session storage when the opt-in setting cannot persist", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn().mockResolvedValue("sentinel-session-key"),
      save,
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({ kind: "missing" }),
        save: () => Promise.reject(new Error("disk full")),
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={secretStore}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    await view.findByDisplayValue("sentinel-session-key");
    fireEvent.click(view.getByLabelText(messages.persistWebSecret));

    await waitFor(() => expect(save).toHaveBeenNthCalledWith(1, "sentinel-session-key", true));
    await waitFor(() => expect(save).toHaveBeenNthCalledWith(2, "sentinel-session-key", false));
    expect(await view.findByText(messages.settingsSaveFailed)).toHaveAttribute("role", "alert");
    expect(view.queryByText(messages.aiKeyStorageFailed)).not.toBeInTheDocument();
    expect(runtime.settings.getState().profile.ai.persistWebSecret).toBe(false);
  });

  it("moves the last durable web secret without persisting an unsaved draft", async () => {
    const secretSave = vi.fn().mockResolvedValue(undefined);
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({ kind: "missing" }),
        save: vi.fn().mockResolvedValue(undefined),
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: vi.fn().mockResolvedValue("old-key"),
          save: secretSave,
          clear: vi.fn().mockResolvedValue(undefined),
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    const secretInput = await view.findByDisplayValue("old-key");
    fireEvent.change(secretInput, { target: { value: "new-draft" } });
    fireEvent.click(view.getByLabelText(messages.persistWebSecret));

    await waitFor(() => expect(runtime.settings.getState().profile.ai.persistWebSecret).toBe(true));
    expect(secretSave).toHaveBeenCalledWith("old-key", true);
    expect(secretSave).not.toHaveBeenCalledWith("new-draft", true);
    expect(secretInput).toHaveValue("new-draft");
    expect(await view.findByText(messages.aiKeyStorageChanged)).toHaveAttribute("role", "status");
    expect(view.queryByText(messages.aiKeySaved)).not.toBeInTheDocument();
  });

  it("moves the most recently saved web secret without persisting a newer draft", async () => {
    const secretSave = vi.fn().mockResolvedValue(undefined);
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({ kind: "missing" }),
        save: vi.fn().mockResolvedValue(undefined),
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: vi.fn().mockResolvedValue("old-key"),
          save: secretSave,
          clear: vi.fn().mockResolvedValue(undefined),
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    const secretInput = await view.findByDisplayValue("old-key");
    fireEvent.change(secretInput, { target: { value: "saved-key" } });
    fireEvent.click(view.getByRole("button", { name: messages.saveAiKey }));
    await view.findByText(messages.aiKeySaved);
    fireEvent.change(secretInput, { target: { value: "newer-draft" } });
    fireEvent.click(view.getByLabelText(messages.persistWebSecret));

    await waitFor(() => expect(runtime.settings.getState().profile.ai.persistWebSecret).toBe(true));
    expect(secretSave).toHaveBeenNthCalledWith(1, "saved-key", false);
    expect(secretSave).toHaveBeenNthCalledWith(2, "saved-key", true);
    expect(secretSave).not.toHaveBeenCalledWith("newer-draft", true);
    expect(secretInput).toHaveValue("newer-draft");
    expect(await view.findByText(messages.aiKeyStorageChanged)).toHaveAttribute("role", "status");
    expect(view.queryByText(messages.aiKeySaved)).not.toBeInTheDocument();
  });

  it("preserves a concurrent settings edit while browser-secret persistence is pending", async () => {
    const secretMove = deferred<void>();
    const secretSave = vi.fn()
      .mockImplementationOnce(() => secretMove.promise)
      .mockResolvedValue(undefined);
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({ kind: "missing" }),
        save: vi.fn().mockResolvedValue(undefined),
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: vi.fn().mockResolvedValue("existing-key"),
          save: secretSave,
          clear: vi.fn().mockResolvedValue(undefined),
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    await view.findByDisplayValue("existing-key");
    fireEvent.click(view.getByLabelText(messages.persistWebSecret));
    await waitFor(() => expect(secretSave).toHaveBeenCalledWith("existing-key", true));

    fireEvent.change(view.getByLabelText(messages.editorFontSize), { target: { value: "18" } });
    await waitFor(() => expect(runtime.settings.getState().profile.editor.fontSize).toBe(18));
    secretMove.resolve(undefined);

    await waitFor(() => expect(runtime.settings.getState().profile.ai.persistWebSecret).toBe(true));
    expect(runtime.settings.getState().profile.editor.fontSize).toBe(18);
  });

  it("rolls back browser persistence without losing an edit queued behind a failed settings write", async () => {
    const failedSettingsWrite = deferred<void>();
    const settingsSave = vi.fn()
      .mockImplementationOnce(() => failedSettingsWrite.promise)
      .mockResolvedValue(undefined);
    const secretSave = vi.fn().mockResolvedValue(undefined);
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({ kind: "missing" }),
        save: settingsSave,
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: vi.fn().mockResolvedValue("existing-key"),
          save: secretSave,
          clear: vi.fn().mockResolvedValue(undefined),
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    await view.findByDisplayValue("existing-key");
    fireEvent.click(view.getByLabelText(messages.persistWebSecret));
    await waitFor(() => expect(settingsSave).toHaveBeenCalledTimes(1));
    expect(runtime.settings.getState().profile.ai.persistWebSecret).toBe(true);

    fireEvent.change(view.getByLabelText(messages.editorFontSize), { target: { value: "18" } });
    await waitFor(() => expect(runtime.settings.getState().profile.editor.fontSize).toBe(18));
    failedSettingsWrite.reject(new Error("disk full"));

    expect(await view.findByText(messages.settingsSaveFailed)).toHaveAttribute("role", "alert");
    await waitFor(() => expect(settingsSave).toHaveBeenCalledTimes(3));
    expect(runtime.settings.getState().profile.editor.fontSize).toBe(18);
    expect(runtime.settings.getState().profile.ai.persistWebSecret).toBe(false);
    expect(parsePersistedSettings(settingsSave.mock.calls.at(-1)?.[0] as string).ai.persistWebSecret)
      .toBe(false);
    expect(secretSave).toHaveBeenNthCalledWith(1, "existing-key", true);
    expect(secretSave).toHaveBeenNthCalledWith(2, "existing-key", false);
    expect(view.queryByText(messages.aiKeyStorageFailed)).not.toBeInTheDocument();
  });

  it("does not clear the AI key when restoring defaults cannot persist", async () => {
    const settings = createDefaultPersistedSettings();
    const configured = {
      ...settings,
      ai: { ...settings.ai, provider: "openai" as const, model: "gpt-test" },
    };
    const settingsSave = vi.fn().mockRejectedValue(new Error("disk full"));
    const secretClear = vi.fn().mockResolvedValue(undefined);
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({
          kind: "loaded",
          serializedSettings: serializePersistedSettings(configured),
        }),
        save: settingsSave,
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: vi.fn().mockResolvedValue("existing-key"),
          save: vi.fn().mockResolvedValue(undefined),
          clear: secretClear,
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    await view.findByDisplayValue("existing-key");
    fireEvent.click(view.getByRole("button", { name: messages.restoreSectionDefaults("ai") }));

    expect(await view.findByText(messages.settingsSaveFailed)).toHaveAttribute("role", "alert");
    expect(view.queryByText(messages.aiKeyStorageFailed)).not.toBeInTheDocument();
    expect(secretClear).not.toHaveBeenCalled();
    expect(runtime.settings.getState().profile.ai).toEqual(configured.ai);
  });

  it("rolls back AI defaults without losing an edit queued behind a failed restore write", async () => {
    const settings = createDefaultPersistedSettings();
    const configured = {
      ...settings,
      ai: {
        ...settings.ai,
        provider: "openai" as const,
        model: "gpt-test",
        persistWebSecret: true,
      },
    };
    const failedSettingsWrite = deferred<void>();
    const settingsSave = vi.fn()
      .mockImplementationOnce(() => failedSettingsWrite.promise)
      .mockResolvedValue(undefined);
    const secretSave = vi.fn().mockResolvedValue(undefined);
    const secretClear = vi.fn().mockResolvedValue(undefined);
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({
          kind: "loaded",
          serializedSettings: serializePersistedSettings(configured),
        }),
        save: settingsSave,
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: vi.fn().mockResolvedValue("existing-key"),
          save: secretSave,
          clear: secretClear,
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    await view.findByDisplayValue("existing-key");
    fireEvent.click(view.getByRole("button", { name: messages.restoreSectionDefaults("ai") }));
    await waitFor(() => expect(settingsSave).toHaveBeenCalledTimes(1));
    expect(runtime.settings.getState().profile.ai.provider).toBe("none");

    fireEvent.change(view.getByLabelText(messages.editorFontSize), { target: { value: "18" } });
    await waitFor(() => expect(runtime.settings.getState().profile.editor.fontSize).toBe(18));
    failedSettingsWrite.reject(new Error("disk full"));

    expect(await view.findByText(messages.settingsSaveFailed)).toHaveAttribute("role", "alert");
    await waitFor(() => expect(settingsSave).toHaveBeenCalledTimes(3));
    expect(runtime.settings.getState().profile.editor.fontSize).toBe(18);
    expect(runtime.settings.getState().profile.ai).toEqual(configured.ai);
    expect(parsePersistedSettings(settingsSave.mock.calls.at(-1)?.[0] as string).ai)
      .toEqual(configured.ai);
    expect(secretClear).not.toHaveBeenCalled();
    expect(secretSave).not.toHaveBeenCalled();
    expect(view.queryByText(messages.aiKeyStorageFailed)).not.toBeInTheDocument();
  });

  it("restores the prior AI settings and secret when clearing the key fails after commit", async () => {
    const settings = createDefaultPersistedSettings();
    const configured = {
      ...settings,
      ai: {
        ...settings.ai,
        provider: "openai" as const,
        model: "gpt-test",
        persistWebSecret: true,
      },
    };
    const settingsSave = vi.fn().mockResolvedValue(undefined);
    const secretSave = vi.fn().mockResolvedValue(undefined);
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({
          kind: "loaded",
          serializedSettings: serializePersistedSettings(configured),
        }),
        save: settingsSave,
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: vi.fn().mockResolvedValue("existing-key"),
          save: secretSave,
          clear: vi.fn().mockRejectedValue(new Error("keychain unavailable")),
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    const secretInput = await view.findByDisplayValue("existing-key");
    fireEvent.click(view.getByRole("button", { name: messages.restoreSectionDefaults("ai") }));

    expect(await view.findByText(messages.aiKeyStorageFailed)).toHaveAttribute("role", "alert");
    await waitFor(() => expect(runtime.settings.getState().profile.ai).toEqual(configured.ai));
    expect(secretSave).toHaveBeenCalledWith("existing-key", true);
    expect(secretInput).toHaveValue("existing-key");
    expect(settingsSave).toHaveBeenCalledTimes(2);
  });

  it("restores the last durable AI key instead of an unsaved draft when clearing fails", async () => {
    const settings = createDefaultPersistedSettings();
    const configured = {
      ...settings,
      ai: {
        ...settings.ai,
        provider: "openai" as const,
        model: "gpt-test",
        persistWebSecret: true,
      },
    };
    const secretSave = vi.fn().mockResolvedValue(undefined);
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({
          kind: "loaded",
          serializedSettings: serializePersistedSettings(configured),
        }),
        save: vi.fn().mockResolvedValue(undefined),
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: vi.fn().mockResolvedValue("old-key"),
          save: secretSave,
          clear: vi.fn().mockRejectedValue(new Error("keychain unavailable")),
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    const secretInput = await view.findByDisplayValue("old-key");
    fireEvent.change(secretInput, { target: { value: "new-draft" } });
    fireEvent.click(view.getByRole("button", { name: messages.restoreSectionDefaults("ai") }));

    expect(await view.findByText(messages.aiKeyStorageFailed)).toHaveAttribute("role", "alert");
    await waitFor(() => expect(runtime.settings.getState().profile.ai).toEqual(configured.ai));
    expect(secretSave).toHaveBeenCalledWith("old-key", true);
    expect(secretSave).not.toHaveBeenCalledWith("new-draft", true);
  });

  it("preserves concurrent editor and AI edits when restore recovery rolls back", async () => {
    const settings = createDefaultPersistedSettings();
    const configured = {
      ...settings,
      ai: {
        ...settings.ai,
        provider: "openai" as const,
        model: "original-model",
        persistWebSecret: true,
      },
    };
    const clear = deferred<void>();
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({
          kind: "loaded",
          serializedSettings: serializePersistedSettings(configured),
        }),
        save: vi.fn().mockResolvedValue(undefined),
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: vi.fn().mockResolvedValue("existing-key"),
          save: vi.fn().mockResolvedValue(undefined),
          clear: vi.fn(() => clear.promise),
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    await view.findByDisplayValue("existing-key");
    fireEvent.click(view.getByRole("button", { name: messages.restoreSectionDefaults("ai") }));
    await waitFor(() => expect(runtime.settings.getState().profile.ai.provider).toBe("none"));

    fireEvent.change(view.getByLabelText(messages.editorFontSize), { target: { value: "18" } });
    fireEvent.change(view.getByLabelText(messages.aiModel), { target: { value: "concurrent-model" } });
    await waitFor(() => expect(runtime.settings.getState().profile.ai.model).toBe("concurrent-model"));
    clear.reject(new Error("keychain unavailable"));

    expect(await view.findByText(messages.aiKeyStorageFailed)).toHaveAttribute("role", "alert");
    await waitFor(() => expect(runtime.settings.getState().profile.ai.provider).toBe("openai"));
    expect(runtime.settings.getState().profile.editor.fontSize).toBe(18);
    expect(runtime.settings.getState().profile.ai).toEqual({
      ...configured.ai,
      model: "concurrent-model",
    });
  });

  it("reports a partial mutation when secret migration rollback also fails", async () => {
    const secretSave = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("rollback unavailable"));
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({ kind: "missing" }),
        save: vi.fn().mockRejectedValue(new Error("disk full")),
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: vi.fn().mockResolvedValue("existing-key"),
          save: secretSave,
          clear: vi.fn().mockResolvedValue(undefined),
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    await view.findByDisplayValue("existing-key");
    fireEvent.click(view.getByLabelText(messages.persistWebSecret));

    expect(await view.findByText(/could not be rolled back completely/iu)).toHaveAttribute(
      "role",
      "alert",
    );
    expect(view.getByText(messages.settingsSaveFailed)).toHaveAttribute("role", "alert");
    expect(view.queryByText(messages.aiKeyStorageFailed)).not.toBeInTheDocument();
  });

  it("reports a partial restore when the secret cannot be recovered after clear fails", async () => {
    const settings = createDefaultPersistedSettings();
    const configured = {
      ...settings,
      ai: { ...settings.ai, provider: "openai" as const, persistWebSecret: true },
    };
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => ({
          kind: "loaded",
          serializedSettings: serializePersistedSettings(configured),
        }),
        save: vi.fn().mockResolvedValue(undefined),
      },
    });
    const view = render(
      <SettingsLauncher
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        secretStore={{
          persistence: "web-session",
          load: vi.fn().mockResolvedValue("existing-key"),
          save: vi.fn().mockRejectedValue(new Error("secret rollback failed")),
          clear: vi.fn().mockRejectedValue(new Error("clear failed")),
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    await view.findByDisplayValue("existing-key");
    fireEvent.click(view.getByRole("button", { name: messages.restoreSectionDefaults("ai") }));

    expect(await view.findByText(messages.aiSecretRollbackFailed)).toHaveAttribute("role", "alert");
    await waitFor(() => expect(runtime.settings.getState().profile.ai).toEqual(configured.ai));
    expect(view.queryByText(messages.aiKeyStorageFailed)).not.toBeInTheDocument();
  });
});
