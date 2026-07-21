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

  it("exposes the desktop MCP toggle only when the platform provides the port", () => {
    const onMcpEnabledChange = vi.fn();
    const onMcpPermissionChange = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={createDefaultPersistedSettings()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        mcpAvailable
        mcpEnabled={false}
        onMcpEnabledChange={onMcpEnabledChange}
        mcpPermissions={{ list_files: "allow-session", read_file: "allow-session", write_file: "allow-session", render_preview: "allow-session", export_model: "allow-session", get_diagnostics: "allow-session", get_parameters: "allow-session", set_parameters: "allow-session", take_screenshot: "allow-session", get_history: "allow-session" }}
        onMcpPermissionChange={onMcpPermissionChange}
      />,
    );
    fireEvent.click(view.getByLabelText("Enable local MCP server (stdio)"));
    expect(onMcpEnabledChange).toHaveBeenCalledWith(true);
    fireEvent.change(view.getByLabelText("MCP write-file permission"), { target: { value: "deny" } });
    expect(onMcpPermissionChange).toHaveBeenCalledWith("write_file", "deny");
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
        models: ["local-model", "review-model"],
        configurations: [],
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
        renderDiskCacheAvailable
        projectDiskRenderCacheEligible
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
      "Persist render cache for this project",
      "Orbit mouse button",
      "Pan mouse button",
      "Mesh color override",
    ]) expect(view.getByLabelText(label)).toBeInTheDocument();
  });

  it("routes desktop render-cache consent to the active project instead of global settings", () => {
    const onChange = vi.fn();
    const onProjectDiskRenderCacheChange = vi.fn();
    const onClearProjectDiskRenderCache = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={createDefaultPersistedSettings()}
        renderDiskCacheAvailable
        projectDiskRenderCacheEligible
        projectDiskRenderCacheEnabled={false}
        onProjectDiskRenderCacheChange={onProjectDiskRenderCacheChange}
        onClearProjectDiskRenderCache={onClearProjectDiskRenderCache}
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    fireEvent.click(view.getByLabelText("Persist render cache for this project"));

    expect(onProjectDiskRenderCacheChange).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(view.getByText(/does not delete existing records/u)).toHaveAttribute("role", "note");
    fireEvent.click(view.getByRole("button", { name: "Clear this project's disk render cache" }));
    expect(onClearProjectDiskRenderCache).toHaveBeenCalledOnce();
  });

  it("does not offer disk-cache consent for scratch work", () => {
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={createDefaultPersistedSettings()}
        renderDiskCacheAvailable
        onChange={vi.fn()}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(view.queryByLabelText("Persist render cache for this project")).not.toBeInTheDocument();
    expect(view.getByText(/Scratch work is never written to the disk render cache/u)).toBeVisible();
  });

  it("locks every settings mutation surface after durable settings fail to load", () => {
    const onChange = vi.fn();
    const onRestore = vi.fn();
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={emptySecrets}
        settings={createDefaultPersistedSettings()}
        settingsMutationsBlocked
        onChange={onChange}
        onClose={vi.fn()}
        onRestore={onRestore}
      />,
    );

    expect(view.getByLabelText("Search settings")).toBeEnabled();
    expect(view.getByRole("button", { name: "Export settings" })).toBeEnabled();
    const settingsImport = view.getByLabelText("Import settings JSON");
    expect(settingsImport).toBeDisabled();
    expect(settingsImport.closest("label")).toHaveAttribute("aria-disabled", "true");
    expect(view.container.querySelector(".settings-feedback")).not.toHaveAttribute("aria-live");
    for (const label of [
      "Editor font size",
      "Auto-render",
      "Engine executable path",
      "Default projection",
      "Formatter indent size",
      "AI provider",
      "Keybinding: Render preview",
      "Check for updates",
    ]) expect(view.getByLabelText(label)).toBeDisabled();
    for (const restore of view.getAllByRole("button", { name: /Restore .* defaults/u })) {
      expect(restore).toBeDisabled();
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
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

  it("records a bounded unique model list for the per-conversation picker", () => {
    const settings = createDefaultPersistedSettings();
    const onChange = vi.fn();
    const view = render(<SettingsDialog
      engineLabel="OpenSCAD 2026.06.12"
      onChange={onChange}
      onClose={vi.fn()}
      onRestore={vi.fn()}
      secretStore={emptySecrets}
      settings={settings}
    />);
    fireEvent.change(view.getByLabelText("Configured AI models (one per line)"), {
      target: { value: "model-a\nmodel-b\nmodel-a\n" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...settings,
      ai: { ...settings.ai, models: ["model-a", "model-b"] },
    });
  });

  it("shows the local-storage warning before browser persistence is selected", () => {
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

    expect(view.getByLabelText("Persist AI key in this browser")).not.toBeChecked();
    expect(view.getByRole("note")).toHaveTextContent(
      "Persisting an AI key writes it to browser local storage on this device.",
    );
  });

  it("reports a failed secret write without promising that stored data was unchanged", async () => {
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn().mockResolvedValue("existing-key"),
      save: vi.fn().mockRejectedValue(new Error("storage interrupted")),
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
    const key = await view.findByDisplayValue("existing-key");

    fireEvent.change(key, { target: { value: "replacement-key" } });
    fireEvent.click(view.getByRole("button", { name: "Save AI key" }));

    expect(await view.findByRole("alert")).toHaveTextContent(/stored state may be uncertain/iu);
    expect(view.getByRole("alert")).not.toHaveTextContent(/was not changed/iu);
  });

  it("keeps secret input and actions locked until an in-flight save settles", async () => {
    const pendingSave = deferred<void>();
    const onClose = vi.fn();
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn().mockResolvedValue("existing-key"),
      save: vi.fn(() => pendingSave.promise),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={secretStore}
        settings={createDefaultPersistedSettings()}
        onChange={vi.fn()}
        onClose={onClose}
        onRestore={vi.fn()}
      />,
    );
    const key = await view.findByDisplayValue("existing-key");
    const save = view.getByRole("button", { name: "Save AI key" });
    fireEvent.change(key, { target: { value: "first-key" } });
    fireEvent.click(save);

    expect(key).toBeDisabled();
    expect(save).toBeDisabled();
    const close = view.getByRole("button", { name: "Close settings" });
    expect(close).toBeDisabled();
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(close);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.change(key, { target: { value: "second-key" } });
    fireEvent.click(save);
    expect(secretStore.save).toHaveBeenCalledTimes(1);
    expect(secretStore.save).toHaveBeenCalledWith("first-key", false);

    pendingSave.resolve(undefined);
    expect(await view.findByText("AI key saved.")).toBeVisible();
    expect(key).toHaveValue("first-key");
    expect(key).toBeEnabled();
    expect(close).toBeEnabled();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("cancels pending settings import while a secret mutation owns persistence", async () => {
    const pendingSave = deferred<void>();
    const pendingImport = deferred<string>();
    const settings = createDefaultPersistedSettings();
    const imported = {
      ...settings,
      ai: { ...settings.ai, persistWebSecret: true },
    };
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn().mockResolvedValue("existing-key"),
      save: vi.fn(() => pendingSave.promise),
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
    const key = await view.findByDisplayValue("existing-key");
    const importInput = view.getByLabelText("Import settings JSON");
    const pendingFile = {
      size: 100,
      text: () => pendingImport.promise,
    } as unknown as File;

    fireEvent.change(importInput, { target: { files: [pendingFile] } });
    fireEvent.change(key, { target: { value: "replacement-key" } });
    fireEvent.click(view.getByRole("button", { name: "Save AI key" }));

    expect(importInput).toBeDisabled();
    pendingImport.resolve(JSON.stringify(imported));
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();

    pendingSave.resolve(undefined);
    expect(await view.findByText("AI key saved.")).toBeVisible();
    expect(importInput).toBeEnabled();
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

  it("moves every scoped provider key when browser persistence changes", async () => {
    const defaults = createDefaultPersistedSettings();
    const settings = {
      ...defaults,
      ai: {
        ...defaults.ai,
        configurations: [{
          id: "reviewer",
          label: "Review model",
          provider: "anthropic" as const,
          endpoint: "https://example.test/messages",
          model: "claude-review",
        }],
      },
    };
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn(async (_persist, scope) => scope === "reviewer" ? "profile-session-key" : "default-session-key"),
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
    await view.findByDisplayValue("profile-session-key");

    fireEvent.click(view.getByLabelText("Persist AI key in this browser"));

    await waitFor(() => expect(secretStore.save).toHaveBeenCalledWith("profile-session-key", true, "reviewer"));
    expect(secretStore.save).toHaveBeenCalledWith("default-session-key", true);
    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      ai: { ...settings.ai, persistWebSecret: true },
    });
  });

  it("locks scoped provider controls while credential migration owns persistence", async () => {
    const pendingSave = deferred<void>();
    const defaults = createDefaultPersistedSettings();
    const settings = {
      ...defaults,
      ai: {
        ...defaults.ai,
        configurations: [{ id: "reviewer", label: "Review model", provider: "anthropic" as const, endpoint: "https://example.test/messages", model: "claude-review" }],
      },
    };
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn(async (_persist, scope) => scope === "reviewer" ? "profile-key" : "default-key"),
      save: vi.fn(() => pendingSave.promise),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(
      <SettingsDialog engineLabel="OpenSCAD 2026.06.12" secretStore={secretStore} settings={settings} onChange={vi.fn()} onClose={vi.fn()} onRestore={vi.fn()} />,
    );
    await view.findByDisplayValue("profile-key");

    fireEvent.click(view.getByLabelText("Persist AI key in this browser"));
    await waitFor(() => expect(secretStore.save).toHaveBeenCalled());

    const profileGroup = view.getByRole("group", { name: "Review model" });
    for (const control of profileGroup.querySelectorAll("input, select, button")) expect(control).toBeDisabled();
    expect(view.getByRole("button", { name: "Add provider configuration" })).toBeDisabled();

    pendingSave.resolve(undefined);
    expect(await view.findByText(/AI key storage changed/iu)).toBeVisible();
  });

  it("locks global persistence controls while a scoped provider save owns storage", async () => {
    const profileSave = deferred<void>();
    const defaults = createDefaultPersistedSettings();
    const settings = {
      ...defaults,
      ai: {
        ...defaults.ai,
        configurations: [{ id: "reviewer", label: "Review model", provider: "anthropic" as const, endpoint: "https://example.test/messages", model: "claude-review" }],
      },
    };
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn(async (_persist, scope) => scope === "reviewer" ? "profile-key" : "default-key"),
      save: vi.fn((_secret, _persist, scope) => scope === "reviewer" ? profileSave.promise : Promise.resolve()),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(
      <SettingsDialog engineLabel="OpenSCAD 2026.06.12" secretStore={secretStore} settings={settings} onChange={vi.fn()} onClose={vi.fn()} onRestore={vi.fn()} />,
    );
    const profileGroup = await view.findByRole("group", { name: "Review model" });
    await view.findByDisplayValue("profile-key");

    fireEvent.click(profileGroup.getElementsByTagName("button")[0]);
    await waitFor(() => expect(secretStore.save).toHaveBeenCalledWith("profile-key", false, "reviewer"));

    expect(view.getByLabelText("Persist AI key in this browser")).toBeDisabled();
    expect(view.getByLabelText("Import settings JSON")).toBeDisabled();
    expect(view.getByRole("button", { name: "Restore ai defaults" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Add provider configuration" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Close settings" })).toBeDisabled();

    profileSave.resolve(undefined);
    await waitFor(() => expect(view.getByLabelText("Persist AI key in this browser")).toBeEnabled());
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

  it("clears scoped provider keys when restoring the AI section", async () => {
    const defaults = createDefaultPersistedSettings();
    const settings = {
      ...defaults,
      ai: {
        ...defaults.ai,
        configurations: [{
          id: "reviewer",
          label: "Review model",
          provider: "anthropic" as const,
          endpoint: "https://example.test/messages",
          model: "claude-review",
        }],
      },
    };
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn(async (_persist, scope) => scope === "reviewer" ? "profile-key" : "default-key"),
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(
      <SettingsDialog
        engineLabel="OpenSCAD 2026.06.12"
        secretStore={secretStore}
        settings={settings}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    await view.findByDisplayValue("profile-key");

    fireEvent.click(view.getByRole("button", { name: "Restore ai defaults" }));

    await waitFor(() => expect(secretStore.clear).toHaveBeenCalledWith("reviewer"));
    expect(secretStore.clear).toHaveBeenCalledWith();
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
    expect(view.getByRole("alert")).toHaveTextContent(
      "That keybinding conflicts with another command.",
    );
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
