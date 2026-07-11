import { useCallback } from "react";

import { activeDocument } from "../../application/documents/document-workspace";
import type { EngineService, ExportFormat } from "../../application/engine/contracts";
import type { ProjectStorage } from "../../application/files/project-file-service";
import type { ProjectPortabilityController } from "../../application/files/project-portability";
import type { RecoveryPersistence } from "../../application/files/recovery-state";
import type {
  ProjectDirectoryPicker,
  WorkspaceDirectory,
} from "../../application/files/workspace-directory";
import { startWorkbenchProjectExport } from "../../application/files/workbench-project-export";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import { messages } from "../../messages/en";
import { useReadonlyStore } from "../use-readonly-store";
import { ProjectExportDialog } from "./ProjectExportDialog";
import { ProjectPanel } from "./ProjectPanel";
import { ProjectPortabilityPanel } from "./ProjectPortabilityPanel";

export interface FilesActivityProps {
  readonly runtime: WorkbenchRuntime;
  readonly engine?: EngineService;
  readonly storage?: ProjectStorage;
  readonly recoveryPersistence?: RecoveryPersistence;
  readonly portability?: ProjectPortabilityController;
  readonly canReveal?: boolean;
  readonly requestedExport?: number;
  readonly requestedNewFile?: number;
  readonly projectTransitionsBlocked?: boolean;
  readonly directoryPicker?: ProjectDirectoryPicker;
  readonly workspaceDirectory?: WorkspaceDirectory;
}

export function FilesActivity({
  runtime,
  engine,
  storage,
  recoveryPersistence,
  portability,
  canReveal,
  requestedExport,
  requestedNewFile,
  projectTransitionsBlocked,
  directoryPicker,
  workspaceDirectory,
}: FilesActivityProps) {
  const document = useReadonlyStore(runtime.documents, activeDocument);
  const renderResult = useReadonlyStore(runtime.render, (state) => state.result);
  const startExport = useCallback((format: ExportFormat) => {
    if (!engine) throw new Error(messages.engineUnavailable);
    return startWorkbenchProjectExport(runtime, engine, format);
  }, [engine, runtime]);
  const destinationDescription = runtime.artifacts.kind === "browser-downloads"
    ? messages.projectExportDestinationBrowser
    : runtime.artifacts.kind === "desktop-downloads"
      ? messages.projectExportDestinationDesktop
      : runtime.artifacts.available
        ? messages.projectExportDestinationCustom
        : messages.projectExportDestinationUnavailable;

  return (
    <>
      <ProjectPanel
        canReveal={canReveal}
        recoveryPersistence={recoveryPersistence}
        projectTransitionsBlocked={projectTransitionsBlocked}
        requestedNewFile={requestedNewFile}
        directoryPicker={directoryPicker}
        runtime={runtime}
        storage={storage}
        workspaceDirectory={workspaceDirectory}
      />
      {engine && (
        <ProjectExportDialog
          destinationDescription={destinationDescription}
          entryFile={document.path}
          modelKind={renderResult?.kind === "2d" ? "2d" : "3d"}
          openRequest={requestedExport}
          startExport={startExport}
        />
      )}
      {!engine && <p>{messages.projectExportRequiresEngine}</p>}
      {portability && (
        <ProjectPortabilityPanel
          controller={portability}
          handleStartupShare={false}
        />
      )}
    </>
  );
}
