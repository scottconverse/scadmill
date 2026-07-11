import type { StoreApi } from "zustand/vanilla";

import {
  reduceDocumentWorkspace,
  type DocumentWorkspaceState,
} from "../documents/document-workspace";
import type {
  ProjectSessionState,
  ProjectTransition,
} from "../files/project-session";
import type { RenderState } from "./workbench-runtime-contracts";

export interface ProjectTransitionStores {
  readonly documents: StoreApi<DocumentWorkspaceState>;
  readonly project: StoreApi<ProjectSessionState>;
  readonly render: StoreApi<RenderState>;
  cancelActiveRender(): void;
}

export function applyProjectTransition(
  transition: ProjectTransition,
  stores: ProjectTransitionStores,
): void {
  stores.project.setState(transition.project, true);
  if (transition.replacementWorkspace) {
    stores.cancelActiveRender();
    stores.documents.setState(transition.replacementWorkspace, true);
    stores.render.setState({ status: "idle" }, true);
    return;
  }
  if (transition.documentActions.length === 0) return;
  let workspace = stores.documents.getState();
  for (const action of transition.documentActions) {
    workspace = reduceDocumentWorkspace(workspace, action);
  }
  stores.documents.setState(workspace, true);
}
