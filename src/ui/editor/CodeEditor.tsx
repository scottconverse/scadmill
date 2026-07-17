import { closeCompletion } from "@codemirror/autocomplete";
import {
  type Diagnostic as CodeMirrorDiagnostic,
  lintGutter,
  setDiagnostics,
} from "@codemirror/lint";
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
  StateEffect,
  Transaction,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import {
  DEFAULT_KEYBINDINGS,
  type KeybindingSettings,
  matchesPointerBinding,
  primaryModifierForPlatform,
} from "../../application/commands/default-keybindings";
import type { EditorCommandOutcome } from "../../application/commands/editor-commands";
import type { Diagnostic } from "../../application/engine/contracts";
import { defaultPersistedSettings, type FormatterPreferences } from "../../application/settings/settings-schema";
import {
  DEFAULT_EDITOR_SETTINGS,
  type EditorSettings,
} from "../../application/runtime/render-settings";
import { codeEditorTheme } from "./code-editor-theme";
import {
  type EditorCommandRequest,
  editorCommandExtension,
  executeEditorCommand,
} from "./editor-command-execution";
import {
  createOpenScadCompletionSource,
  type OpenScadProjectCompletionContext,
} from "./openscad-completion";
import { openScad } from "./openscad-language";

const controlledDocumentUpdate = Annotation.define<boolean>();
const EMPTY_DIAGNOSTICS: readonly Diagnostic[] = [];
const MAX_MINIMAP_ROWS = 240;
const DEFAULT_FORMATTER_SETTINGS: Readonly<FormatterPreferences> = Object.freeze(defaultPersistedSettings().formatter);

function renderMinimap(editor: EditorView, minimap: HTMLElement): void {
  const fragment = document.createDocumentFragment();
  const lineCount = editor.state.doc.lines;
  const step = Math.max(1, Math.ceil(lineCount / MAX_MINIMAP_ROWS));
  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += step) {
    const line = editor.state.doc.line(lineNumber);
    const row = document.createElement("span");
    row.className = "cm-minimap-line";
    row.style.inlineSize = `${Math.min(100, Math.max(8, line.length * 2))}%`;
    fragment.append(row);
  }
  minimap.replaceChildren(fragment);
}

const minimapExtension = ViewPlugin.fromClass(class {
  readonly dom: HTMLDivElement;

  constructor(editor: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-minimap";
    this.dom.setAttribute("aria-hidden", "true");
    editor.dom.append(this.dom);
    renderMinimap(editor, this.dom);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) renderMinimap(update.view, this.dom);
  }

  destroy(): void {
    this.dom.remove();
  }
});

function editorSettingExtensions(settings: Readonly<EditorSettings>): Extension[] {
  return [
    EditorState.tabSize.of(settings.tabWidth),
    EditorView.editorAttributes.of({
      "data-editor-font-family": settings.fontFamily,
      "data-editor-font-size": String(settings.fontSize),
      "data-editor-line-numbers": settings.lineNumbers ? "on" : "off",
      "data-editor-minimap": settings.minimap ? "on" : "off",
      "data-editor-word-wrap": settings.wordWrap ? "on" : "off",
    }),
    settings.wordWrap ? EditorView.lineWrapping : [],
    settings.minimap ? minimapExtension : [],
    EditorView.theme({
      ".cm-scroller": {
        fontFamily: settings.fontFamily,
        fontSize: `${settings.fontSize}px`,
      },
    }),
  ];
}

export interface EditorNavigationRequest {
  requestId: number;
  line: number;
}

