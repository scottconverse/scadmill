// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CodeEditor } from "../../../src/ui/editor/CodeEditor";

function mountedEditor(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>(".cm-content");
  if (!content) throw new Error("CodeMirror content did not mount.");
  const editor = EditorView.findFromDOM(content);
  if (!editor) throw new Error("CodeMirror view could not be recovered from its DOM.");
  return editor;
}

describe("CodeEditor formatter commands", () => {
  it("formats the complete document through the command request and configured indent", async () => {
    const onChange = vi.fn();
    const onCommand = vi.fn();
    const source = "module part(){cube(1);}";
    const rendered = render(
      <CodeEditor
        formatterSettings={{ formatOnSave: false, indentSize: 2 }}
        label="Editor"
        onChange={onChange}
        onCommand={onCommand}
        value={source}
      />,
    );

    rendered.rerender(
      <CodeEditor
        commandRequest={{ command: "format-document", requestId: 1 }}
        formatterSettings={{ formatOnSave: false, indentSize: 2 }}
        label="Editor"
        onChange={onChange}
        onCommand={onCommand}
        value={source}
      />,
    );

    await waitFor(() => expect(mountedEditor(rendered.container).state.doc.toString()).toBe(
      "module part() {\n  cube(1);\n}",
    ));
    expect(onChange).toHaveBeenLastCalledWith("module part() {\n  cube(1);\n}");
    expect(onCommand).toHaveBeenLastCalledWith({ command: "format-document", status: "handled" });
  });

  it("formats only the selected statements and preserves the surrounding source", async () => {
    const onChange = vi.fn();
    const onCommand = vi.fn();
    const source = "module part() {\n    cube(10); sphere( 2);\n}\ncylinder(3);";
    const rendered = render(
      <CodeEditor label="Editor" onChange={onChange} onCommand={onCommand} value={source} />,
    );
    const editor = mountedEditor(rendered.container);
    const from = source.indexOf("    cube");
    const to = source.indexOf("\n}");
    editor.dispatch({ selection: { anchor: from, head: to } });

    rendered.rerender(
      <CodeEditor
        commandRequest={{ command: "format-selection", requestId: 1 }}
        label="Editor"
        onChange={onChange}
        onCommand={onCommand}
        value={source}
      />,
    );

    await waitFor(() => expect(editor.state.doc.toString()).toBe(
      "module part() {\n    cube(10);\n    sphere(2);\n}\ncylinder(3);",
    ));
    expect(onCommand).toHaveBeenLastCalledWith({ command: "format-selection", status: "handled" });
  });

  it("refuses malformed source without changing the document", async () => {
    const onChange = vi.fn();
    const onCommand = vi.fn();
    const source = "module broken( { cube(1);";
    const rendered = render(
      <CodeEditor
        commandRequest={{ command: "format-document", requestId: 1 }}
        label="Editor"
        onChange={onChange}
        onCommand={onCommand}
        value={source}
      />,
    );

    await waitFor(() => expect(onCommand).toHaveBeenCalledWith({
      command: "format-document",
      reason: "syntax-error",
      status: "unavailable",
    }));
    expect(mountedEditor(rendered.container).state.doc.toString()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("runs Format document from its normative keybinding", async () => {
    const onChange = vi.fn();
    const rendered = render(
      <CodeEditor label="Editor" onChange={onChange} value="x=1+2;" />,
    );
    const content = rendered.container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content did not mount.");

    fireEvent.keyDown(content, { altKey: true, key: "F", shiftKey: true });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("x = 1 + 2;"));
  });
});
