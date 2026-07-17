import type { EngineService } from "../../src/application/engine/contracts";
import type { EngineLoadProgressStore } from "../../src/application/engine/engine-load-progress";
import type { EnginePathConfiguration } from "../../src/application/engine/engine-path-configuration";
import { type ArtifactDestination, UNAVAILABLE_ARTIFACT_DESTINATION } from "../../src/application/files/artifact-destination";
import type { ProjectStorage } from "../../src/application/files/project-file-service";
import { EPHEMERAL_RECENT_PROJECTS_PERSISTENCE, type RecentProjectsPersistence } from "../../src/application/files/recent-projects";
import type { RecoveryPersistence } from "../../src/application/files/recovery-state";
import type { ScratchAutosavePersistence } from "../../src/application/files/scratch-autosave";
import type { ImportedProjectStorage } from "../../src/application/files/workbench-portability";
import type { ProjectDirectoryPicker, WorkspaceDirectory } from "../../src/application/files/workspace-directory";
import { available, type AssociatedFileOpenSource, type ScadMillPlatform, unavailable } from "../../src/application/platform/scadmill-platform";
import { EPHEMERAL_WORKSPACE_LAYOUT_PERSISTENCE, type WorkspaceLayoutPersistence } from "../../src/application/runtime/layout-persistence";
import { EPHEMERAL_SECRET_STORE, type SecretStore } from "../../src/application/settings/secret-store";
import { EPHEMERAL_SETTINGS_PERSISTENCE, type SettingsPersistence } from "../../src/application/settings/settings-persistence";
import { EPHEMERAL_WORKSPACE_METADATA_PERSISTENCE, type WorkspaceMetadataPersistence } from "../../src/application/viewer/annotation-persistence";
import { HIDDEN_WELCOME_PREFERENCE, type WelcomePreferencePersistence } from "../../src/application/welcome/welcome-preference";
import { EPHEMERAL_RENDER_DISK_CACHE_PREFERENCES, type RenderDiskCachePreferencePersistence } from "../../src/application/render-cache/render-cache-preference";

const EMPTY_RECOVERY: RecoveryPersistence = {
  load: () => null,
  save: () => undefined,
  clear: () => undefined,
};
const EMPTY_SCRATCH: ScratchAutosavePersistence = {
  load: () => null,
  save: () => undefined,
};

export interface TestPlatformOverrides {
  readonly kind?: "web" | "desktop";
  readonly layoutPersistence?: WorkspaceLayoutPersistence;
  readonly settingsPersistence?: SettingsPersistence;
  readonly secretStore?: SecretStore;
  readonly showWebMenu?: boolean;
  readonly forceNarrowLayout?: boolean;
  readonly canRevealProjectFiles?: boolean;
  readonly canTrashProjectFiles?: boolean;
  readonly associatedFileOpenSource?: AssociatedFileOpenSource;
  readonly projectStorage?: ProjectStorage;
  readonly directoryPicker?: ProjectDirectoryPicker;
  readonly workspaceDirectory?: WorkspaceDirectory;
  readonly artifactDestination?: ArtifactDestination;
  readonly recoveryPersistence?: RecoveryPersistence;
  readonly recentProjectsPersistence?: RecentProjectsPersistence;
  readonly projectPortabilityStorage?: ImportedProjectStorage;
  readonly scratchAutosavePersistence?: ScratchAutosavePersistence;
  readonly workspaceMetadataPersistence?: WorkspaceMetadataPersistence;
  readonly enginePathConfiguration?: EnginePathConfiguration;
  readonly welcomePreferencePersistence?: WelcomePreferencePersistence;
  readonly wasmEngineProgress?: EngineLoadProgressStore;
  readonly onRetryWasmEngine?: () => void;
  readonly renderDiskCachePreferencePersistence?: RenderDiskCachePreferencePersistence;
}

export function createTestPlatform(
  engine: EngineService,
  overrides: TestPlatformOverrides = {},
): ScadMillPlatform {
  const directoryPicker = overrides.directoryPicker
    ? available(overrides.directoryPicker)
    : unavailable<ProjectDirectoryPicker>();
  const wasm = overrides.wasmEngineProgress && overrides.onRetryWasmEngine
    ? available({
        progress: overrides.wasmEngineProgress,
        clearProgress: overrides.onRetryWasmEngine,
      })
    : unavailable<never>();
  return {
    kind: overrides.kind ?? "web",
    engine,
    files: {
      projectStorage: overrides.projectStorage,
      portabilityStorage: overrides.projectPortabilityStorage,
      workspaceDirectory: overrides.workspaceDirectory,
      directoryPicker,
      revealInOs: overrides.canRevealProjectFiles ? available(true) : unavailable(),
      trashInOs: overrides.canTrashProjectFiles ? available(true) : unavailable(),
      fileAssociations: overrides.associatedFileOpenSource
        ? available(overrides.associatedFileOpenSource)
        : unavailable(),
      slicerHandoff: unavailable(),
    },
    dialogs: {
      openDirectory: directoryPicker,
      saveFile: unavailable(),
      message: unavailable(),
    },
    menus: { presentation: overrides.showWebMenu === false ? "native" : "web", commands: unavailable() },
    clipboard: { writeText: async () => undefined },
    location: {
      currentHref: () => "https://example.test/scadmill",
      makeProjectId: () => "test-import-project",
    },
    persistence: {
      layout: overrides.layoutPersistence ?? EPHEMERAL_WORKSPACE_LAYOUT_PERSISTENCE,
      settings: overrides.settingsPersistence ?? EPHEMERAL_SETTINGS_PERSISTENCE,
      secrets: overrides.secretStore ?? EPHEMERAL_SECRET_STORE,
      recovery: overrides.recoveryPersistence ?? EMPTY_RECOVERY,
      recentProjects: overrides.recentProjectsPersistence ?? EPHEMERAL_RECENT_PROJECTS_PERSISTENCE,
      scratchAutosave: overrides.scratchAutosavePersistence ?? EMPTY_SCRATCH,
      workspaceMetadata: overrides.workspaceMetadataPersistence ?? EPHEMERAL_WORKSPACE_METADATA_PERSISTENCE,
      welcome: overrides.welcomePreferencePersistence ?? HIDDEN_WELCOME_PREFERENCE,
      renderCache: unavailable(),
      renderCachePreferences: overrides.renderDiskCachePreferencePersistence ?? EPHEMERAL_RENDER_DISK_CACHE_PREFERENCES,
    },
    artifacts: overrides.artifactDestination ?? UNAVAILABLE_ARTIFACT_DESTINATION,
    enginePathConfiguration: overrides.enginePathConfiguration
      ? available(overrides.enginePathConfiguration)
      : unavailable(),
    wasm,
    mcp: unavailable(),
    windowControls: unavailable(),
    engineVersionManager: unavailable(),
    forceNarrowLayout: overrides.forceNarrowLayout ?? false,
  };
}
