import { redo, toggleComment, undo } from "@codemirror/commands";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type {
  DirectEditorCommandId,
  EditorCommandId,
  EditorCommandOutcome,
  EditorCommandUnavailableReason,
} from "../../application/commands/editor-commands";
import {
  type KeybindingSettings,
  matchesKeybinding,
  matchesPointerBinding,
  primaryModifierForPlatform,
} from "../../application/commands/default-keybindings";

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

const DIRECT_COMMANDS: Readonly<Record<DirectEditorCommandId, (view: EditorView) => boolean>> = {
  find: openFindPanel,
  replace: openReplacePanel,
  "go-to-line": gotoLine,
  "toggle-comment": toggleComment,
  undo,
  redo,
};

export function executeEditorCommand(
  view: EditorView,
  command: DirectEditorCommandId,
): EditorCommandOutcome {
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
          : executeEditorCommand(view, match.command));
        return true;
      },
    })),
    EditorView.clickAddsSelectionRange.of((event) =>
      matchesPointerBinding(event, keybindings.multiCursorAdd, primaryModifier)
      || (primaryModifier === "meta" ? event.metaKey : event.ctrlKey)
    ),
  ];
}
