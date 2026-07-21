import {
  createDocumentWorkspace,
  type DocumentWorkspaceState,
  reduceDocumentWorkspace,
} from "../documents/document-workspace";
import { messages } from "../../messages/en";
import { validateProjectLayout } from "./project-path";
import type { RecoveryBuffer, RecoverySnapshot } from "./recovery-state";
import type { ProjectPath } from "./project-path";
import type { ProjectSnapshot } from "./project-snapshot";

export interface RecoveryRestorationPlan {
  readonly workspace: DocumentWorkspaceState;
}

interface PlannedRecoveryBuffer extends RecoveryBuffer {
  readonly path: ProjectPath;
}

function reserveDocumentId(preferred: string, used: Set<string>): string {
  if (!preferred.trim()) throw new Error(messages.recoveryInvalidDocumentIds);
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  for (let ordinal = 2; ; ordinal += 1) {
    const candidate = `${preferred}-recovery-${ordinal}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

function validatedBuffers(recovery: RecoverySnapshot): readonly PlannedRecoveryBuffer[] {
  const paths = validateProjectLayout(recovery.buffers.map(({ path }) => path));
  const documentIds = new Set<string>();
  return recovery.buffers.map((buffer, index) => {
    if (!buffer.documentId.trim() || documentIds.has(buffer.documentId)) {
      throw new Error(messages.recoveryInvalidDocumentIds);
    }
    documentIds.add(buffer.documentId);
    return { ...buffer, path: paths[index] as ProjectPath };
  });
}

function applyBuffers(
  initial: DocumentWorkspaceState,
  buffers: readonly PlannedRecoveryBuffer[],
): DocumentWorkspaceState {
  validateProjectLayout(initial.documents.map(({ path }) => path));
  const usedIds = new Set(initial.documents.map(({ id }) => id));
  let workspace = initial;
  for (const buffer of buffers) {
    let target = workspace.documents.find(({ path }) =>
      path.toLowerCase() === buffer.path.toLowerCase()
    );
    if (!target) {
      const documentId = reserveDocumentId(buffer.documentId, usedIds);
      const beforeOpen = workspace;
      workspace = reduceDocumentWorkspace(workspace, {
        kind: "open",
        document: { id: documentId, path: buffer.path, source: buffer.savedSource },
      });
      target = workspace.documents.find(({ id, path }) =>
        id === documentId && path === buffer.path
      );
      if (workspace === beforeOpen || !target) {
        throw new Error(messages.recoveryBufferCouldNotBeOpened(buffer.path));
      }
    }
    workspace = reduceDocumentWorkspace(workspace, {
      kind: "replace-from-disk",
      documentId: target.id,
      source: buffer.savedSource,
    });
    workspace = reduceDocumentWorkspace(workspace, {
      kind: "edit",
      documentId: target.id,
      source: buffer.source,
    });
  }
  validateProjectLayout(workspace.documents.map(({ path }) => path));
  return workspace;
}

function projectBuffers(
  buffers: readonly PlannedRecoveryBuffer[],
  snapshot: ProjectSnapshot,
): readonly PlannedRecoveryBuffer[] {
  const paths = new Map(
    [...snapshot.files.keys()].map((path) => [path.toLowerCase(), path] as const),
  );
  return buffers.map((buffer) => {
    const path = paths.get(buffer.path.toLowerCase());
    if (!path || typeof snapshot.files.get(path) !== "string") {
      throw new Error(messages.recoveryProjectBufferUnavailable(buffer.path));
    }
    return { ...buffer, path };
  });
}

function projectWorkspace(
  recovery: RecoverySnapshot,
  buffers: readonly PlannedRecoveryBuffer[],
  snapshot: ProjectSnapshot,
): DocumentWorkspaceState {
  if (snapshot.projectId !== recovery.projectId) {
    throw new Error(messages.recoveryProjectChanged);
  }
  const canonicalBuffers = projectBuffers(buffers, snapshot);
  const entry = canonicalBuffers.find(({ path }) => path.toLowerCase().endsWith(".scad"))?.path
    ?? [...snapshot.files].find(([path, content]) =>
      path.toLowerCase().endsWith(".scad") && typeof content === "string"
    )?.[0];
  if (!entry) throw new Error(messages.projectRequiresScadEntry);
  const entrySource = snapshot.files.get(entry);
  if (typeof entrySource !== "string") throw new Error(messages.projectRequiresScadEntry);
  const entryBuffer = canonicalBuffers.find(({ path }) => path === entry);
  const usedIds = new Set<string>();
  const entryId = reserveDocumentId(entryBuffer?.documentId ?? "recovery-entry", usedIds);
  const restored = applyBuffers(
    createDocumentWorkspace([{ id: entryId, path: entry, source: entrySource }]),
    canonicalBuffers,
  );
  const restoredEntry = restored.documents.find(({ path }) => path === entry);
  if (!restoredEntry) throw new Error(messages.projectRequiresScadEntry);
  return reduceDocumentWorkspace(restored, {
    kind: "activate",
    documentId: restoredEntry.id,
  });
}

export function planRecoveryRestoration(
  recovery: RecoverySnapshot,
  currentWorkspace: DocumentWorkspaceState,
  projectSnapshot?: ProjectSnapshot,
): RecoveryRestorationPlan {
  const buffers = validatedBuffers(recovery);
  if (recovery.projectId === "scratch") {
    return { workspace: applyBuffers(currentWorkspace, buffers) };
  }
  if (!projectSnapshot) throw new Error(messages.recoveryProjectStorageUnavailable);
  return { workspace: projectWorkspace(recovery, buffers, projectSnapshot) };
}
