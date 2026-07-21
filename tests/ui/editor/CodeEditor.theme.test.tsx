// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CodeEditor } from "../../../src/ui/editor/CodeEditor";

const EDITOR_VARIABLES = [
  "--editor-background",
  "--editor-text",
  "--editor-line-number",
  "--editor-active-line",
  "--editor-cursor",
  "--editor-selection",
  "--editor-matching-bracket",
  "--editor-squiggle-error",
  "--editor-squiggle-warning",
  "--editor-syntax-keyword",
  "--editor-syntax-builtin",
  "--editor-syntax-user-module",
  "--editor-syntax-number",
  "--editor-syntax-string",
  "--editor-syntax-boolean",
  "--editor-syntax-special-variable",
  "--editor-syntax-comment",
  "--editor-syntax-operator",
  "--editor-syntax-modifier-char",
  "--editor-syntax-punctuation",
] as const;

describe("CodeEditor theme", () => {
  it("installs a CodeMirror theme that consumes every Appendix C editor variable", () => {
    render(<CodeEditor value="cube(10);" onChange={vi.fn()} label="Editor" />);

    const styles = [...document.querySelectorAll("style")]
      .map((style) => style.textContent ?? "")
      .join("\n");
    for (const variable of EDITOR_VARIABLES) {
      expect(styles, variable).toContain(`var(${variable})`);
    }
  });

  it("marks selected syntax so its foreground normalizes to editor.text", () => {
    const view = render(<CodeEditor value="cube(10);" onChange={vi.fn()} label="Editor" />);
    const content = view.container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content did not mount.");
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered from its DOM.");

    editor.dispatch({ selection: { anchor: 0, head: 4 } });

    expect(view.container.querySelector(".cm-selected-text")).toHaveTextContent("cube");
    const styles = [...document.querySelectorAll("style")]
      .map((style) => style.textContent ?? "")
      .join("\n");
    expect(styles).toMatch(/\.cm-selected-text[^}]*var\(--editor-text\)/u);
  });

  it("replaces CodeMirror lint colors with Appendix C squiggle tokens", () => {
    render(<CodeEditor value="cube(10);" onChange={vi.fn()} label="Editor" />);

    const styles = [...document.querySelectorAll("style")]
      .map((style) => style.textContent ?? "")
      .join("\n");
    expect(styles).toMatch(/\.cm-lintRange-error[^}]*background-image:\s*none/u);
    expect(styles).toMatch(/\.cm-lintRange-error[^}]*var\(--editor-squiggle-error\)/u);
    expect(styles).toMatch(/\.cm-lintRange-warning[^}]*var\(--editor-squiggle-warning\)/u);
    expect(styles).toMatch(/\.cm-lint-marker-error[^}]*var\(--editor-squiggle-error\)/u);
    expect(styles).toMatch(/\.cm-lint-marker-warning[^}]*var\(--editor-squiggle-warning\)/u);
  });
});
