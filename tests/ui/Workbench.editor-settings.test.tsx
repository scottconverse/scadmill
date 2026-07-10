// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { EngineService } from "../../src/application/engine/contracts";
import type { SettingsState } from "../../src/application/runtime/render-settings";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime,
} from "../../src/application/runtime/workbench-runtime";
import { SHIPPED_THEMES } from "../../src/application/theme/shipped-themes";
import { Workbench } from "../../src/ui/Workbench";

it("applies editor options owned by the runtime settings store", async () => {
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const base = createWorkbenchRuntime(engine);
  const state: SettingsState = {
    ...base.settings.getState(),
    editor: {
      fontFamily: "monospace",
      fontSize: 17,
      tabWidth: 6,
      wordWrap: true,
      lineNumbers: false,
      minimap: true,
    },
  };
  const runtime: WorkbenchRuntime = {
    ...base,
    settings: {
      getState: () => state,
      getInitialState: () => state,
      subscribe: () => () => undefined,
    },
  };
  const rendered = render(
    <Workbench
      activeTheme={SHIPPED_THEMES[0]}
      engineLabel="OpenSCAD 2021.01"
      onThemePreferenceChange={vi.fn()}
      runtime={runtime}
      themePreference="system"
    />,
  );

  await waitFor(() => {
    const content = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content did not mount.");
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered.");
    expect(editor.state.facet(EditorState.tabSize)).toBe(6);
    expect(editor.contentDOM).toHaveClass("cm-lineWrapping");
    expect(editor.dom).toHaveAttribute("data-editor-line-numbers", "off");
    expect(rendered.container.querySelector(".cm-minimap")).toBeInTheDocument();
  });
});

it("surfaces an unavailable go-to-definition outcome instead of claiming success", async () => {
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine, { makeId: () => "editor-command" });
  const rendered = render(
    <Workbench
      activeTheme={SHIPPED_THEMES[0]}
      engineLabel="OpenSCAD 2021.01"
      onThemePreferenceChange={vi.fn()}
      runtime={runtime}
      themePreference="system"
    />,
  );
  const content = await waitFor(() => {
    const node = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!node) throw new Error("CodeMirror content did not mount.");
    return node;
  });

  fireEvent.keyDown(content, { key: "F12", bubbles: true, cancelable: true });

  expect(await rendered.findByRole("status")).toHaveTextContent(
    "Go to definition is unavailable until project symbol navigation is implemented.",
  );
  expect(runtime.history.getState().at(-1)).toMatchObject({
    kind: "editor-command",
    summary: "Editor command unavailable: go-to-definition",
  });
});

it("lets an editor-scoped override consume a global shortcut without double-dispatch", async () => {
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine, {
    makeId: () => "editor-command",
    keybindings: { find: "Mod+J" },
  });
  const rendered = render(
    <Workbench
      activeTheme={SHIPPED_THEMES[0]}
      engineLabel="OpenSCAD 2021.01"
      onThemePreferenceChange={vi.fn()}
      runtime={runtime}
      themePreference="system"
    />,
  );
  const content = await waitFor(() => {
    const node = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!node) throw new Error("CodeMirror content did not mount.");
    return node;
  });
  const consoleWasOpen = runtime.layout.getState().consoleOpen;

  fireEvent.keyDown(content, {
    key: "j",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });

  await waitFor(() => expect(rendered.container.querySelector(".cm-search")).toBeInTheDocument());
  await waitFor(() => expect(runtime.history.getState().at(-1)).toMatchObject({
    kind: "editor-command",
    summary: "Editor command: find",
  }));
  expect(runtime.layout.getState().consoleOpen).toBe(consoleWasOpen);
  expect(runtime.history.getState().filter(({ kind }) => kind === "update-layout")).toHaveLength(0);
});

it("runs Edit-menu actions in CodeMirror and records the shared command", async () => {
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine, {
    keybindings: { toggleComment: "Alt+Q" },
  });
  const rendered = render(
    <Workbench
      activeTheme={SHIPPED_THEMES[0]}
      engineLabel="OpenSCAD 2021.01"
      onThemePreferenceChange={vi.fn()}
      runtime={runtime}
      themePreference="system"
    />,
  );
  const app = within(rendered.container);
  const editor = await waitFor(() => {
    const content = rendered.container.querySelector<HTMLElement>(".cm-content");
    const view = content ? EditorView.findFromDOM(content) : null;
    if (!view) throw new Error("CodeMirror did not mount.");
    return view;
  });

  fireEvent.click(app.getByRole("button", { name: "Edit" }));
  const toggle = app.getByRole("button", { name: "Toggle comment" });
  expect(within(toggle).getByText("Alt+Q")).toBeVisible();
  fireEvent.click(toggle);

  await waitFor(() => expect(editor.state.doc.toString()).toMatch(/^\/\//u));
  expect(runtime.history.getState()).toContainEqual(expect.objectContaining({
    kind: "editor-command",
    summary: "Editor command: toggle-comment",
  }));
  runtime.dispose();
});

it("reveals a hidden editor before running an Edit-menu action", async () => {
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine);
  const rendered = render(
    <Workbench
      activeTheme={SHIPPED_THEMES[0]}
      engineLabel="OpenSCAD 2021.01"
      onThemePreferenceChange={vi.fn()}
      runtime={runtime}
      themePreference="system"
    />,
  );
  const app = within(rendered.container);
  await waitFor(() => expect(rendered.container.querySelector(".cm-content")).toBeInTheDocument());
  const editorSurface = rendered.container.querySelector<HTMLElement>(".workspace-editor");
  if (!editorSurface) throw new Error("Editor surface did not mount.");

  fireEvent.click(app.getByRole("button", { name: "Collapse editor" }));
  await waitFor(() => expect(editorSurface).toHaveAttribute("hidden"));
  fireEvent.click(app.getByRole("button", { name: "Edit" }));
  fireEvent.click(app.getByRole("button", { name: "Find" }));

  await waitFor(() => expect(editorSurface).not.toHaveAttribute("hidden"));
  await waitFor(() => expect(
    rendered.container.querySelector('.cm-search input[name="search"]'),
  ).toHaveFocus());
  runtime.dispose();
});
