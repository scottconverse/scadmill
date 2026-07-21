import { useCallback, useMemo, useRef, useState } from "react";

import {
  activeDocument,
  type DocumentBuffer,
  type DocumentWorkspaceState,
} from "../../application/documents/document-workspace";
import type { Diagnostic } from "../../application/engine/contracts";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import type { EditorNavigationRequest } from "../editor/CodeEditor";

const EMPTY_DIAGNOSTICS: readonly Diagnostic[] = [];

interface PendingNavigation extends EditorNavigationRequest {
  documentId: string;
}

interface IndexedSource {
  document?: DocumentBuffer;
  lineCount: number;
}

export interface DiagnosticNavigationOptions {
  diagnostics?: readonly Diagnostic[];
  entryFile?: string;
  runtime: WorkbenchRuntime;
  workspace: DocumentWorkspaceState;
}

function diagnosticPath(diagnostic: Diagnostic, entryFile?: string): string | undefined {
  return diagnostic.file ?? entryFile;
}

function lineCount(source: string): number {
  return source.split(/\r\n|\r|\n/u).length;
}

function navigationTarget(
  sourcesByPath: ReadonlyMap<string, IndexedSource>,
  diagnostic: Diagnostic,
  entryFile?: string,
): { readonly path: string; readonly document?: DocumentBuffer } | undefined {
  const path = diagnosticPath(diagnostic, entryFile);
  const target = path ? sourcesByPath.get(path) : undefined;
  return path
    && target
    && diagnostic.line
    && Number.isInteger(diagnostic.line)
    && diagnostic.line > 0
    && diagnostic.line <= target.lineCount
    ? { path, ...(target.document ? { document: target.document } : {}) }
    : undefined;
}

export function useDiagnosticNavigation({
  diagnostics = EMPTY_DIAGNOSTICS,
  entryFile,
  runtime,
  workspace,
}: DiagnosticNavigationOptions) {
  const active = activeDocument(workspace);
  const sequence = useRef(0);
  const [pending, setPending] = useState<PendingNavigation | null>(null);
  const sourcesByPath = useMemo(() => {
    const sources = new Map<string, IndexedSource>();
    for (const [path, content] of runtime.project.getState().snapshot.files) {
      if (typeof content === "string") sources.set(path, { lineCount: lineCount(content) });
    }
    for (const document of workspace.documents) {
      sources.set(document.path, { document, lineCount: lineCount(document.source) });
    }
    return sources;
  }, [runtime, workspace.documents]);
  const editorDiagnostics = useMemo(
    () => diagnostics.filter(
      (diagnostic) => diagnosticPath(diagnostic, entryFile) === active.path,
    ),
    [active.path, diagnostics, entryFile],
  );
  const canNavigate = useCallback(
    (diagnostic: Diagnostic) => Boolean(
      navigationTarget(sourcesByPath, diagnostic, entryFile),
    ),
    [sourcesByPath, entryFile],
  );
  const navigate = useCallback((diagnostic: Diagnostic) => {
    const target = navigationTarget(sourcesByPath, diagnostic, entryFile);
    if (!target || !diagnostic.line) return;
    sequence.current += 1;
    const requestId = sequence.current;
    void (async () => {
      if (!target.document) {
        await runtime.dispatch({ kind: "open-project-file", origin: "user", path: target.path });
      }
      const document = target.document
        ?? runtime.documents.getState().documents.find(({ path }) => path === target.path);
      if (!document) return;
      await runtime.dispatch({ kind: "activate-document", origin: "user", documentId: document.id });
      setPending({ requestId, documentId: document.id, line: diagnostic.line as number });
    })();
  }, [entryFile, runtime, sourcesByPath]);
  const completeNavigation = useCallback((requestId: number) => {
    setPending((current) => current?.requestId === requestId ? null : current);
  }, []);
  const navigation: EditorNavigationRequest | undefined = pending?.documentId === active.id
    ? { requestId: pending.requestId, line: pending.line }
    : undefined;

  return {
    canNavigate,
    completeNavigation,
    editorDiagnostics,
    navigate,
    navigation,
  };
}
