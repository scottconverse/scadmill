import { useCallback } from "react";

import type {
  RenderState,
  WorkbenchRuntime,
} from "../../application/runtime/workbench-runtime";
import type { KeybindingSettings } from "../../application/commands/default-keybindings";
import { useRenderKeybindings } from "./use-render-keybindings";

export function useWorkbenchRenderCommands(
  runtime: WorkbenchRuntime,
  engineAvailable: boolean,
  status: RenderState["status"],
  keybindings: KeybindingSettings,
) {
  const renderPreview = useCallback(() => {
    void runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
  }, [runtime]);
  const renderFull = useCallback(() => {
    void runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });
  }, [runtime]);
  const cancelRender = useCallback(() => {
    void runtime.dispatch({ kind: "cancel-render", origin: "user" });
  }, [runtime]);
  useRenderKeybindings({
    disabled: !engineAvailable || status === "rendering",
    rendering: status === "rendering",
    keybindings,
    onCancel: cancelRender,
    onPreview: renderPreview,
    onFull: renderFull,
  });
  return { renderPreview, renderFull };
}
