import { useCallback, useRef, useState } from "react";

import {
  activeDocument,
  isDocumentDirty,
  type DocumentWorkspaceState,
} from "../../application/documents/document-workspace";
import type { ProjectSessionState } from "../../application/files/project-session";
import type { ScratchAutosavePersistence } from "../../application/files/scratch-autosave";
import type {
  ProjectDirectoryPicker,
  ProjectLocation,
} from "../../application/files/workspace-directory";
import type {
  WorkspaceLayoutAction,
  WorkspaceLayoutState,
} from "../../application/layout/workspace-layout";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import { messages } from "../../messages/en";

export interface FileCommandCoordinator {
  readonly requestedExport?: number;
  readonly requestedNewFile?: number;
  readonly notice: string | null;
  readonly saveDisabled: boolean;
  readonly saveAllDisabled: boolean;
  readonly saveUnavailableReason?: string;
  readonly saveAllUnavailableReason?: string;
  exportModel(): void;
  newFile(): void;
  openProject(): void;
  save(): void;
  saveAll(): void;
}

export interface FileCommandOptions {
  readonly runtime: WorkbenchRuntime;
  readonly workspace: DocumentWorkspaceState;
  readonly projectMode: ProjectSessionState["mode"];
  readonly scratchPersistence?: ScratchAutosavePersistence;
  readonly layout: WorkspaceLayoutState;
  readonly narrow: boolean;
  readonly onLayoutAction: (action: WorkspaceLayoutAction) => void;
  readonly directoryPicker?: ProjectDirectoryPicker;
  readonly onProjectSelected?: (selection: ProjectLocation) => void;
}

export function useFileCommands(options: FileCommandOptions): FileCommandCoordinator {
  const [requestedExport, setRequestedExport] = useState<number>();
  const [requestedNewFile, setRequestedNewFile] = useState<number>();
  const [notice, setNotice] = useState<string | null>(null);
  const primaryScratchDocumentId = useRef(
    options.runtime.documents.getInitialState().documents[0]?.id,
  );
  const openFiles = useCallback(() => {
    setNotice(null);
    if (options.narrow) {
      if (options.layout.narrowSheet !== null) {
        options.onLayoutAction({ kind: "set-narrow-sheet", sheet: null });
      }
      if (options.layout.activeRail !== "files" || !options.layout.narrowDockOpen) {
        options.onLayoutAction({ kind: "activate-rail", panel: "files", narrow: true });
      }
      return;
    }
    if (options.layout.maximized !== null) {
      options.onLayoutAction({ kind: "toggle-maximize", region: options.layout.maximized });
    }
    if (options.layout.activeRail !== "files" || !options.layout.dockOpen) {
      options.onLayoutAction({ kind: "activate-rail", panel: "files", narrow: options.narrow });
    }
  }, [options.layout, options.narrow, options.onLayoutAction]);
  const saveDocument = useCallback(async (documentId: string) => {
    const document = options.runtime.documents.getState().documents.find(({ id }) => id === documentId);
    if (!document || !isDocumentDirty(document)) return;
    if (options.projectMode === "project") {
      await options.runtime.dispatch({ kind: "save-document", origin: "user", documentId });
      return;
    }
    if (!options.scratchPersistence) throw new Error(messages.scratchSaveUnavailable);
    if (documentId !== primaryScratchDocumentId.current) {
      throw new Error(messages.additionalScratchNotPersisted);
    }
    options.scratchPersistence.save(document.source);
    await options.runtime.dispatch({
      kind: "mark-document-autosaved",
      origin: "user",
      documentId,
      revision: document.revision,
      source: document.source,
    });
  }, [options.projectMode, options.runtime, options.scratchPersistence]);
  const run = useCallback((operation: () => Promise<void>) => {
    setNotice(null);
    void operation().catch((reason: unknown) => {
      setNotice(reason instanceof Error
        ? messages.fileCommandFailedWithDetail(reason.message)
        : messages.fileCommandFailedWithDetail(messages.projectActionFailed));
    });
  }, []);
  const currentDocument = activeDocument(options.workspace);
  const dirtyDocuments = options.workspace.documents.filter(isDocumentDirty);
  const additionalDirtyScratch = options.projectMode === "scratch"
    && dirtyDocuments.some(({ id }) => id !== primaryScratchDocumentId.current);
  const scratchUnavailable = options.projectMode === "scratch" && !options.scratchPersistence;
  const currentScratchUnsupported = options.projectMode === "scratch"
    && currentDocument.id !== primaryScratchDocumentId.current;
  return {
    requestedExport,
    requestedNewFile,
    notice,
    saveDisabled: !isDocumentDirty(currentDocument) || scratchUnavailable || currentScratchUnsupported,
    saveAllDisabled: dirtyDocuments.length === 0 || scratchUnavailable || additionalDirtyScratch,
    saveUnavailableReason: scratchUnavailable
      ? messages.scratchSaveUnavailable
      : currentScratchUnsupported ? messages.additionalScratchNotPersisted : undefined,
    saveAllUnavailableReason: scratchUnavailable
      ? messages.scratchSaveUnavailable
      : additionalDirtyScratch ? messages.scratchSaveAllUnavailable : undefined,
    save: () => run(() => saveDocument(options.workspace.activeDocumentId)),
    saveAll: () => run(async () => {
      const documents = options.runtime.documents.getState().documents.filter(isDocumentDirty);
      if (options.projectMode === "scratch" && documents.some(
        ({ id }) => id !== primaryScratchDocumentId.current,
      )) {
        throw new Error(messages.scratchSaveAllUnavailable);
      }
      for (const document of documents) {
        await saveDocument(document.id);
      }
    }),
    newFile: () => {
      if (options.projectMode === "scratch") {
        run(() => options.runtime.dispatch({ kind: "new-scratch-document", origin: "user" }));
        return;
      }
      openFiles();
      setRequestedNewFile((sequence) => (sequence ?? 0) + 1);
    },
    openProject: () => {
      openFiles();
      if (!options.directoryPicker) return;
      run(async () => {
        const selection = await options.directoryPicker?.chooseDirectory();
        if (selection) options.onProjectSelected?.(selection);
      });
    },
    exportModel: () => {
      openFiles();
      setRequestedExport((sequence) => (sequence ?? 0) + 1);
    },
  };
}
