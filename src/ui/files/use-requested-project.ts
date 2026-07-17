import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";

import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import type { ProjectOpenRequest } from "./ProjectLifecycleControls";
import type { PendingProject } from "./ProjectReplacementDialog";

interface RequestedProjectOptions {
  readonly busy: boolean;
  readonly hasDirtyDocuments: boolean;
  readonly inspectProject: (
    projectId: string,
    displayName?: string,
    preferredEntryFile?: string,
  ) => Promise<PendingProject>;
  readonly onSettled?: (sequence: number) => void;
  readonly request?: ProjectOpenRequest;
  readonly run: (operation: () => Promise<unknown>) => Promise<boolean>;
  readonly runtime: WorkbenchRuntime;
  readonly setPendingProject: Dispatch<SetStateAction<PendingProject | null>>;
  readonly transitionsBlocked: boolean;
}

export function useRequestedProject({
  busy, hasDirtyDocuments, inspectProject, onSettled, request, run, runtime,
  setPendingProject, transitionsBlocked,
}: RequestedProjectOptions): void {
  const handledRequest = useRef<number | null>(null);
  useEffect(() => {
    if (busy || transitionsBlocked || !request || handledRequest.current === request.sequence) return;
    handledRequest.current = request.sequence;
    void run(async () => {
      const inspected = await inspectProject(
        request.projectId,
        request.displayName,
        request.preferredEntryFile,
      );
      if (!request.openWhenClean || hasDirtyDocuments) return;
      const selectedEntry = request.preferredEntryFile ?? inspected.entries[0];
      if (!selectedEntry) return;
      await runtime.dispatch({
        kind: "replace-project-confirmed",
        origin: "user",
        snapshot: inspected.snapshot,
        displayName: inspected.displayName,
        entryFile: selectedEntry,
      });
      setPendingProject(null);
      onSettled?.(request.sequence);
    }).then((succeeded) => {
      if (!succeeded) onSettled?.(request.sequence);
    });
  }, [
    busy, hasDirtyDocuments, inspectProject, onSettled, request, run, runtime,
    setPendingProject, transitionsBlocked,
  ]);
}
