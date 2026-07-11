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
  it("shows a durable-write failure after the optimistic setting rolls back", async () => {
    const runtime = createWorkbenchRuntime(engine, {
      settingsPersistence: {
        load: () => null,
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
        load: () => null,
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
