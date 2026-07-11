// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultPersistedSettings } from "../../../src/application/settings/settings-codec";
import type { SecretStore } from "../../../src/application/settings/secret-store";
import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";
import { customThemePreference } from "../../../src/application/theme/theme-registry";
import { SettingsDialog } from "../../../src/ui/settings/SettingsDialog";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function settingsFile(source: string, size = source.length): File {
  return {
    size,
    text: vi.fn().mockResolvedValue(source),
  } as unknown as File;
}

describe("SettingsDialog", () => {
  const emptySecrets: SecretStore = {
    persistence: "web-session",
    load: async () => "",
    save: async () => undefined,
    clear: async () => undefined,
  };

  it("searches sections and applies typed changes immediately", () => {
    const settings = createDefaultPersistedSettings();
    const onChange = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={settings}
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    fireEvent.change(view.getByLabelText("Search settings"), { target: { value: "privacy" } });
    expect(view.getByText("Privacy")).toBeVisible();
    expect(view.queryByText("Editor")).not.toBeInTheDocument();
    fireEvent.change(view.getByLabelText("Search settings"), { target: { value: "editor" } });
    fireEvent.change(view.getByLabelText("Editor font size"), { target: { value: "18" } });

    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      editor: { ...settings.editor, fontSize: 18 },
    });
  });

  it("focuses search on open and closes from Escape", async () => {
    const onClose = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={createDefaultPersistedSettings()}
        onChange={vi.fn()}
        onClose={onClose}
        onRestore={vi.fn()}
      />,
    );

    await waitFor(() => expect(view.getByLabelText("Search settings")).toHaveFocus());
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers per-section restore, complete keybindings, import, export, and secret-safe copy", () => {
    const settings = createDefaultPersistedSettings();
    const onRestore = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={settings}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onRestore={onRestore}
      />,
    );

    expect(view.getAllByRole("button", { name: /Restore .* defaults/ })).toHaveLength(9);
    fireEvent.click(view.getByRole("button", { name: "Restore viewer defaults" }));
    expect(onRestore).toHaveBeenCalledWith("viewer");
    expect(view.getByLabelText("Keybinding: Render preview")).toHaveValue("F5");
    for (const group of ["Files", "Editor", "Render", "Viewer", "Layout"]) {
      expect(view.getByRole("group", { name: group })).toBeVisible();
    }
    expect(view.queryByText("renderPreview", { exact: true })).not.toBeInTheDocument();
    expect(view.queryByText("redoAlternate", { exact: true })).not.toBeInTheDocument();
    expect(view.queryByText("switchCodeModel", { exact: true })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Export settings" })).toBeEnabled();
    expect(view.getByLabelText("Import settings JSON")).toHaveAttribute("type", "file");
    expect(view.container.textContent).not.toContain("apiKey");
  });

  it("imports UI-exported bytes into a fresh profile with every value intact", async () => {
    const defaults = createDefaultPersistedSettings();
    const changed = {
      ...defaults,
      editor: { ...defaults.editor, fontSize: 19, tabWidth: 2, wordWrap: true },
      rendering: {
        ...defaults.rendering,
        autoRender: false,
        renderDebounceMs: 321,
        previewTimeoutMs: 12_345,
        fullTimeoutMs: 98_765,
        previewFacetLimit: 73,
        defaultQuality: "full" as const,
      },
      engine: { executablePath: "C:/tools/openscad.exe" },
      viewer: {
        ...defaults.viewer,
        projection: "orthographic" as const,
        orbitButton: "middle" as const,
        panButton: "left" as const,
        showGrid: false,
        showEdges: true,
        meshColor: "rebeccapurple",
      },
      formatter: { indentSize: 2, formatOnSave: true },
      theme: { ...defaults.theme, preference: "high-contrast" as const },
      ai: {
        provider: "compatible" as const,
        endpoint: "https://provider.invalid/v1",
        model: "local-model",
        persistWebSecret: true,
      },
      keybindings: { ...defaults.keybindings, renderPreview: "Ctrl+F5" },
      privacy: { updateChecks: true },
    };
    let exported: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new Error("Settings export must use a Blob.");
      exported = blob;
      return "blob:settings-export";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const exporting = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={changed}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    fireEvent.click(exporting.getByRole("button", { name: "Export settings" }));
    if (!exported) throw new Error("Settings export did not create a Blob.");
    const source = await exported.text();
    expect(source).not.toContain("apiKey");
    exporting.unmount();

    const onChange = vi.fn();
    const importing = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={defaults}
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    fireEvent.change(importing.getByLabelText("Import settings JSON"), {
      target: { files: [settingsFile(source)] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(changed));
  });

  it("exposes every editor, rendering, and viewer preference", () => {
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={createDefaultPersistedSettings()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    for (const label of [
      "Editor font family",
      "Editor font size",
      "Editor tab width",
      "Word wrap",
      "Line numbers",
      "Minimap",
      "Default render quality",
      "Orbit mouse button",
      "Pan mouse button",
      "Mesh color override",
    ]) expect(view.getByLabelText(label)).toBeInTheDocument();
  });

  it("loads and saves the AI key through the secret store without adding it to settings", async () => {
    const settings = createDefaultPersistedSettings();
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn().mockResolvedValue("existing-key"),
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const onChange = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={secretStore}
        settings={settings}
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    const key = await view.findByLabelText("AI API key");
    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveValue("existing-key");
    fireEvent.change(key, { target: { value: "replacement-key" } });
    fireEvent.click(view.getByRole("button", { name: "Save AI key" }));

    await waitFor(() => expect(secretStore.save).toHaveBeenCalledWith("replacement-key", false));
    expect(onChange).not.toHaveBeenCalled();
    expect(JSON.stringify(settings)).not.toContain("replacement-key");
  });

  it("shows the exact UTF-8 loading status while the secret store is pending", () => {
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn(() => new Promise<string>(() => undefined)),
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={secretStore}
        settings={createDefaultPersistedSettings()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(view.getByText("Loading the saved AI key…", { exact: true })).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("moves the current key only after persisted browser storage is explicitly selected", async () => {
    const settings = createDefaultPersistedSettings();
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn().mockResolvedValue("session-key"),
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const onChange = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={secretStore}
        settings={settings}
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    await view.findByDisplayValue("session-key");

    fireEvent.click(view.getByLabelText("Persist AI key in this browser"));

    await waitFor(() => expect(secretStore.save).toHaveBeenCalledWith("session-key", true));
    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      ai: { ...settings.ai, persistWebSecret: true },
    });
  });

  it("still invokes storage migration when opting out with an empty in-memory key", async () => {
    const settings = createDefaultPersistedSettings();
    const persistedSettings = {
      ...settings,
      ai: { ...settings.ai, persistWebSecret: true },
    };
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn().mockResolvedValue(""),
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const onChange = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={secretStore}
        settings={persistedSettings}
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    await waitFor(() => expect(secretStore.load).toHaveBeenCalledWith(true));

    fireEvent.click(view.getByLabelText("Persist AI key in this browser"));

    await waitFor(() => expect(secretStore.save).toHaveBeenCalledWith("", false));
    expect(onChange).toHaveBeenCalledWith({
      ...persistedSettings,
      ai: { ...persistedSettings.ai, persistWebSecret: false },
    });
  });

  it("clears the secret store before restoring the AI section", async () => {
    const secretStore: SecretStore = {
      persistence: "os-keychain",
      load: vi.fn().mockResolvedValue("desktop-key"),
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const onRestore = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={secretStore}
        settings={createDefaultPersistedSettings()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onRestore={onRestore}
      />,
    );
    await view.findByDisplayValue("desktop-key");

    fireEvent.click(view.getByRole("button", { name: "Restore ai defaults" }));

    await waitFor(() => expect(secretStore.clear).toHaveBeenCalledOnce());
    expect(onRestore).toHaveBeenCalledWith("ai");
  });

  it("rejects an oversized import without reading or changing settings", async () => {
    const onChange = vi.fn();
    const file = settingsFile("{}", 1_048_577);
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={createDefaultPersistedSettings()}
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    fireEvent.change(view.getByLabelText("Import settings JSON"), { target: { files: [file] } });

    expect(await view.findByRole("alert")).toHaveTextContent("current settings were not changed");
    expect(file.text).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores a stale import result that finishes after a newer selection", async () => {
    const settings = createDefaultPersistedSettings();
    const older = { ...settings, editor: { ...settings.editor, fontSize: 16 } };
    const newer = { ...settings, editor: { ...settings.editor, fontSize: 18 } };
    const olderText = deferred<string>();
    const olderFile = {
      size: 100,
      text: () => olderText.promise,
    } as unknown as File;
    const onChange = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={settings}
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    const input = view.getByLabelText("Import settings JSON");

    fireEvent.change(input, { target: { files: [olderFile] } });
    fireEvent.change(input, { target: { files: [settingsFile(JSON.stringify(newer))] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(newer));
    olderText.resolve(JSON.stringify(older));
    await Promise.resolve();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("rejects a colliding keybinding with a visible error and no partial update", () => {
    const onChange = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={createDefaultPersistedSettings()}
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    fireEvent.change(view.getByLabelText("Keybinding: Full render"), { target: { value: "F5" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(view.getByRole("alert")).toHaveTextContent("collision");
  });

  it("does not dispatch fractional values for integer-only engine settings", () => {
    const onChange = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={createDefaultPersistedSettings()}
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    fireEvent.change(view.getByLabelText("Preview facet setting"), { target: { value: "48.5" } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("imports, persists, and selects a valid custom theme from the Theme section", async () => {
    const settings = createDefaultPersistedSettings();
    const theme = {
      ...SHIPPED_THEMES[0],
      meta: { name: "Workshop blue", kind: "dark" as const, version: 1 as const },
    };
    const onChange = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={settings}
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    fireEvent.change(view.getByLabelText("Import custom theme JSON"), {
      target: { files: [settingsFile(JSON.stringify(theme))] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({
      ...settings,
      theme: {
        preference: customThemePreference(theme.meta.name),
        customThemes: [theme],
      },
    }));
  });
});
