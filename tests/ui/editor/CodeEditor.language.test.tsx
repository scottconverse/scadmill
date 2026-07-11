// @vitest-environment happy-dom
import {
  completionStatus,
  currentCompletions,
  startCompletion,
} from "@codemirror/autocomplete";
import { language, syntaxTree } from "@codemirror/language";
import { diagnosticCount } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Diagnostic } from "../../../src/application/engine/contracts";
import { CodeEditor } from "../../../src/ui/editor/CodeEditor";

describe("CodeEditor OpenSCAD language support", () => {
  it("installs the OpenSCAD parser in the live editor state", () => {
    const rendered = render(
      <CodeEditor value="module part() { cube(1); }" onChange={vi.fn()} label="Editor" />,
    );
    const content = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content did not mount.");
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered from its DOM.");

    const tree = syntaxTree(editor.state);
    expect(tree.type.name).toBe("Document");
    expect(tree.toString()).not.toContain("⚠");
  });

  it("uses the injected read-only project sources for live completion", async () => {
    const value = "include <lib/shapes.scad>\nbr";
    const rendered = render(
      <CodeEditor
        projectCompletion={{
          documentPath: "main.scad",
          sources: new Map([
            ["main.scad", value],
            ["lib/shapes.scad", "module bracket(size = 8) { cube(size); }"],
          ]),
        }}
        value={value}
        onChange={vi.fn()}
        label="Editor"
      />,
    );
    const content = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content did not mount.");
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered from its DOM.");
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });

    expect(startCompletion(editor)).toBe(true);
    await waitFor(() => expect(completionStatus(editor.state)).toBe("active"));
    expect(currentCompletions(editor.state)).toContainEqual(expect.objectContaining({
      label: "bracket",
      detail: "bracket(size = 8)",
    }));

    rendered.rerender(
      <CodeEditor
        projectCompletion={{
          documentPath: "main.scad",
          sources: new Map([
            ["main.scad", value],
            ["lib/shapes.scad", "module brace(size = 9) { cube(size); }"],
          ]),
        }}
        value={value}
        onChange={vi.fn()}
        label="Editor"
      />,
    );
    await waitFor(() => expect(completionStatus(editor.state)).toBeNull());
    expect(startCompletion(editor)).toBe(true);
    await waitFor(() => expect(completionStatus(editor.state)).toBe("active"));
    expect(currentCompletions(editor.state).map(({ label }) => label)).toContain("brace");
    expect(currentCompletions(editor.state).map(({ label }) => label)).not.toContain("bracket");
  });

  it("omits the OpenSCAD grammar for a plain-text project file", () => {
    const rendered = render(
      <CodeEditor language="plain" value="ordinary notes" onChange={vi.fn()} label="Editor" />,
    );
    const content = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content did not mount.");
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered from its DOM.");

    expect(editor.state.facet(language)).toBeNull();
  });

  it("applies a controlled document switch without reporting it as a user edit", () => {
    const onChange = vi.fn();
    const rendered = render(
      <CodeEditor value="cube(10);" onChange={onChange} label="Editor" />,
    );
    const content = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content did not mount.");
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered from its DOM.");

    rendered.rerender(
      <CodeEditor value="sphere(4);" onChange={onChange} label="Editor" />,
    );

    expect(editor.state.doc.toString()).toBe("sphere(4);");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders current error and warning lines as squiggles with gutter markers", async () => {
    const diagnostics: Diagnostic[] = [
      { severity: "error", message: "Parser error", line: 2 },
      { severity: "warning", message: "Deprecated form", line: 3 },
      { severity: "echo", message: "\"hi\"", line: 1 },
      { severity: "error", message: "Outside the document", line: 99 },
    ];
    const rendered = render(
      <CodeEditor
        diagnostics={diagnostics}
        value={"cube(10);\nsphere(4);\necho(\"hi\");"}
        onChange={vi.fn()}
        label="Editor"
      />,
    );

    await waitFor(() => {
      expect(rendered.container.querySelectorAll(".cm-lintRange-error")).toHaveLength(1);
      expect(rendered.container.querySelectorAll(".cm-lintRange-warning")).toHaveLength(1);
      expect(rendered.container.querySelectorAll(".cm-lint-marker-error")).toHaveLength(1);
      expect(rendered.container.querySelectorAll(".cm-lint-marker-warning")).toHaveLength(1);
    });

    rendered.rerender(
      <CodeEditor diagnostics={[]} value={"cube(10);\nsphere(4);\necho(\"hi\");"} onChange={vi.fn()} label="Editor" />,
    );
    await waitFor(() => expect(rendered.container.querySelectorAll(".cm-lintRange")).toHaveLength(0));
  });

  it("applies a line-navigation request without changing the document", async () => {
    const onChange = vi.fn();
    const rendered = render(
      <CodeEditor
        navigation={{ requestId: 1, line: 2 }}
        value={"cube(10);\nsphere(4);"}
        onChange={onChange}
        label="Editor"
      />,
    );
    const content = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content did not mount.");
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered from its DOM.");

    await waitFor(() => {
      expect(editor.state.doc.lineAt(editor.state.selection.main.head).number).toBe(2);
      expect(content).toHaveFocus();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("revalidates diagnostic lines when a controlled document value is replaced", async () => {
    const diagnostics: Diagnostic[] = [
      { severity: "error", message: "Second-line error", line: 2 },
    ];
    const rendered = render(
      <CodeEditor
        diagnostics={diagnostics}
        value={"cube(10);\nsphere(4);"}
        onChange={vi.fn()}
        label="Editor"
      />,
    );
    const content = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content did not mount.");
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered from its DOM.");
    await waitFor(() => expect(diagnosticCount(editor.state)).toBe(1));

    rendered.rerender(
      <CodeEditor diagnostics={diagnostics} value="cube(10);" onChange={vi.fn()} label="Editor" />,
    );

    await waitFor(() => expect(diagnosticCount(editor.state)).toBe(0));
  });

  it("fires the C1-owned Appendix D commands from their normative bindings", () => {
    const onCommand = vi.fn();
    const rendered = render(
      <CodeEditor
        label="Editor"
        onChange={vi.fn()}
        onCommand={onCommand}
        value={"cube(10);\nsphere(4);"}
      />,
    );
    const content = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content did not mount.");
    content.focus();

    for (const init of [
      { key: "f", ctrlKey: true },
      { key: "h", ctrlKey: true },
      { key: "g", ctrlKey: true },
      { key: "F12" },
      { key: "/", ctrlKey: true },
      { key: "z", ctrlKey: true },
      { key: "y", ctrlKey: true },
      { key: "Z", ctrlKey: true, shiftKey: true },
    ]) {
      fireEvent.keyDown(content, init);
    }
    const host = rendered.container.querySelector<HTMLElement>(".code-editor");
    if (!host) throw new Error("CodeEditor host did not mount.");
    fireEvent.mouseDown(host, { altKey: true });

    expect(onCommand.mock.calls.map(([outcome]) => outcome)).toEqual([
      { command: "find", status: "handled" },
      { command: "replace", status: "handled" },
      { command: "go-to-line", status: "handled" },
      {
        command: "go-to-definition",
        status: "unavailable",
        reason: "project-symbol-navigation-unavailable",
      },
      { command: "toggle-comment", status: "handled" },
      { command: "undo", status: "handled" },
      { command: "redo", status: "handled" },
      { command: "redo", status: "handled" },
      { command: "multi-cursor-add", status: "handled" },
    ]);
  });
});
