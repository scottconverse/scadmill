import type { EngineService } from "../application/engine/contracts";
import type { AiFetchFactory } from "../application/ai/ai-client";
import type { EngineLoadProgressStore } from "../application/engine/engine-load-progress";
import type { ProjectStorage } from "../application/files/project-file-service";
import type { ProjectPortabilityController } from "../application/files/project-portability";
import type { RecoveryPersistence } from "../application/files/recovery-state";
import type { ScratchAutosavePersistence } from "../application/files/scratch-autosave";
import type {
  ProjectDirectoryPicker,
  WorkspaceDirectory,
} from "../application/files/workspace-directory";
import type {
  AssociatedFileOpenSource,
  McpServerPort,
  PlatformCommandSource,
} from "../application/platform/scadmill-platform";
import type { WorkbenchRuntime } from "../application/runtime/workbench-runtime";
import type { SecretStore } from "../application/settings/secret-store";
import type { SlicerHandoffPort } from "../application/manufacturing/slicer-handoff";
import type { ThemePreference } from "../application/theme/theme-runtime";
import type { ThemeTokens } from "../application/theme/theme-schema";
import type { ClipboardWriter } from "./diagnostics/DiagnosticConsole";
import type { EngineRecoveryState } from "./engine/EngineUnavailableBanner";

export interface WorkbenchProps {
  runtime: WorkbenchRuntime;
  aiFetch?: AiFetchFactory;
  engine?: EngineService;
  secretStore?: SecretStore;
  engineLabel: string;
  engineAvailable?: boolean;
  engineChecking?: boolean;
  engineRecovery?: EngineRecoveryState;
  wasmEngineProgress?: EngineLoadProgressStore;
  wasmEngineFailureMessage?: string;
  activeTheme: ThemeTokens;
  customThemes?: readonly ThemeTokens[];
  themePreference: ThemePreference;
  showWebMenu?: boolean;
  menuCommandSource?: PlatformCommandSource;
  associatedFileOpenSource?: AssociatedFileOpenSource;
  mcpPort?: McpServerPort;
  forceNarrowLayout?: boolean;
  canRevealProjectFiles?: boolean;
  canTrashProjectFiles?: boolean;
  clipboard?: ClipboardWriter;
  projectStorage?: ProjectStorage;
  directoryPicker?: ProjectDirectoryPicker;
  workspaceDirectory?: WorkspaceDirectory;
  recoveryPersistence?: RecoveryPersistence;
  projectPortability?: ProjectPortabilityController;
  scratchAutosavePersistence?: ScratchAutosavePersistence;
  slicerHandoff?: SlicerHandoffPort;
  onThemePreferenceChange(preference: ThemePreference): void;
  configuredEnginePath?: string;
  onConfigureEnginePath?(path: string): void;
  onRetryWasmEngine?(): void;
  renderDiskCacheAvailable?: boolean;
}
