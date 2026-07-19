import { toggleComment } from "@codemirror/commands";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import { type Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  type KeybindingSettings,
  matchesKeybinding,
  matchesPointerBinding,
  primaryModifierForPlatform,
} from "../../application/commands/default-keybindings";
import type {
  DirectEditorCommandId,
  EditorCommandId,
  EditorCommandOutcome,
  EditorCommandUnavailableReason,
} from "../../application/commands/editor-commands";
import type { FormatterPreferences } from "../../application/settings/settings-schema";
import { formatOpenScad } from "./openscad-formatter";

export interface EditorCommandRequest {
  requestId: number;
  command: DirectEditorCommandId;
}

function openFindPanel(view: EditorView): boolean {
  const opened = openSearchPanel(view);
  globalThis.queueMicrotask(() => {
    view.dom.querySelector<HTMLInputElement>('.cm-search input[name="search"]')?.focus();
  });
  return opened;
}

function openReplacePanel(view: EditorView): boolean {
  const opened = openSearchPanel(view);
  globalThis.queueMicrotask(() => {
    view.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')?.focus();
  });
  return opened;
}

type BasicEditorCommandId = Exclude<
  DirectEditorCommandId,
  "format-document" | "format-selection" | "undo" | "redo"
>;

const DIRECT_COMMANDS: Readonly<Record<BasicEditorCommandId, (view: EditorView) => boolean>> = {
  find: openFindPanel,
  replace: openReplacePanel,
  "go-to-line": gotoLine,
  "toggle-comment": toggleComment,
};

function executeFormatCommand(
  view: EditorView,
  command: "format-document" | "format-selection",
  formatter: Readonly<FormatterPreferences>,
): EditorCommandOutcome {
  const selection = view.state.selection.main;
  const selectionOnly = command === "format-selection";
  if (selectionOnly && selection.empty) return { command, status: "handled" };
  const from = selectionOnly ? selection.from : 0;
  const to = selectionOnly ? selection.to : view.state.doc.length;
  const source = view.state.doc.sliceString(from, to);
  const result = formatOpenScad(source, formatter);
  if (result.status === "refused") {
    return { command, status: "unavailable", reason: "syntax-error" };
  }
  let replacement = result.source;
  if (selectionOnly) {
    const line = view.state.doc.lineAt(from);
    const prefix = view.state.doc.sliceString(line.from, from);
    const selectedIndent = source.match(/^[\t ]*/u)?.[0] ?? "";
    if (/^[\t ]*$/u.test(prefix) && prefix !== "") {
      replacement = replacement.replaceAll("\n", `\n${prefix}`);
    } else if (from === line.from && selectedIndent !== "") {
      replacement = replacement
        .split("\n")
        .map((formattedLine) => `${selectedIndent}${formattedLine}`)
        .join("\n");
    }
  }
  if (replacement !== source) {
    view.dispatch({
      changes: { from, to, insert: replacement },
      selection: selectionOnly
        ? { anchor: from, head: from + replacement.length }
        : undefined,
    });
  }
  return { command, status: "handled" };
}

export function executeEditorCommand(
  view: EditorView,
  command: DirectEditorCommandId,
  formatter: Readonly<FormatterPreferences>,
): EditorCommandOutcome {
  if (command === "undo" || command === "redo") {
    return { command, status: "handled" };
  }
  if (command === "format-document" || command === "format-selection") {
    return executeFormatCommand(view, command, formatter);
  }
  DIRECT_COMMANDS[command](view);
  return { command, status: "handled" };
}

type EditorCommandBinding =
  | { command: DirectEditorCommandId; binding: string }
  | {
      command: EditorCommandId;
      binding: string;
      unavailableReason: EditorCommandUnavailableReason;
    };

export function editorCommandExtension(
  onCommand: (outcome: EditorCommandOutcome) => void,
  keybindings: KeybindingSettings,
  formatter: Readonly<FormatterPreferences>,
): Extension {
  const primaryModifier = primaryModifierForPlatform();
  const commands: readonly EditorCommandBinding[] = [
    { command: "find", binding: keybindings.find },
    { command: "replace", binding: keybindings.replace },
    { command: "go-to-line", binding: keybindings.goToLine },
    {
      command: "go-to-definition",
      binding: keybindings.goToDefinition,
      unavailableReason: "project-symbol-navigation-unavailable",
    },
    { command: "toggle-comment", binding: keybindings.toggleComment },
    { command: "format-document", binding: keybindings.formatDocument },
    { command: "redo", binding: keybindings.redoAlternate },
    { command: "undo", binding: keybindings.undo },
    { command: "redo", binding: keybindings.redo },
  ];
  return [
    Prec.highest(EditorView.domEventHandlers({
      keydown(event, view) {
        const match = commands.find(({ binding }) =>
          matchesKeybinding(event, binding, primaryModifier)
        );
        if (!match) return false;
        event.preventDefault();
        onCommand("unavailableReason" in match
          ? {
              command: match.command,
              status: "unavailable",
              reason: match.unavailableReason,
            }
          : executeEditorCommand(view, match.command, formatter));
        return true;
      },
    })),
    EditorView.clickAddsSelectionRange.of((event) =>
      matchesPointerBinding(event, keybindings.multiCursorAdd, primaryModifier)
      || (primaryModifier === "meta" ? event.metaKey : event.ctrlKey)
    ),
  ];
}
