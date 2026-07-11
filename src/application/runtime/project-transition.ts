import type { StoreApi } from "zustand/vanilla";

import {
  reduceDocumentWorkspace,
  type DocumentWorkspaceState,
} from "../documents/document-workspace";
import { createParameterState, type ParameterState } from "../parameters/parameter-state";
import type {
  ProjectSessionState,
  ProjectTransition,
} from "../files/project-session";
import type { RenderState } from "./workbench-runtime-contracts";
import { createViewerState, type ViewerState } from "../viewer/viewer-state";

export interface ProjectTransitionStores {
  readonly documents: StoreApi<DocumentWorkspaceState>;
  readonly parameters: StoreApi<ParameterState>;
  readonly project: StoreApi<ProjectSessionState>;
  readonly render: StoreApi<RenderState>;
  readonly viewer: StoreApi<ViewerState>;
  cancelActiveRender(): void;
  syncParameterDocuments(workspace: DocumentWorkspaceState): void;
}

export function applyProjectTransition(
  transition: ProjectTransition,
  stores: ProjectTransitionStores,
): void {
  stores.project.setState(transition.project, true);
  if (transition.replacementWorkspace) {
    stores.cancelActiveRender();
    stores.documents.setState(transition.replacementWorkspace, true);
    stores.parameters.setState(createParameterState(
      transition.replacementWorkspace.documents.map((document) => ({
        documentId: document.id,
        revision: document.revision,
        source: document.source,
      })),
    ), true);
    stores.render.setState({ status: "idle" }, true);
    stores.viewer.setState(createViewerState(), true);
    return;
  }
  if (transition.documentActions.length === 0) return;
  let workspace = stores.documents.getState();
  for (const action of transition.documentActions) {
    workspace = reduceDocumentWorkspace(workspace, action);
  }
  stores.documents.setState(workspace, true);
  stores.syncParameterDocuments(workspace);
}
