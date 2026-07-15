// @vitest-environment happy-dom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";
import { messages } from "../../../src/messages/en";
import { Workbench } from "../../../src/ui/Workbench";

it("locks settings-owned controls outside the dialog after durable settings fail to load", () => {
  const settingsSave = vi.fn();
  const onConfigureEnginePath = vi.fn();
  const onThemePreferenceChange = vi.fn();
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine, {
    settingsPersistence: {
      load: () => ({ kind: "loaded", serializedSettings: "{malformed" }),
      save: settingsSave,
    },
  });
  const view = render(
    <Workbench
      activeTheme={SHIPPED_THEMES[0]}
      configuredEnginePath="C:/broken/openscad.exe"
      engineAvailable={false}
      engineLabel="OpenSCAD unavailable"
      engineRecovery={{ kind: "invalid-config", path: "C:/broken/openscad.exe" }}
      runtime={runtime}
      themePreference="system"
      onConfigureEnginePath={onConfigureEnginePath}
      onThemePreferenceChange={onThemePreferenceChange}
    />,
  );
  const workbench = within(view.container);
  const autoRender = workbench.getByRole("checkbox", { name: messages.autoRender });
  const theme = workbench.getByRole("combobox", { name: messages.themeLabel });

  expect(workbench.getByRole("alert")).toHaveTextContent(messages.settingsLoadFailed);
  expect(autoRender).toBeDisabled();
  expect(theme).toBeDisabled();
  expect(workbench.queryByLabelText(messages.engineExecutablePath)).not.toBeInTheDocument();

  fireEvent.click(autoRender);
  fireEvent.change(theme, { target: { value: "dark" } });
  expect(runtime.settings.getState().autoRender).toBe(true);
  expect(settingsSave).not.toHaveBeenCalled();
  expect(onThemePreferenceChange).not.toHaveBeenCalled();
  expect(onConfigureEnginePath).not.toHaveBeenCalled();
});
