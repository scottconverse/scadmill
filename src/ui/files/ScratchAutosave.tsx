import { useEffect, useRef, useState } from "react";

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

export function ScratchAutosave({ runtime, persistence, delayMs = 500 }: ScratchAutosaveProps) {
  const projectMode = useReadonlyStore(runtime.project, (state) => state.mode);
  const workspace = useReadonlyStore(runtime.documents, (state) => state);
  const [error, setError] = useState<string | null>(null);
  const primaryScratchDocumentId = useRef(
    runtime.documents.getInitialState().documents[0]?.id,
  );

  useEffect(() => {
    if (projectMode !== "scratch") return undefined;
    const document = activeDocument(workspace);
    if (!isDocumentDirty(document)) return undefined;
    if (document.id !== primaryScratchDocumentId.current) {
      setError(messages.additionalScratchNotPersisted);
      return undefined;
    }
    setError(null);
    const timer = globalThis.setTimeout(() => {
      try {
        persistence.save(document.source);
        void runtime.dispatch({
          kind: "mark-document-autosaved",
          origin: "system",
          documentId: document.id,
          revision: document.revision,
          source: document.source,
        }).catch(() => setError(messages.scratchAutosaveFailed));
      } catch {
        setError(messages.scratchAutosaveFailed);
      }
    }, delayMs);
    return () => globalThis.clearTimeout(timer);
  }, [delayMs, persistence, projectMode, runtime, workspace]);

  return error ? <p role="alert">{error}</p> : null;
}
