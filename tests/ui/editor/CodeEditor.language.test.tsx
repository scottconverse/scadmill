// @vitest-environment happy-dom
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
});
