import type { ReactNode } from "react";

import { messages } from "../messages/en";
import {
  EngineUnavailableBanner,
  type EngineRecoveryState,
} from "./engine/EngineUnavailableBanner";

export interface WorkbenchBannersProps {
  readonly configuredEnginePath: string;
  readonly engineAvailable: boolean;
  readonly engineChecking: boolean;
  readonly engineRecovery?: EngineRecoveryState;
  readonly settingsLoadError: boolean;
  readonly children?: ReactNode;
  readonly onConfigureEnginePath?: (path: string) => void;
}

export function WorkbenchBanners({
  configuredEnginePath,
  engineAvailable,
  engineChecking,
  engineRecovery,
  settingsLoadError,
  children,
  onConfigureEnginePath,
}: WorkbenchBannersProps) {
  const showEngineRecovery = !engineAvailable && onConfigureEnginePath && engineRecovery;
  const showEngineUnavailable = !engineAvailable && !engineChecking && !onConfigureEnginePath;
  if (!settingsLoadError && !showEngineRecovery && !showEngineUnavailable && !children) return null;
  return (
    <div className="workbench-banners">
      {settingsLoadError && (
        <div className="settings-load-banner" role="alert">{messages.settingsLoadFailed}</div>
      )}
      {showEngineRecovery && (
        <EngineUnavailableBanner
          configuredPath={configuredEnginePath}
          state={engineRecovery}
          onSave={onConfigureEnginePath}
        />
      )}
      {showEngineUnavailable && (
        <div className="engine-banner" role="status">{messages.engineUnavailable}</div>
      )}
      {children}
    </div>
  );
}
