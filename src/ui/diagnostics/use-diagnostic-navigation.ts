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

interface IndexedDocument {
  document: DocumentBuffer;
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
  documentsByPath: ReadonlyMap<string, IndexedDocument>,
  diagnostic: Diagnostic,
  entryFile?: string,
): DocumentBuffer | undefined {
  const path = diagnosticPath(diagnostic, entryFile);
  const target = path ? documentsByPath.get(path) : undefined;
  return target
    && diagnostic.line
    && Number.isInteger(diagnostic.line)
    && diagnostic.line > 0
    && diagnostic.line <= target.lineCount
    ? target.document
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
  const documentsByPath = useMemo(
    () => new Map(workspace.documents.map((document) => [
      document.path,
      { document, lineCount: lineCount(document.source) },
    ])),
    [workspace.documents],
  );
  const editorDiagnostics = useMemo(
    () => diagnostics.filter(
      (diagnostic) => diagnosticPath(diagnostic, entryFile) === active.path,
    ),
    [active.path, diagnostics, entryFile],
  );
  const canNavigate = useCallback(
    (diagnostic: Diagnostic) => Boolean(
      navigationTarget(documentsByPath, diagnostic, entryFile),
    ),
    [documentsByPath, entryFile],
  );
  const navigate = useCallback((diagnostic: Diagnostic) => {
    const target = navigationTarget(documentsByPath, diagnostic, entryFile);
    if (!target || !diagnostic.line) return;
    sequence.current += 1;
    const request: PendingNavigation = {
      requestId: sequence.current,
      documentId: target.id,
      line: diagnostic.line,
    };
    void runtime
      .dispatch({ kind: "activate-document", origin: "user", documentId: target.id })
      .then(() => setPending(request));
  }, [documentsByPath, entryFile, runtime]);
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
