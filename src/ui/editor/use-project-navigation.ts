import { useCallback, useMemo, useRef, useState } from "react";

import type { DocumentWorkspaceState } from "../../application/documents/document-workspace";
import type { ProjectStorage } from "../../application/files/project-file-service";
import type { ProjectSessionState } from "../../application/files/project-session";
import type { ProjectTextReplacementPlan } from "../../application/navigation/project-text-search";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import type { EditorNavigationRequest } from "./CodeEditor";
import {
  findOpenScadDefinition,
  findOpenScadReferences,
  type OpenScadDefinition,
  type OpenScadReference,
  type OpenScadSourceLocation,
  outlineOpenScadFile,
} from "./openscad-navigation";

interface PendingNavigation extends EditorNavigationRequest {
  readonly documentId: string;
}

export async function loadProjectTextSources(
  project: ProjectSessionState,
  workspace: DocumentWorkspaceState,
  storage?: ProjectStorage,
): Promise<ReadonlyMap<string, string>> {
  const snapshot = storage && project.mode === "project"
    ? await storage.snapshot(project.snapshot.projectId)
    : project.snapshot;
  const files = new Map<string, string>();
  for (const [path, content] of snapshot.files) {
    if (typeof content === "string") files.set(path, content);
  }
  for (const document of workspace.documents) files.set(document.path, document.source);
  return files;
}

export interface ProjectNavigationOptions {
  readonly runtime: WorkbenchRuntime;
  readonly project: ProjectSessionState;
  readonly workspace: DocumentWorkspaceState;
  readonly activePath: string;
  readonly activeSource: string;
  readonly storage?: ProjectStorage;
}

export function useProjectNavigation({
  runtime,
  project,
  workspace,
  activePath,
  activeSource,
  storage,
}: ProjectNavigationOptions) {
  const sequence = useRef(10_000);
  const [pending, setPending] = useState<PendingNavigation>();
  const [references, setReferences] = useState<readonly OpenScadReference[]>([]);
  const outline = useMemo<readonly OpenScadDefinition[]>(() => {
    try {
      return activePath.toLowerCase().endsWith(".scad")
        ? outlineOpenScadFile(activeSource, activePath)
        : [];
    } catch {
      return [];
    }
  }, [activePath, activeSource]);

  const loadSources = useCallback(
    () => loadProjectTextSources(project, runtime.documents.getState(), storage),
    [project, runtime, storage],
  );

  const navigate = useCallback(async (target: OpenScadSourceLocation) => {
    let targetDocument = runtime.documents.getState().documents.find(({ path }) => path === target.path);
    if (!targetDocument) {
      if (!runtime.project.getState().snapshot.files.has(target.path as never) && storage) {
        await runtime.dispatch({ kind: "refresh-project", origin: "user" });
      }
      await runtime.dispatch({ kind: "open-project-file", origin: "user", path: target.path });
      targetDocument = runtime.documents.getState().documents.find(({ path }) => path === target.path);
    }
    if (!targetDocument) return;
    await runtime.dispatch({ kind: "activate-document", origin: "user", documentId: targetDocument.id });
    setPending({
      requestId: ++sequence.current,
      documentId: targetDocument.id,
      line: target.line,
      column: target.column,
      length: Math.max(0, target.to - target.from),
    });
  }, [runtime, storage]);

  const goToDefinition = useCallback((position: number) => {
    void loadSources().then((sources) => {
      const target = findOpenScadDefinition(sources, activePath, position);
      if (target) return navigate(target);
      return undefined;
    }).catch(() => undefined);
  }, [activePath, loadSources, navigate]);

  const findReferences = useCallback((path: string, position: number) => {
    void loadSources().then((sources) => {
      setReferences(findOpenScadReferences(sources, path, position));
    }).catch(() => setReferences([]));
  }, [loadSources]);

  const applyReplacements = useCallback(async (
    plan: ProjectTextReplacementPlan,
    originals: ReadonlyMap<string, string>,
  ) => {
    const openByPath = new Map(
      runtime.documents.getState().documents.map((document) => [document.path, document]),
    );
    const written: string[] = [];
    const edited: string[] = [];
    try {
      for (const file of plan.files) {
        if (openByPath.has(file.path)) continue;
        if (!storage || project.mode !== "project") {
          throw new Error(`Cannot replace closed project file ${file.path} without project storage.`);
        }
        await storage.write(project.snapshot.projectId, file.path, file.source);
        written.push(file.path);
      }
      for (const file of plan.files) {
        const document = openByPath.get(file.path);
        if (!document) continue;
        await runtime.dispatch({
          kind: "edit-document",
          origin: "user",
          documentId: document.id,
          source: file.source,
        });
        edited.push(file.path);
      }
      if (written.length > 0) {
        await runtime.dispatch({ kind: "refresh-project", origin: "user" });
      }
    } catch (error) {
      for (const path of [...edited].reverse()) {
        const document = openByPath.get(path);
        const source = originals.get(path);
        if (document && source !== undefined) {
          await runtime.dispatch({
            kind: "edit-document",
            origin: "user",
            documentId: document.id,
            source,
          }).catch(() => undefined);
        }
      }
      for (const path of [...written].reverse()) {
        const source = originals.get(path);
        if (storage && source !== undefined) {
          await storage.write(project.snapshot.projectId, path, source).catch(() => undefined);
        }
      }
      throw error;
    }
  }, [project.mode, project.snapshot.projectId, runtime, storage]);

  const completeNavigation = useCallback((requestId: number) => {
    setPending((current) => current?.requestId === requestId ? undefined : current);
  }, []);
  const activeDocumentId = workspace.activeDocumentId;
  const navigation = pending?.documentId === activeDocumentId ? pending : undefined;

  return {
    applyReplacements,
    completeNavigation,
    findReferences,
    goToDefinition,
    loadSources,
    navigate,
    navigation,
    outline,
    references,
  };
}
