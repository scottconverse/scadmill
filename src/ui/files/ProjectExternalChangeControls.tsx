import { useCallback, useEffect, useRef, useState } from "react";

import type { DocumentBuffer } from "../../application/documents/document-workspace";
import {
  detectExternalChange,
  resolveExternalChange,
  type ExternalChange,
} from "../../application/files/external-change";
import type { ProjectStorage } from "../../application/files/project-file-service";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import { messages } from "../../messages/en";

interface PendingExternalChange {
  readonly projectId: string;
  readonly documentId: string;
  readonly path: string;
  readonly change: ExternalChange;
}

export interface ProjectExternalChangeControlsProps {
  readonly runtime: WorkbenchRuntime;
  readonly storage: ProjectStorage;
  readonly projectId: string;
  readonly documents: readonly DocumentBuffer[];
  readonly pollIntervalMs: number;
}

function failureMessage(reason: unknown): string {
  return reason instanceof Error
    ? messages.projectActionFailedWithDetail(reason.message)
    : messages.projectActionFailed;
}

export function ProjectExternalChangeControls({
  runtime,
  storage,
  projectId,
  documents,
  pollIntervalMs,
}: ProjectExternalChangeControlsProps) {
  const [external, setExternal] = useState<PendingExternalChange | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkInFlight = useRef(false);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const currentExternal = external?.projectId === projectId ? external : null;

  const checkExternalChanges = useCallback(async () => {
    const read = storage.read;
    if (!read || currentExternal || checkInFlight.current) return;
    checkInFlight.current = true;
    try {
      for (const document of documents) {
        const diskSource = await read(projectId, document.path);
        if (projectIdRef.current !== projectId) return;
        const change = detectExternalChange(document.savedSource, document.source, diskSource);
        if (change) {
          setExternal({ projectId, documentId: document.id, path: document.path, change });
          setShowDiff(false);
          return;
        }
      }
    } finally {
      checkInFlight.current = false;
    }
  }, [currentExternal, documents, projectId, storage]);

  useEffect(() => {
    setExternal((pending) => pending?.projectId === projectId ? pending : null);
    setShowDiff(false);
    setError(null);
  }, [projectId]);

  useEffect(() => {
    const report = (reason: unknown) => setError(failureMessage(reason));
    const interval = globalThis.setInterval(() => {
      void checkExternalChanges().catch(report);
    }, pollIntervalMs);
    const onFocus = () => void checkExternalChanges().catch(report);
    globalThis.addEventListener?.("focus", onFocus);
    return () => {
      globalThis.clearInterval(interval);
      globalThis.removeEventListener?.("focus", onFocus);
    };
  }, [checkExternalChanges, pollIntervalMs]);

  const run = (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void operation().catch((reason: unknown) => {
      setError(failureMessage(reason));
    }).finally(() => setBusy(false));
  };

  const resolveExternal = (choice: "reload" | "keep") => {
    if (!currentExternal) return;
    const pending = currentExternal;
    run(async () => {
      const isCurrentProject = () =>
        projectIdRef.current === pending.projectId
        && runtime.project.getState().snapshot.projectId === pending.projectId;
      if (!isCurrentProject()) return;
      if (pending.change.kind !== "modified") {
        if (choice !== "keep") return;
        await storage.write(pending.projectId, pending.path, pending.change.localSource);
        if (!isCurrentProject()) return;
        await runtime.dispatch({ kind: "refresh-project", origin: "system" });
        if (!isCurrentProject()) return;
        await runtime.dispatch({
          kind: "resolve-external-change",
          origin: "user",
          documentId: pending.documentId,
          diskSource: pending.change.localSource,
          choice: "reload",
        });
      } else {
        await runtime.dispatch({ kind: "refresh-project", origin: "system" });
        if (!isCurrentProject()) return;
        await runtime.dispatch({
          kind: "resolve-external-change",
          origin: "user",
          documentId: pending.documentId,
          diskSource: pending.change.diskSource,
          choice,
        });
      }
      setExternal(null);
      setShowDiff(false);
    });
  };

  const externalDiff = currentExternal?.change.kind === "modified" && showDiff
    ? resolveExternalChange(currentExternal.change, "diff")
    : null;
  const message = currentExternal?.change.kind === "deleted"
    ? messages.externalDeletionMessage(currentExternal.path)
    : currentExternal?.change.kind === "type-changed"
      ? messages.externalTypeChangeMessage(currentExternal.path)
      : currentExternal
        ? messages.externalChangeMessage(currentExternal.path)
        : null;

  return (
    <>
      <button disabled={busy} onClick={() => run(checkExternalChanges)} type="button">
        {messages.checkExternalChanges}
      </button>
      {currentExternal && (
        <div aria-label={messages.externalChangeTitle} role="alertdialog">
          <p>{message}</p>
          {currentExternal.change.kind === "modified" && (
            <button disabled={busy} onClick={() => resolveExternal("reload")} type="button">
              {messages.reloadExternalChange}
            </button>
          )}
          <button disabled={busy} onClick={() => resolveExternal("keep")} type="button">
            {messages.keepExternalChange}
          </button>
          {currentExternal.change.kind === "modified" && (
            <button onClick={() => setShowDiff((visible) => !visible)} type="button">
              {showDiff ? messages.hideExternalDiff : messages.showExternalDiff}
            </button>
          )}
          {externalDiff && (
            <div className="external-change-diff">
              <section><h4>{messages.localVersion}</h4><pre>{externalDiff.before}</pre></section>
              <section><h4>{messages.diskVersion}</h4><pre>{externalDiff.after}</pre></section>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
