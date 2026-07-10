import { Annotation, EditorState, StateEffect, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import { codeEditorTheme } from "./code-editor-theme";
import { openScad } from "./openscad-language";

const controlledDocumentUpdate = Annotation.define<boolean>();

export interface CodeEditorProps {
  value: string;
  onChange(value: string): void;
  onCursorChange?(position: CursorPosition): void;
  initialSession?: CodeEditorSession;
  onSessionChange?(session: CodeEditorSession): void;
  label: string;
}

export interface CodeEditorSession {
  state: EditorState;
  scrollLeft: number;
  scrollTop: number;
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

function sessionSnapshot(editor: EditorView): CodeEditorSession {
  return {
    state: editor.state,
    scrollLeft: editor.scrollDOM.scrollLeft,
    scrollTop: editor.scrollDOM.scrollTop,
  };
}

export function CodeEditor({
  value,
  onChange,
  onCursorChange,
  initialSession,
  onSessionChange,
  label,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initialValue = useRef(value);
  const initialSessionRef = useRef(initialSession);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSessionChangeRef = useRef(onSessionChange);
  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;
  onSessionChangeRef.current = onSessionChange;

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const extensions = [
      basicSetup,
      openScad(),
      codeEditorTheme,
      EditorView.contentAttributes.of({ "aria-label": label }),
      EditorView.updateListener.of((update) => {
        const controlled = update.transactions.some((transaction) =>
          transaction.annotation(controlledDocumentUpdate)
        );
        if (update.docChanged && !controlled) {
          onChangeRef.current(update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) {
          onCursorChangeRef.current?.(cursorPosition(update.state));
        }
        onSessionChangeRef.current?.(sessionSnapshot(update.view));
      }),
    ];
    const restoredSession = initialSessionRef.current;
    const state = restoredSession
      ? restoredSession.state.update({
          effects: StateEffect.reconfigure.of(extensions),
        }).state
      : EditorState.create({
          doc: initialValue.current,
          extensions,
        });
    const editor = new EditorView({
      parent: host.current,
      state,
    });
    view.current = editor;
    if (restoredSession) {
      editor.scrollDOM.scrollLeft = restoredSession.scrollLeft;
      editor.scrollDOM.scrollTop = restoredSession.scrollTop;
    }
    onCursorChangeRef.current?.(cursorPosition(editor.state));
    onSessionChangeRef.current?.(sessionSnapshot(editor));
    return () => {
      onSessionChangeRef.current?.(sessionSnapshot(editor));
      view.current = null;
      editor.destroy();
    };
  }, [label]);

  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({
        annotations: [
          controlledDocumentUpdate.of(true),
          Transaction.addToHistory.of(false),
        ],
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      });
    }
  }, [value]);

  return <div className="code-editor" ref={host} />;
}
