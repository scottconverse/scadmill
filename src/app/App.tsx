import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { activeDocument } from "../application/documents/document-workspace";
import type { EngineInfo, EngineService } from "../application/engine/contracts";
import {
  acceptsPinnedEngineVersion,
  PINNED_OPENSCAD_VERSION,
} from "../application/engine/engine-pin";
import { cachedEngineVersion, invalidateCachedEngineVersion } from "../application/engine/engine-version-cache";
import {
  createWorkbenchProjectPortabilityController,
} from "../application/files/workbench-portability";
import type { ScadMillPlatform } from "../application/platform/scadmill-platform";
import { createWorkbenchRuntime } from "../application/runtime/workbench-runtime";
import type { ThemeHost } from "../application/theme/theme-runtime";
import { messages } from "../messages/en";
import type { EngineRecoveryState } from "../ui/engine/EngineUnavailableBanner";
import { useReadonlyStore } from "../ui/use-readonly-store";
import { Workbench } from "../ui/Workbench";
import { useThemeSelection } from "./use-theme-selection";

type EngineHealth =
  | { kind: "checking"; configuredPath: string }
  | { kind: "unavailable" }
  | { kind: "invalid-config"; configuredPath: string }
  | { kind: "unsupported-version"; configuredPath: string; info: EngineInfo }
  | { kind: "ready"; info: EngineInfo };

export interface AppProps {
  platform: ScadMillPlatform;
  themeHost?: ThemeHost;
}

