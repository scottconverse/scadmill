import { useEffect, useRef } from "react";

import type { DirectEditorCommandId } from "../../application/commands/editor-commands";
import type { WorkspaceLayoutAction, WorkspaceLayoutState } from "../../application/layout/workspace-layout";
import type {
  PlatformCommandSource,
  PlatformMenuCommand,
  PlatformMenuState,
} from "../../application/platform/scadmill-platform";

interface PlatformMenuHandlers {
  readonly closeDocument: () => void;
  readonly editorCommand: (command: DirectEditorCommandId) => void;
  readonly exportModel: () => void;
  readonly layoutAction: (action: WorkspaceLayoutAction) => void;
  readonly newFile: () => void;
  readonly openProject: () => void;
  readonly renderFull: () => void;
  readonly renderPreview: () => void;
  readonly reopenDocument: () => void;
  readonly save: () => void;
  readonly saveAll: () => void;
  readonly showHelp: () => void;
}

function layoutCommand(
  command: PlatformMenuCommand,
  layout: WorkspaceLayoutState,
  narrow: boolean,
): WorkspaceLayoutAction | undefined {
  switch (command) {
    case "view.toggle-dock":
      return narrow
        ? { kind: "activate-rail", panel: layout.activeRail, narrow: true }
        : { kind: "toggle-panel", panel: "dock" };
    case "view.toggle-editor":
      return narrow
        ? { kind: "set-narrow-view", view: "code" }
        : { kind: "toggle-panel", panel: "editor" };
    case "view.toggle-viewer":
      return narrow
        ? { kind: "set-narrow-view", view: "model" }
        : { kind: "toggle-panel", panel: "viewer" };
    case "view.toggle-parameters":
      return narrow
        ? { kind: "set-narrow-sheet", sheet: layout.narrowSheet === "parameter" ? null : "parameter" }
        : { kind: "toggle-panel", panel: "parameter" };
    case "view.toggle-console":
      return narrow
        ? { kind: "set-narrow-sheet", sheet: layout.narrowSheet === "console" ? null : "console" }
        : { kind: "toggle-panel", panel: "console" };
    case "view.maximize-editor":
      return { kind: "toggle-maximize", region: "editor" };
    case "view.maximize-viewer":
      return { kind: "toggle-maximize", region: "viewer" };
    case "view.reset-layout":
      return { kind: "reset-layout" };
    default:
      return undefined;
  }
}

export function usePlatformMenuCommands(
  source: PlatformCommandSource | undefined,
  layout: WorkspaceLayoutState,
  narrow: boolean,
  handlers: PlatformMenuHandlers,
  state: PlatformMenuState,
): void {
  const current = useRef({ handlers, layout, narrow, state });
  const syncRevision = useRef(0);
  const syncQueue = useRef<Promise<void>>(Promise.resolve());
  const syncTarget = useRef({ source, state });
  current.current = { handlers, layout, narrow, state };
  useEffect(() => source?.subscribe((command) => {
    const latest = current.current;
    if (latest.state[command]?.enabled === false) return;
    const action = layoutCommand(command, latest.layout, latest.narrow);
    if (action) {
      latest.handlers.layoutAction(action);
      return;
    }
    switch (command) {
      case "file.new": latest.handlers.newFile(); break;
      case "file.open": latest.handlers.openProject(); break;
      case "file.save": latest.handlers.save(); break;
      case "file.save-all": latest.handlers.saveAll(); break;
      case "file.export": latest.handlers.exportModel(); break;
      case "file.close": latest.handlers.closeDocument(); break;
      case "file.reopen": latest.handlers.reopenDocument(); break;
      case "edit.find": latest.handlers.editorCommand("find"); break;
      case "edit.replace": latest.handlers.editorCommand("replace"); break;
      case "edit.go-to-line": latest.handlers.editorCommand("go-to-line"); break;
      case "edit.toggle-comment": latest.handlers.editorCommand("toggle-comment"); break;
      case "edit.format-document": latest.handlers.editorCommand("format-document"); break;
      case "edit.format-selection": latest.handlers.editorCommand("format-selection"); break;
      case "edit.undo": latest.handlers.editorCommand("undo"); break;
      case "edit.redo": latest.handlers.editorCommand("redo"); break;
      case "render.preview": latest.handlers.renderPreview(); break;
      case "render.full": latest.handlers.renderFull(); break;
      case "help.show": latest.handlers.showHelp(); break;
    }
  }), [source]);
  useEffect(() => {
    syncTarget.current = { source, state };
    const revision = syncRevision.current + 1;
    syncRevision.current = revision;
    syncQueue.current = syncQueue.current
      .catch(() => undefined)
      .then(async () => {
        const target = syncTarget.current;
        if (revision !== syncRevision.current || !target.source) return;
        await target.source.synchronize(target.state);
      })
      .catch(() => undefined);
  }, [source, state]);
}
