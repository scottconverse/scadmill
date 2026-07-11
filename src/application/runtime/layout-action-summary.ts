import type { WorkspaceLayoutAction } from "../layout/workspace-layout";

export function summarizeLayoutAction(action: WorkspaceLayoutAction): string {
  switch (action.kind) {
    case "activate-rail":
      return `Activate ${action.panel} rail`;
    case "resize-panel":
      return `Resize ${action.panel}`;
    case "toggle-panel":
      return `Toggle ${action.panel}`;
    case "toggle-maximize":
      return `Toggle ${action.region} maximize`;
    case "set-narrow-view":
      return `Show ${action.view} view`;
    case "set-narrow-sheet":
      return action.sheet === null ? "Close narrow sheet" : `Show ${action.sheet} sheet`;
    case "close-narrow-dock":
      return "Close narrow dock";
    case "render-failed":
      return "Open console for render failure";
    case "render-succeeded":
      return "Keep layout after render success";
    case "reset-layout":
      return "Reset workspace layout";
  }
}