export interface CodeEditorProps {
  value: string;
  language?: "openscad" | "plain";
  projectCompletion?: OpenScadProjectCompletionContext;
  onChange(value: string): void;
  diagnostics?: readonly Diagnostic[];
  navigation?: EditorNavigationRequest;
  onNavigationHandled?(requestId: number): void;
  onCursorChange?(position: CursorPosition): void;
  initialSession?: CodeEditorSession;
  onSessionChange?(session: CodeEditorSession): void;
  onCommand?(outcome: EditorCommandOutcome): void;
  commandRequest?: EditorCommandRequest;
  keybindings?: KeybindingSettings;
  editorSettings?: Readonly<EditorSettings>;
  formatterSettings?: Readonly<FormatterPreferences>;
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
  projectCompletion,
  diagnostics = EMPTY_DIAGNOSTICS,
  navigation,
  onNavigationHandled,
  onCursorChange,
  initialSession,
  onSessionChange,
  onCommand,
  commandRequest,
  keybindings = DEFAULT_KEYBINDINGS,
  editorSettings = DEFAULT_EDITOR_SETTINGS,
  formatterSettings = DEFAULT_FORMATTER_SETTINGS,
  language: languageMode = "openscad",
  label,
}: CodeEditorProps) {
  const primaryModifier = primaryModifierForPlatform();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initialValue = useRef(value);
  const initialSessionRef = useRef(initialSession);
  const initialEditorSettingsRef = useRef(editorSettings);
  const initialKeybindingsRef = useRef(keybindings);
  const initialFormatterSettingsRef = useRef(formatterSettings);
  const projectCompletionContextRef = useRef<OpenScadProjectCompletionContext | undefined>(
    undefined,
  );
  const previousProjectCompletionRef = useRef(projectCompletion);
  const completionSourceRef = useRef<ReturnType<typeof createOpenScadCompletionSource> | null>(
    null,
  );
  projectCompletionContextRef.current = projectCompletion;
  completionSourceRef.current ??= createOpenScadCompletionSource(
    () => projectCompletionContextRef.current,
  );
  const editorSettingsCompartment = useRef<Compartment | null>(null);
  const editorCommandsCompartment = useRef<Compartment | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onNavigationHandledRef = useRef(onNavigationHandled);
  const onSessionChangeRef = useRef(onSessionChange);
  const onCommandRef = useRef(onCommand);
  const handledCommandRequest = useRef<number | null>(null);
  const handledNavigationRequest = useRef<number | null>(null);
  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;
  onNavigationHandledRef.current = onNavigationHandled;
  onSessionChangeRef.current = onSessionChange;
  onCommandRef.current = onCommand;

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const completionSource = completionSourceRef.current ?? createOpenScadCompletionSource(
      () => projectCompletionContextRef.current,
    );
    completionSourceRef.current = completionSource;
    const settingsCompartment = new Compartment();
    const commandsCompartment = new Compartment();
    editorSettingsCompartment.current = settingsCompartment;
    editorCommandsCompartment.current = commandsCompartment;
    const extensions = [
      basicSetup,
      languageMode === "openscad" ? openScad(completionSource) : [],
      lintGutter(),
      codeEditorTheme,
      commandsCompartment.of(editorCommandExtension(
        (command) => onCommandRef.current?.(command),
        initialKeybindingsRef.current,
        initialFormatterSettingsRef.current,
      )),
      settingsCompartment.of(editorSettingExtensions(initialEditorSettingsRef.current)),
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
      editorSettingsCompartment.current = null;
      editorCommandsCompartment.current = null;
      editor.destroy();
      completionSource.dispose();
      if (completionSourceRef.current === completionSource) completionSourceRef.current = null;
    };
  }, [label, languageMode]);

  useEffect(() => {
    if (previousProjectCompletionRef.current !== projectCompletion) {
      previousProjectCompletionRef.current = projectCompletion;
      const editor = view.current;
      if (editor) closeCompletion(editor);
    }
  }, [projectCompletion]);

  useEffect(() => {
    const editor = view.current;
    const settingsCompartment = editorSettingsCompartment.current;
    if (editor && settingsCompartment) {
      editor.dispatch({
        effects: settingsCompartment.reconfigure(editorSettingExtensions(editorSettings)),
      });
    }
  }, [editorSettings]);

  useEffect(() => {
    const editor = view.current;
    const commandsCompartment = editorCommandsCompartment.current;
    if (editor && commandsCompartment) {
      editor.dispatch({
        effects: commandsCompartment.reconfigure(editorCommandExtension(
          (command) => onCommandRef.current?.(command),
          keybindings,
          formatterSettings,
        )),
      });
    }
  }, [formatterSettings, keybindings]);

  useEffect(() => {
    const editor = view.current;
    if (
      !editor
      || !commandRequest
      || handledCommandRequest.current === commandRequest.requestId
    ) return;
    handledCommandRequest.current = commandRequest.requestId;
    onCommandRef.current?.(executeEditorCommand(
      editor,
      commandRequest.command,
      formatterSettings,
    ));
    if (!["find", "replace", "go-to-line"].includes(commandRequest.command)) editor.focus();
  }, [commandRequest, formatterSettings]);

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

  return (
    <div
      className="code-editor"
      onMouseDownCapture={(event) => {
        if (matchesPointerBinding(event, keybindings.multiCursorAdd, primaryModifier)) {
          onCommandRef.current?.({ command: "multi-cursor-add", status: "handled" });
        }
      }}
      ref={host}
    />
  );
}
