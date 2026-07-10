import {
  lintGutter,
  setDiagnostics,
  type Diagnostic as CodeMirrorDiagnostic,
} from "@codemirror/lint";
import { Annotation, EditorState, StateEffect, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import type { Diagnostic } from "../../application/engine/contracts";
import { codeEditorTheme } from "./code-editor-theme";
import { openScad } from "./openscad-language";

const controlledDocumentUpdate = Annotation.define<boolean>();
const EMPTY_DIAGNOSTICS: readonly Diagnostic[] = [];

export interface EditorNavigationRequest {
  requestId: number;
  line: number;
}

export interface CodeEditorProps {
  value: string;
  onChange(value: string): void;
  diagnostics?: readonly Diagnostic[];
  navigation?: EditorNavigationRequest;
  onNavigationHandled?(requestId: number): void;
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

function codeMirrorDiagnostics(
  state: EditorState,
  diagnostics: readonly Diagnostic[],
): CodeMirrorDiagnostic[] {
  return diagnostics.flatMap((diagnostic) => {
    if (
      (diagnostic.severity !== "error" && diagnostic.severity !== "warning")
      || !diagnostic.line
      || !Number.isInteger(diagnostic.line)
      || diagnostic.line < 1
      || diagnostic.line > state.doc.lines
    ) return [];
    const line = state.doc.line(diagnostic.line);
    return [{
      from: line.from,
      to: line.to,
      severity: diagnostic.severity,
      message: diagnostic.message,
      source: "OpenSCAD",
    }];
  });
}

export function CodeEditor({
  value,
  onChange,
  diagnostics = EMPTY_DIAGNOSTICS,
  navigation,
  onNavigationHandled,
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
  const onNavigationHandledRef = useRef(onNavigationHandled);
  const onSessionChangeRef = useRef(onSessionChange);
  const handledNavigationRequest = useRef<number | null>(null);
  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;
  onNavigationHandledRef.current = onNavigationHandled;
  onSessionChangeRef.current = onSessionChange;

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const extensions = [
      basicSetup,
      openScad(),
      lintGutter(),
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

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch(setDiagnostics(editor.state, codeMirrorDiagnostics(editor.state, diagnostics)));
  }, [diagnostics]);

  useEffect(() => {
    const editor = view.current;
    if (
      !editor
      || !navigation
      || handledNavigationRequest.current === navigation.requestId
    ) return;
    handledNavigationRequest.current = navigation.requestId;
    if (
      !Number.isInteger(navigation.line)
      || navigation.line < 1
      || navigation.line > editor.state.doc.lines
    ) {
      onNavigationHandledRef.current?.(navigation.requestId);
      return;
    }
    const line = editor.state.doc.line(navigation.line);
    editor.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    editor.focus();
    onNavigationHandledRef.current?.(navigation.requestId);
  }, [navigation]);

  return <div className="code-editor" ref={host} />;
}
