import type { EngineService } from "../application/engine/contracts";
import type { ProjectStorage } from "../application/files/project-file-service";
import type { ProjectPortabilityController } from "../application/files/project-portability";
import type { RecoveryPersistence } from "../application/files/recovery-state";
import type { ScratchAutosavePersistence } from "../application/files/scratch-autosave";
import type { WorkbenchRuntime } from "../application/runtime/workbench-runtime";
import type { SecretStore } from "../application/settings/secret-store";
import type { ThemeTokens } from "../application/theme/theme-schema";
import type { ThemePreference } from "../application/theme/theme-runtime";
import type { EngineRecoveryState } from "./engine/EngineUnavailableBanner";

export interface WorkbenchProps {
  runtime: WorkbenchRuntime;
  engine?: EngineService;
  secretStore?: SecretStore;
  engineLabel: string;
  engineAvailable?: boolean;
  engineChecking?: boolean;
  engineRecovery?: EngineRecoveryState;
  activeTheme: ThemeTokens;
  customThemes?: readonly ThemeTokens[];
  themePreference: ThemePreference;
  showWebMenu?: boolean;
  forceNarrowLayout?: boolean;
  canRevealProjectFiles?: boolean;
  projectStorage?: ProjectStorage;
  recoveryPersistence?: RecoveryPersistence;
  projectPortability?: ProjectPortabilityController;
  scratchAutosavePersistence?: ScratchAutosavePersistence;
  onThemePreferenceChange(preference: ThemePreference): void;
  configuredEnginePath?: string;
  onConfigureEnginePath?(path: string): void;
}