export function App({
  platform,
  themeHost,
}: AppProps) {
  const { engine } = platform;
  const { projectStorage, portabilityStorage: projectPortabilityStorage, workspaceDirectory } = platform.files;
  const directoryPicker = platform.files.directoryPicker.available
    ? platform.files.directoryPicker.service
    : undefined;
  const enginePathConfiguration = platform.enginePathConfiguration.available
    ? platform.enginePathConfiguration.service
    : undefined;
  const wasmEngineProgress = platform.wasm.available ? platform.wasm.service.progress : undefined;
  const onRetryWasmEngine = platform.wasm.available ? platform.wasm.service.clearProgress : undefined;
  const {
    layout: layoutPersistence,
    settings: settingsPersistence,
    secrets: secretStore,
    recovery: recoveryPersistence,
    recentProjects: recentProjectsPersistence,
    scratchAutosave: scratchAutosavePersistence,
    workspaceMetadata: workspaceMetadataPersistence,
    welcome: welcomePreferencePersistence,
    renderCachePreferences: renderDiskCachePreferencePersistence,
    renderThumbnails: renderThumbnailPersistence,
  } = platform.persistence;
  const artifactDestination = platform.artifacts;
  const renderDiskCacheStorage = platform.persistence.renderCache.available
    ? platform.persistence.renderCache.service
    : undefined;
  const [showWelcomeOnLaunch, setShowWelcomeOnLaunch] = useState(() => {
    try { return welcomePreferencePersistence?.load() ?? false; } catch { return false; }
  });
  const runtime = useMemo(
    () => {
      const restoredScratch = scratchAutosavePersistence?.load();
      return createWorkbenchRuntime(engine, {
        artifactDestination,
        layoutPersistence,
        initialScratchPath: restoredScratch?.path ?? "Untitled",
        initialScratchSource: restoredScratch?.source ?? "",
        projectStorage,
        recentProjectsPersistence,
        settingsPersistence,
        workspaceMetadataPersistence,
        renderDiskCacheStorage,
        renderDiskCachePreferencePersistence,
        renderThumbnailPersistence,
      });
    },
    [
      artifactDestination,
      engine,
      layoutPersistence,
      projectStorage,
      recentProjectsPersistence,
      scratchAutosavePersistence,
      settingsPersistence,
      workspaceMetadataPersistence,
      renderDiskCacheStorage,
      renderDiskCachePreferencePersistence,
      renderThumbnailPersistence,
    ],
  );
  const pendingRuntimeDisposals = useRef(
    new Map<ReturnType<typeof createWorkbenchRuntime>, object>(),
  );
  const projectPortability = useMemo(
    () => createWorkbenchProjectPortabilityController(runtime, projectPortabilityStorage, {
      copyText: (value) => platform.clipboard.writeText(value),
      currentHref: () => platform.location.currentHref(),
      makeProjectId: () => platform.location.makeProjectId(),
    }),
    [platform, projectPortabilityStorage, runtime],
  );
  const themePreference = useReadonlyStore(runtime.settings, (settings) => settings.theme);
  const customThemes = useReadonlyStore(
    runtime.settings,
    (settings) => settings.profile.theme.customThemes,
  );
  const configuredEnginePath = useReadonlyStore(
    runtime.settings,
    (settings) => settings.profile.engine.executablePath,
  ).trim();
  const activeTheme = useThemeSelection(themePreference, customThemes, themeHost);
  const legacyEnginePath = useRef(enginePathConfiguration?.load().trim() ?? "");
  const migrationPending = useRef(Boolean(!configuredEnginePath && legacyEnginePath.current));
  const initialEnginePath = configuredEnginePath || legacyEnginePath.current;
  const [engineHealth, setEngineHealth] = useState<EngineHealth>(() => ({
    kind: "checking",
    configuredPath: initialEnginePath,
  }));
  const configuredPathForProbe = useRef(initialEnginePath);
  const mirroredEnginePath = useRef(legacyEnginePath.current);
  const [engineProbeRevision, setEngineProbeRevision] = useState(0);
  const wasmRetryPending = useRef(false);
  const versionProbe = useRef<{
    engine: EngineService;
    revision: number;
    configuredPath: string;
    result: Promise<EngineInfo | null>;
  } | null>(null);

  useLayoutEffect(() => {
    if (!enginePathConfiguration) return;
    if (migrationPending.current) {
      migrationPending.current = false;
      void runtime.dispatch({
        kind: "replace-settings",
        origin: "system",
        settings: {
          ...runtime.settings.getState().profile,
          engine: { executablePath: legacyEnginePath.current },
        },
      }).catch(() => undefined);
      return;
    }
    if (mirroredEnginePath.current !== configuredEnginePath) {
      enginePathConfiguration.save(configuredEnginePath);
      mirroredEnginePath.current = configuredEnginePath;
    }
    if (configuredPathForProbe.current === configuredEnginePath) return;
    configuredPathForProbe.current = configuredEnginePath;
    setEngineHealth({ kind: "checking", configuredPath: configuredEnginePath });
    setEngineProbeRevision((revision) => revision + 1);
  }, [configuredEnginePath, enginePathConfiguration, runtime]);

  useEffect(() => {
    if (
      versionProbe.current?.engine !== engine
      || versionProbe.current.revision !== engineProbeRevision
    ) {
      const result = cachedEngineVersion(engine, configuredPathForProbe.current);
      versionProbe.current = {
        engine,
        revision: engineProbeRevision,
        configuredPath: configuredPathForProbe.current,
        result,
      };
    }
    const probe = versionProbe.current;
    let active = true;
    void probe.result
      .then((info) => {
        if (!active) return;
        wasmRetryPending.current = false;
        if (info && acceptsPinnedEngineVersion(info.version)) {
          setEngineHealth({ kind: "ready", info });
        } else if (info) {
          setEngineHealth({
            kind: "unsupported-version",
            configuredPath: probe.configuredPath,
            info,
          });
        } else if (probe.configuredPath) {
          setEngineHealth({ kind: "invalid-config", configuredPath: probe.configuredPath });
        } else {
          setEngineHealth({ kind: "unavailable" });
        }
      })
      .catch(() => {
        if (!active) return;
        wasmRetryPending.current = false;
        setEngineHealth(probe.configuredPath
          ? { kind: "invalid-config", configuredPath: probe.configuredPath }
          : { kind: "unavailable" });
      });
    return () => { active = false; };
  }, [engine, engineProbeRevision]);

  useEffect(() => {
    if (engineHealth.kind === "checking") return;
    const available = engineHealth.kind === "ready";
    void runtime
      .dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available,
      })
      .then(() => {
        if (
          available
          && activeDocument(runtime.documents.getState()).source.trim().length > 0
        ) {
          return runtime.dispatch({
            kind: "render-active",
            origin: "system",
            quality: runtime.settings.getState().defaultQuality,
          });
        }
      });
  }, [engineHealth, runtime]);

  useEffect(() => {
    pendingRuntimeDisposals.current.delete(runtime);
    return () => {
      const token = {};
      pendingRuntimeDisposals.current.set(runtime, token);
      queueMicrotask(() => {
        if (pendingRuntimeDisposals.current.get(runtime) !== token) return;
        pendingRuntimeDisposals.current.delete(runtime);
        runtime.dispose();
      });
    };
  }, [runtime]);

  const engineLabel = engineHealth.kind === "checking"
    ? messages.checkingEngine
    : engineHealth.kind === "ready"
      ? messages.engineReady(engineHealth.info.version)
      : engineHealth.kind === "unsupported-version"
        ? messages.engineVersionUnsupported(
            engineHealth.info.version,
            PINNED_OPENSCAD_VERSION,
          )
      : engineHealth.kind === "invalid-config"
        ? messages.engineConfiguredPathInvalidStatus
        : messages.engineUnavailable;
  const engineRecovery: EngineRecoveryState | undefined = !enginePathConfiguration
    ? undefined
    : engineHealth.kind === "unavailable"
      ? { kind: "unavailable" }
      : engineHealth.kind === "invalid-config"
        ? { kind: "invalid-config", path: engineHealth.configuredPath }
        : engineHealth.kind === "unsupported-version"
          ? {
              kind: "unsupported-version",
              expected: PINNED_OPENSCAD_VERSION,
              found: engineHealth.info.version,
              path: engineHealth.configuredPath,
            }
        : engineHealth.kind === "checking" && engineHealth.configuredPath
          ? { kind: "checking", path: engineHealth.configuredPath }
        : undefined;
  const retryWasmEngine = !wasmEngineProgress || !onRetryWasmEngine
    || engineHealth.kind === "unsupported-version"
    ? undefined
    : () => {
        if (engineHealth.kind === "checking" || wasmRetryPending.current) return;
        wasmRetryPending.current = true;
        try {
          onRetryWasmEngine();
        } catch {
          // Progress cleanup cannot prevent a new engine probe.
        }
        invalidateCachedEngineVersion(engine, configuredPathForProbe.current);
        setEngineHealth({ kind: "checking", configuredPath: "" });
        setEngineProbeRevision((revision) => revision + 1);
      };

  return (
    <Workbench
      engine={engine}
      runtime={runtime}
      secretStore={secretStore}
      engineLabel={engineLabel}
      engineAvailable={engineHealth.kind === "ready"}
      engineChecking={engineHealth.kind === "checking"}
      engineRecovery={engineRecovery}
      wasmEngineProgress={wasmEngineProgress}
      wasmEngineFailureMessage={engineHealth.kind === "unsupported-version"
        ? messages.engineVersionUnsupported(
            engineHealth.info.version,
            PINNED_OPENSCAD_VERSION,
          )
        : undefined}
      activeTheme={activeTheme}
      customThemes={customThemes}
      themePreference={themePreference}
      showWebMenu={platform.menus.presentation === "web"}
      menuCommandSource={platform.menus.commands.available
        ? platform.menus.commands.service
        : undefined}
      associatedFileOpenSource={platform.files.fileAssociations.available
        ? platform.files.fileAssociations.service
        : undefined}
      forceNarrowLayout={platform.forceNarrowLayout}
      canRevealProjectFiles={platform.files.revealInOs.available}
      canTrashProjectFiles={platform.files.trashInOs.available}
      clipboard={platform.clipboard}
      projectStorage={projectStorage}
      directoryPicker={directoryPicker}
      workspaceDirectory={workspaceDirectory}
      recoveryPersistence={recoveryPersistence}
      scratchAutosavePersistence={scratchAutosavePersistence}
      showWelcomeOnLaunch={showWelcomeOnLaunch}
      projectPortability={projectPortability}
      configuredEnginePath={engineHealth.kind === "checking" || engineHealth.kind === "invalid-config"
        ? engineHealth.configuredPath
        : configuredEnginePath}
      onConfigureEnginePath={enginePathConfiguration
        ? (path) => {
            void runtime.dispatch({
              kind: "replace-settings",
              origin: "user",
              settings: {
                ...runtime.settings.getState().profile,
                engine: { executablePath: path },
              },
            }).catch(() => undefined);
          }
        : undefined}
      onRetryWasmEngine={retryWasmEngine}
      renderDiskCacheAvailable={platform.persistence.renderCache.available}
      onThemePreferenceChange={(theme) =>
        void runtime
          .dispatch({ kind: "set-theme", origin: "user", theme })
          .catch(() => undefined)
      }
      onWelcomePreferenceChange={welcomePreferencePersistence
        ? (show) => {
            welcomePreferencePersistence.save(show);
            setShowWelcomeOnLaunch(show);
          }
        : undefined}
    />
  );
}
