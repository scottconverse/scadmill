import { useEffect, useMemo, useRef, useState } from "react";

import { activeDocument, isDocumentDirty } from "../../application/documents/document-workspace";
import type { ScratchAutosavePersistence } from "../../application/files/scratch-autosave";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import { messages } from "../../messages/en";
import { useReadonlyStore } from "../use-readonly-store";

export interface ScratchAutosaveProps {
  readonly runtime: WorkbenchRuntime;
  readonly persistence: ScratchAutosavePersistence;
  readonly delayMs?: number;
}

function loadPersistedScratch(persistence: ScratchAutosavePersistence) {
  try {
    return persistence.load();
  } catch {
    return null;
  }
}

export function ScratchAutosave({ runtime, persistence, delayMs = 500 }: ScratchAutosaveProps) {
  const projectMode = useReadonlyStore(runtime.project, (state) => state.mode);
  const workspace = useReadonlyStore(runtime.documents, (state) => state);
  const [error, setError] = useState<string | null>(null);
  const primaryScratchDocumentId = useMemo(
    () => runtime.documents.getInitialState().documents[0]?.id,
    [runtime],
  );
  const loadedPersistenceState = useMemo(
    () => ({ snapshot: loadPersistedScratch(persistence) }),
    [persistence],
  );
  const persistedScratch = useRef(loadedPersistenceState.snapshot);

  useEffect(() => {
    persistedScratch.current = loadedPersistenceState.snapshot;
    setError(null);
  }, [loadedPersistenceState]);

  useEffect(() => {
    if (projectMode !== "scratch") {
      setError(null);
      return undefined;
    }
    const document = activeDocument(workspace);
    const dirty = isDocumentDirty(document);
    if (document.id !== primaryScratchDocumentId) {
      setError(dirty ? messages.additionalScratchNotPersisted : null);
      return undefined;
    }
    const snapshot = { path: document.path, source: document.source };
    const persisted = dirty ? persistedScratch.current : loadPersistedScratch(persistence);
    if (!dirty) persistedScratch.current = persisted;
    if (!dirty && persisted?.path === snapshot.path && persisted.source === snapshot.source) {
      setError(null);
      return undefined;
    }
    setError(null);
    const timer = globalThis.setTimeout(() => {
      try {
        persistence.save(snapshot);
        persistedScratch.current = snapshot;
        if (dirty) {
          void runtime.dispatch({
            kind: "mark-document-autosaved",
            origin: "system",
            documentId: document.id,
            revision: document.revision,
            source: document.source,
          }).catch(() => setError(messages.scratchAutosaveFailed));
        }
      } catch {
        setError(messages.scratchAutosaveFailed);
      }
    }, dirty ? delayMs : 0);
    return () => globalThis.clearTimeout(timer);
  }, [delayMs, persistence, primaryScratchDocumentId, projectMode, runtime, workspace]);

  return error ? <p role="alert">{error}</p> : null;
}
