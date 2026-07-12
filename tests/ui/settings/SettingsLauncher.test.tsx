// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { EPHEMERAL_SECRET_STORE } from "../../../src/application/settings/secret-store";
import type { SecretStore } from "../../../src/application/settings/secret-store";
import { messages } from "../../../src/messages/en";
import { SettingsLauncher } from "../../../src/ui/settings/SettingsLauncher";

const engine: EngineService = {
  render: vi.fn(),
  export: vi.fn(),
  version: vi.fn(),
  cancel: vi.fn(),
};

describe("SettingsLauncher", () => {
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
          load: vi.fn().mockResolvedValue("existing-key"),
          save: secretSave,
          clear: secretClear,
        }}
      />,
    );
    const before = runtime.settings.getState();

    fireEvent.click(view.getByRole("button", { name: messages.openSettings }));
    await view.findByDisplayValue("existing-key");
    const persistenceToggle = view.getByLabelText(messages.persistWebSecret);
    const restoreAi = view.getByRole("button", { name: messages.restoreSectionDefaults("ai") });
    expect(persistenceToggle).toBeDisabled();
    expect(restoreAi).toBeDisabled();
    fireEvent.click(persistenceToggle);
    fireEvent.click(restoreAi);
    await Promise.resolve();
    await Promise.resolve();

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
    expect(runtime.settings.getState().profile.ai.persistWebSecret).toBe(false);
  });
});
