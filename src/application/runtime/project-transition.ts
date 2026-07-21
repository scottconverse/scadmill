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
  if (transition.replacementWorkspace) {
    const parameters = createParameterState(
      transition.replacementWorkspace.documents.map((document) => ({
        documentId: document.id,
        revision: document.revision,
        source: document.source,
      })),
    );
    const viewer = createViewerState();
    stores.cancelActiveRender();
    stores.project.setState(transition.project, true);
    stores.documents.setState(transition.replacementWorkspace, true);
    stores.parameters.setState(parameters, true);
    stores.render.setState({ status: "idle" }, true);
    stores.viewer.setState(viewer, true);
    return;
  }
  stores.project.setState(transition.project, true);
  if (transition.documentActions.length === 0) return;
  let workspace = stores.documents.getState();
  for (const action of transition.documentActions) {
    workspace = reduceDocumentWorkspace(workspace, action);
  }
  stores.documents.setState(workspace, true);
  stores.syncParameterDocuments(workspace);
}
