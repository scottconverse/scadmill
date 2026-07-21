import type { ProjectStorage } from "../../application/files/project-file-service";
import type { ProjectPortabilityController } from "../../application/files/project-portability";
import type { RecoveryPersistence } from "../../application/files/recovery-state";
import type { ScratchAutosavePersistence } from "../../application/files/scratch-autosave";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import {
  ProjectLifecycleControls,
  type ProjectOpenRequest,
} from "./ProjectLifecycleControls";
import { ProjectPortabilityPanel } from "./ProjectPortabilityPanel";
import { ScratchAutosave } from "./ScratchAutosave";

export interface ProjectSessionHostProps {
  readonly runtime: WorkbenchRuntime;
  readonly storage?: ProjectStorage;
  readonly recoveryPersistence?: RecoveryPersistence;
  readonly portability?: ProjectPortabilityController;
  readonly scratchAutosavePersistence?: ScratchAutosavePersistence;
  readonly requestedProject?: ProjectOpenRequest;
  readonly onRequestedProjectSettled?: (sequence: number) => void;
  readonly onRecoveryPendingChange?: (pending: boolean) => void;
  readonly onSaveAll?: () => void;
  readonly saveAllDisabled?: boolean;
  readonly saveAllUnavailableReason?: string;
}

export function ProjectSessionHost({
  runtime,
  storage,
  recoveryPersistence,
  portability,
  scratchAutosavePersistence,
  requestedProject,
  onRequestedProjectSettled,
  onRecoveryPendingChange,
  onSaveAll,
  saveAllDisabled,
  saveAllUnavailableReason,
}: ProjectSessionHostProps) {
  return (
    <>
      <ProjectLifecycleControls
        recoveryPersistence={recoveryPersistence}
        onRecoveryPendingChange={onRecoveryPendingChange}
        requestedProject={requestedProject}
        onRequestedProjectSettled={onRequestedProjectSettled}
        onSaveAll={onSaveAll}
        runtime={runtime}
        showOpenControls={false}
        storage={storage}
        saveAllDisabled={saveAllDisabled}
        saveAllUnavailableReason={saveAllUnavailableReason}
      />
      {portability && (
        <ProjectPortabilityPanel controller={portability} showActions={false} />
      )}
      {scratchAutosavePersistence && (
        <ScratchAutosave persistence={scratchAutosavePersistence} runtime={runtime} />
      )}
    </>
  );
}
