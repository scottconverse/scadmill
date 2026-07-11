import { useEffect, useMemo, useRef, useState } from "react";

import type { EngineInfo, EngineService } from "../application/engine/contracts";
import type { EnginePathConfiguration } from "../application/engine/engine-path-configuration";
import {
  acceptsPinnedEngineVersion,
  PINNED_OPENSCAD_VERSION,
} from "../application/engine/engine-pin";
import type { WorkspaceLayoutPersistence } from "../application/runtime/layout-persistence";
import type { ArtifactDestination } from "../application/files/artifact-destination";
import type { ProjectStorage } from "../application/files/project-file-service";
import type { RecoveryPersistence } from "../application/files/recovery-state";
import type { RecentProjectsPersistence } from "../application/files/recent-projects";
import type { ScratchAutosavePersistence } from "../application/files/scratch-autosave";
import {
  createWorkbenchProjectPortabilityController,
  type ImportedProjectStorage,
} from "../application/files/workbench-portability";
import { createWorkbenchRuntime } from "../application/runtime/workbench-runtime";
import type { ThemeHost } from "../application/theme/theme-runtime";
import { messages } from "../messages/en";
import { useReadonlyStore } from "../ui/use-readonly-store";
import { Workbench } from "../ui/Workbench";
import type { EngineRecoveryState } from "../ui/engine/EngineUnavailableBanner";
import { useThemeSelection } from "./use-theme-selection";

type EngineHealth =
  | { kind: "checking"; configuredPath: string }
  | { kind: "unavailable" }
  | { kind: "invalid-config"; configuredPath: string }
  | { kind: "unsupported-version"; configuredPath: string; info: EngineInfo }
  | { kind: "ready"; info: EngineInfo };

export interface AppProps {
  engine: EngineService;
  themeHost?: ThemeHost;
  layoutPersistence?: WorkspaceLayoutPersistence;
  showWebMenu?: boolean;
  forceNarrowLayout?: boolean;
  canRevealProjectFiles?: boolean;
  projectStorage?: ProjectStorage;
  artifactDestination?: ArtifactDestination;
  recoveryPersistence?: RecoveryPersistence;
  recentProjectsPersistence?: RecentProjectsPersistence;
  projectPortabilityStorage?: ImportedProjectStorage;
  scratchAutosavePersistence?: ScratchAutosavePersistence;
  enginePathConfiguration?: EnginePathConfiguration;
}

export function App({
  engine,
  themeHost,
  layoutPersistence,
  showWebMenu,
  forceNarrowLayout,
  canRevealProjectFiles,
  projectStorage,
  artifactDestination,
  recoveryPersistence,
  recentProjectsPersistence,
  projectPortabilityStorage,
  scratchAutosavePersistence,
  enginePathConfiguration,
}: AppProps) {
  const runtime = useMemo(
    () => createWorkbenchRuntime(engine, {
      artifactDestination,
      layoutPersistence,
      initialScratchPath: "Untitled",
      initialScratchSource: scratchAutosavePersistence?.load() ?? "",
      projectStorage,
      recentProjectsPersistence,
    }),
    [
      artifactDestination,
      engine,
      layoutPersistence,
      projectStorage,
      recentProjectsPersistence,
      scratchAutosavePersistence,
    ],
  );
  const projectPortability = useMemo(
    () => projectPortabilityStorage
      ? createWorkbenchProjectPortabilityController(runtime, projectPortabilityStorage)
      : undefined,
    [projectPortabilityStorage, runtime],
  );
  const themePreference = useReadonlyStore(runtime.settings, (settings) => settings.theme);
  const activeTheme = useThemeSelection(themePreference, themeHost);
  const [engineHealth, setEngineHealth] = useState<EngineHealth>(() => ({
    kind: "checking",
    configuredPath: enginePathConfiguration?.load().trim() ?? "",
  }));
  const configuredPathForProbe = useRef(
    engineHealth.kind === "checking" ? engineHealth.configuredPath : "",
  );
  const [engineProbeRevision, setEngineProbeRevision] = useState(0);
  const versionProbe = useRef<{
    engine: EngineService;
    revision: number;
    configuredPath: string;
    result: Promise<EngineInfo | null>;
  } | null>(null);

  useEffect(() => {
    if (
      versionProbe.current?.engine !== engine
      || versionProbe.current.revision !== engineProbeRevision
    ) {
      versionProbe.current = {
        engine,
        revision: engineProbeRevision,
        configuredPath: configuredPathForProbe.current,
        result: engine.version(),
      };
    }
    const probe = versionProbe.current;
    let active = true;
    void probe.result
      .then((info) => {
        if (!active) return;
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
        if (available) {
          return runtime.dispatch({ kind: "render-active", origin: "system", quality: "preview" });
        }
      });
  }, [engineHealth, runtime]);

  useEffect(() => () => runtime.dispose(), [runtime]);

  const engineLabel = engineHealth.kind === "checking"
    ? messages.checkingEngine
    : engineHealth.kind === "ready"
      ? `OpenSCAD ${engineHealth.info.version}`
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

  return (
    <Workbench
      engine={engine}
      runtime={runtime}
      engineLabel={engineLabel}
      engineAvailable={engineHealth.kind === "ready"}
      engineChecking={engineHealth.kind === "checking"}
      engineRecovery={engineRecovery}
      activeTheme={activeTheme}
      themePreference={themePreference}
      showWebMenu={showWebMenu}
      forceNarrowLayout={forceNarrowLayout}
      canRevealProjectFiles={canRevealProjectFiles}
      projectStorage={projectStorage}
      recoveryPersistence={recoveryPersistence}
      scratchAutosavePersistence={scratchAutosavePersistence}
      projectPortability={projectPortability}
      configuredEnginePath={engineHealth.kind === "checking" || engineHealth.kind === "invalid-config"
        ? engineHealth.configuredPath
        : enginePathConfiguration?.load() ?? ""}
      onConfigureEnginePath={enginePathConfiguration
        ? (path) => {
            enginePathConfiguration.save(path);
            configuredPathForProbe.current = path;
            setEngineHealth({ kind: "checking", configuredPath: path });
            setEngineProbeRevision((revision) => revision + 1);
          }
        : undefined}
      onThemePreferenceChange={(theme) =>
        void runtime.dispatch({ kind: "set-theme", origin: "user", theme })
      }
    />
  );
}
