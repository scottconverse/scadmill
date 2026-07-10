// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EditorSettings } from "../../../src/application/runtime/render-settings";
import { createKeybindingSettings } from "../../../src/application/commands/default-keybindings";
import { CodeEditor } from "../../../src/ui/editor/CodeEditor";

const CUSTOM_EDITOR_SETTINGS = {
  fontFamily: '"Fira Code", monospace',
  fontSize: 18,
  tabWidth: 8,
  wordWrap: true,
  lineNumbers: false,
  minimap: true,
} satisfies EditorSettings;

function mountedEditor(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>(".cm-content");
  if (!content) throw new Error("CodeMirror content did not mount.");
  const editor = EditorView.findFromDOM(content);
  if (!editor) throw new Error("CodeMirror view could not be recovered from its DOM.");
  return editor;
}

describe("CodeEditor settings", () => {
  it("applies every editor option to the live CodeMirror view", () => {
    const rendered = render(
      <CodeEditor
        editorSettings={CUSTOM_EDITOR_SETTINGS}
        label="Editor"
        onChange={vi.fn()}
        value={"cube(10);\ntranslate([1, 2, 3]) sphere(4);"}
      />,
    );
    const editor = mountedEditor(rendered.container);

    expect(editor.dom).toHaveAttribute("data-editor-font-family", '"Fira Code", monospace');
    expect(editor.dom).toHaveAttribute("data-editor-font-size", "18");
    expect(editor.state.facet(EditorState.tabSize)).toBe(8);
    expect(editor.contentDOM).toHaveClass("cm-lineWrapping");
    expect(editor.dom).toHaveAttribute("data-editor-line-numbers", "off");
    expect(editor.dom).toHaveAttribute("data-editor-minimap", "on");
    expect(rendered.container.querySelector(".cm-minimap")).toHaveAttribute("aria-hidden", "true");
  });

  it("reconfigures settings without replacing the editor view or document", async () => {
    const rendered = render(
      <CodeEditor label="Editor" onChange={vi.fn()} value="cube(10);" />,
    );
    const originalEditor = mountedEditor(rendered.container);

    rendered.rerender(
      <CodeEditor
        editorSettings={CUSTOM_EDITOR_SETTINGS}
        label="Editor"
        onChange={vi.fn()}
        value="cube(10);"
      />,
    );

    await waitFor(() => {
      const configuredEditor = mountedEditor(rendered.container);
      expect(configuredEditor).toBe(originalEditor);
      expect(configuredEditor.state.doc.toString()).toBe("cube(10);");
      expect(configuredEditor.state.facet(EditorState.tabSize)).toBe(8);
      expect(rendered.container.querySelector(".cm-minimap")).toBeInTheDocument();
    });
  });

  it("applies an injected C1 keybinding map at runtime", () => {
    const onCommand = vi.fn();
    const rendered = render(
      <CodeEditor
        keybindings={createKeybindingSettings({ find: "Alt+F" })}
        label="Editor"
        onChange={vi.fn()}
        onCommand={onCommand}
        value="cube(10);"
      />,
    );
    const content = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content did not mount.");

    fireEvent.keyDown(content, { key: "f", ctrlKey: true });
    expect(onCommand).not.toHaveBeenCalled();
    fireEvent.keyDown(content, { key: "f", altKey: true });
    expect(onCommand).toHaveBeenCalledWith({ command: "find", status: "handled" });
  });
});
