import { useEffect, useState } from "react";

import type { EngineVersionManagerPort } from "../../application/engine/engine-version-manager";
import { messages } from "../../messages/en";

export interface EnginePinMismatchBannerProps {
  readonly manager?: EngineVersionManagerPort;
  readonly projectPin?: string;
  readonly invalidManifest?: boolean;
  readonly onFix: () => void;
}

export function EnginePinMismatchBanner({
  manager, projectPin, invalidManifest = false, onFix,
}: EnginePinMismatchBannerProps) {
  const [available, setAvailable] = useState<readonly string[]>();
  useEffect(() => {
    if (!manager || !projectPin) { setAvailable(undefined); return; }
    let current = true;
    void manager.listInstalled().then(
      (engines) => { if (current) setAvailable(engines.map((engine) => engine.version)); },
      () => { if (current) setAvailable(undefined); },
    );
    return () => { current = false; };
  }, [manager, projectPin]);
  const missing = Boolean(manager && projectPin && available && !available.includes(projectPin));
  if (!invalidManifest && !missing) return null;
  return <div className="engine-banner" role="alert">
    <span>{invalidManifest
      ? messages.enginePinManifestInvalid
      : messages.enginePinMismatch(projectPin ?? "")}</span>
    <button onClick={onFix} type="button">{messages.fixEngineVersion}</button>
  </div>;
}
