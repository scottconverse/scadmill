import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import { codeEditorTheme } from "./code-editor-theme";
import { openScad } from "./openscad-language";

export interface CodeEditorProps {
  value: string;
  onChange(value: string): void;
  onCursorChange?(position: CursorPosition): void;
  label: string;
}

export interface CursorPosition {
  line: number;
  column: number;
}

function cursorPosition(state: EditorState): CursorPosition {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

export function CodeEditor({ value, onChange, onCursorChange, label }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initialValue = useRef(value);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          basicSetup,
          openScad(),
          codeEditorTheme,
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (update.docChanged || update.selectionSet) {
              onCursorChangeRef.current?.(cursorPosition(update.state));
            }
          }),
        ],
      }),
    });
    view.current = editor;
    onCursorChangeRef.current?.(cursorPosition(editor.state));
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, [label]);

  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div className="code-editor" ref={host} />;
}
