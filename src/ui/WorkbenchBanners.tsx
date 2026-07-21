import type { ReactNode } from "react";

import type { EngineLoadProgressStore } from "../application/engine/engine-load-progress";
import { messages } from "../messages/en";
import {
  type EngineRecoveryState,
  EngineUnavailableBanner,
} from "./engine/EngineUnavailableBanner";
import { WasmEngineProgressBanner } from "./engine/WasmEngineProgressBanner";

export interface WorkbenchBannersProps {
  readonly configuredEnginePath: string;
  readonly engineAvailable: boolean;
  readonly engineChecking: boolean;
  readonly engineRecovery?: EngineRecoveryState;
  readonly settingsLoadError: boolean;
  readonly wasmEngineProgress?: EngineLoadProgressStore;
  readonly wasmEngineFailureMessage?: string;
  readonly children?: ReactNode;
  readonly onConfigureEnginePath?: (path: string) => void;
  readonly onRetryWasmEngine?: () => void;
}

export function WorkbenchBanners({
  configuredEnginePath,
  engineAvailable,
  engineChecking,
  engineRecovery,
  settingsLoadError,
  wasmEngineProgress,
  wasmEngineFailureMessage,
  children,
  onConfigureEnginePath,
  onRetryWasmEngine,
}: WorkbenchBannersProps) {
  const webEngine = Boolean(wasmEngineProgress);
  const effectiveEngineRecovery: EngineRecoveryState | undefined = engineRecovery
    ?? (!engineChecking ? { kind: "unavailable" } : undefined);
  const showEngineRecovery = !webEngine
    && !engineAvailable
    && onConfigureEnginePath
    && effectiveEngineRecovery;
  const showEngineUnavailable = !webEngine
    && !engineAvailable
    && !engineChecking
    && !onConfigureEnginePath;
  if (
    !settingsLoadError
    && !showEngineRecovery
    && !showEngineUnavailable
    && !webEngine
    && !children
  ) return null;
  return (
    <div className="workbench-banners">
      {settingsLoadError && (
        <div className="settings-load-banner" role="alert">{messages.settingsLoadFailed}</div>
      )}
      {showEngineRecovery && (
        <EngineUnavailableBanner
          configuredPath={configuredEnginePath}
          state={effectiveEngineRecovery}
          onSave={onConfigureEnginePath}
        />
      )}
      {showEngineUnavailable && (
        <div className="engine-banner" role="status">{messages.engineUnavailable}</div>
      )}
      {wasmEngineProgress && (
        <WasmEngineProgressBanner
          available={engineAvailable}
          checking={engineChecking}
          progress={wasmEngineProgress}
          failureMessage={wasmEngineFailureMessage}
          onRetry={onRetryWasmEngine}
        />
      )}
      {children}
    </div>
  );
}
