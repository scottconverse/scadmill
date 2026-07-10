import { useCallback, useRef, useState } from "react";

import type {
  DirectEditorCommandId,
  EditorCommandOutcome,
} from "../../application/commands/editor-commands";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import type {
  WorkspaceLayoutAction,
  WorkspaceLayoutState,
} from "../../application/layout/workspace-layout";
import { messages } from "../../messages/en";
import type { EditorCommandRequest } from "./editor-command-execution";

export function useEditorCommandCoordinator(
  runtime: WorkbenchRuntime,
  layout: WorkspaceLayoutState,
  narrow: boolean,
  dispatchLayout: (action: WorkspaceLayoutAction) => void,
) {
  const nextRequest = useRef(0);
  const [request, setRequest] = useState<EditorCommandRequest>();
  const [notice, setNotice] = useState<{ sequence: number; message: string } | null>(null);
  const requestCommand = useCallback((command: DirectEditorCommandId) => {
    const editorVisible = narrow
      ? layout.narrowView === "code"
      : layout.editorOpen && layout.maximized !== "viewer";
    if (!editorVisible) {
      if (narrow) {
        dispatchLayout({ kind: "set-narrow-view", view: "code" });
      } else {
        if (layout.maximized === "viewer") {
          dispatchLayout({ kind: "toggle-maximize", region: "viewer" });
        }
        if (!layout.editorOpen) {
          dispatchLayout({ kind: "toggle-panel", panel: "editor" });
        }
      }
    }
    setRequest({ requestId: ++nextRequest.current, command });
  }, [dispatchLayout, layout.editorOpen, layout.maximized, layout.narrowView, narrow]);
  const handleOutcome = useCallback((outcome: EditorCommandOutcome) => {
    setNotice((current) => outcome.status === "unavailable"
      ? {
          sequence: (current?.sequence ?? 0) + 1,
          message: messages.goToDefinitionUnavailable,
        }
      : null);
    void runtime.dispatch({ kind: "editor-command", origin: "user", outcome });
  }, [runtime]);
  return { handleOutcome, notice, request, requestCommand };
}
