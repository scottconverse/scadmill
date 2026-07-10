import { useEffect, useMemo, useRef, useState } from "react";

import type { EngineInfo, EngineService } from "../application/engine/contracts";
import { createWorkbenchRuntime } from "../application/runtime/workbench-runtime";
import type { ThemeHost } from "../application/theme/theme-runtime";
import { messages } from "../messages/en";
import { useReadonlyStore } from "../ui/use-readonly-store";
import { Workbench } from "../ui/Workbench";
import { useThemeSelection } from "./use-theme-selection";

export interface AppProps {
  engine: EngineService;
  themeHost?: ThemeHost;
}

export function App({ engine, themeHost }: AppProps) {
  const runtime = useMemo(() => createWorkbenchRuntime(engine), [engine]);
  const themePreference = useReadonlyStore(runtime.settings, (settings) => settings.theme);
  const activeTheme = useThemeSelection(themePreference, themeHost);
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null | undefined>();
  const versionProbe = useRef<{ engine: EngineService; result: Promise<EngineInfo | null> } | null>(null);

  useEffect(() => {
    if (versionProbe.current?.engine !== engine) {
      versionProbe.current = { engine, result: engine.version().catch(() => null) };
    }
    const probe = versionProbe.current;
    let active = true;
    void probe.result.then((info) => {
      if (active) setEngineInfo(info);
    });
    return () => { active = false; };
  }, [engine]);

  useEffect(() => {
    if (engineInfo) {
      void runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    }
  }, [engineInfo, runtime]);

  const engineLabel = engineInfo === undefined
    ? "Checking OpenSCAD…"
    : engineInfo
      ? `OpenSCAD ${engineInfo.version}`
      : messages.engineUnavailable;

  return (
    <Workbench
      runtime={runtime}
      engineLabel={engineLabel}
      engineAvailable={Boolean(engineInfo)}
      activeTheme={activeTheme}
      themePreference={themePreference}
      onThemePreferenceChange={(theme) =>
        void runtime.dispatch({ kind: "set-theme", origin: "user", theme })
      }
    />
  );
}
