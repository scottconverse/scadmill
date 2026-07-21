import { messages } from "../../messages/en";
import { activeDocument, isDocumentDirty } from "../documents/document-workspace";
import type { WorkbenchRuntime } from "../runtime/workbench-runtime";
import {
  createProjectPortabilityController,
  type ProjectPortabilityController,
} from "./project-portability";
import {
  createProjectSnapshot,
  type ProjectFileContent,
  type ProjectSnapshot,
} from "./project-snapshot";

export interface ImportedProjectStorage {
  replace(snapshot: ProjectSnapshot): Promise<void>;
}

export interface WorkbenchPortabilityEnvironment {
  copyText(value: string): Promise<void>;
  currentHref(): string;
  makeProjectId(): string;
}

export function portableWorkbenchSnapshot(runtime: WorkbenchRuntime): ProjectSnapshot {
  const project = runtime.project.getState().snapshot;
  const files = new Map<string, ProjectFileContent>(project.files);
  for (const document of runtime.documents.getState().documents) {
    if (typeof files.get(document.path) === "string") files.set(document.path, document.source);
  }
  return createProjectSnapshot(project.projectId, files, project.workspaceIdentity);
}

export function createWorkbenchProjectPortabilityController(
  runtime: WorkbenchRuntime,
  storage: ImportedProjectStorage | undefined,
  environment: WorkbenchPortabilityEnvironment,
): ProjectPortabilityController {
  return createProjectPortabilityController({
    artifacts: runtime.artifacts,
    projectImportAvailable: storage !== undefined,
    copyText: environment.copyText,
    currentHref: environment.currentHref,
    currentProject: () => ({
      displayName: runtime.project.getState().displayName,
      snapshot: portableWorkbenchSnapshot(runtime),
    }),
    currentSource: () => activeDocument(runtime.documents.getState()).source,
    installImportedProject: async (project) => {
      if (!storage) throw new Error(messages.projectStorageUnavailableForImport);
      if (runtime.documents.getState().documents.some(isDocumentDirty)) {
        throw new Error(messages.projectReplacementBlockedDirty);
      }
      await storage.replace(project.snapshot);
      await runtime.dispatch({
        kind: "replace-project-confirmed",
        origin: "user",
        snapshot: project.snapshot,
        displayName: project.displayName,
        entryFile: project.entryFile,
      });
    },
    makeProjectId: environment.makeProjectId,
    openSharedScratch: async (source) => {
      if (runtime.project.getState().mode !== "scratch") {
        throw new Error(messages.sharedSourceRequiresFreshScratch);
      }
      await runtime.dispatch({ kind: "new-scratch-document", origin: "system" });
      await runtime.dispatch({
        kind: "edit-document",
        origin: "system",
        documentId: activeDocument(runtime.documents.getState()).id,
        source,
      });
    },
  });
}
