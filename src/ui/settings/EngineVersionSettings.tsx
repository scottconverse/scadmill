import { useEffect, useState } from "react";

import type { EngineVersionManagerPort, InstalledEngineVersion, OfficialEngineRelease } from "../../application/engine/engine-version-manager";
import { messages } from "../../messages/en";

export interface EngineVersionSettingsProps {
  readonly manager?: EngineVersionManagerPort;
  readonly project: boolean;
  readonly projectPin?: string;
  readonly onPin: (version: string) => Promise<void>;
  readonly onInventoryChanged?: () => void;
}

export function EngineVersionSettings({ manager, project, projectPin, onPin, onInventoryChanged }: EngineVersionSettingsProps) {
  const [installed, setInstalled] = useState<readonly InstalledEngineVersion[]>([]);
  const [official, setOfficial] = useState<readonly OfficialEngineRelease[]>([]);
  const [selected, setSelected] = useState(projectPin ?? "");
  const [status, setStatus] = useState<"loading" | "ready" | "error">(manager ? "loading" : "error");
  const [pinning, setPinning] = useState(false);
  const [installing, setInstalling] = useState<string>();
  useEffect(() => {
    if (!manager) return;
    let current = true;
    void Promise.all([manager.listInstalled(), manager.listOfficial()]).then(([engines, releases]) => {
      if (!current) return;
      setInstalled(engines);
      setOfficial(releases);
      setSelected((value) => value || projectPin || engines[0]?.version || "");
      setStatus("ready");
    }, () => { if (current) setStatus("error"); });
    return () => { current = false; };
  }, [manager, projectPin]);
  const pin = () => {
    if (!project || !selected || pinning) return;
    setPinning(true);
    void onPin(selected).then(() => setPinning(false), () => {
      setStatus("error"); setPinning(false);
    });
  };
  const install = (releaseId: string) => {
    if (!manager || installing) return;
    setInstalling(releaseId);
    setStatus("ready");
    void manager.installOfficial(releaseId).then(async () => {
      const engines = await manager.listInstalled();
      setInstalled(engines);
      setSelected((value) => value || engines[0]?.version || "");
      setInstalling(undefined);
      onInventoryChanged?.();
    }, () => {
      setStatus("error");
      setInstalling(undefined);
    });
  };
  return (
    <div className="engine-version-settings">
      <h4>{messages.engineVersions}</h4>
      {!manager && <p role="note">{messages.engineManagerDesktopOnly}</p>}
      {status === "loading" && <p role="status">{messages.loadingEngineVersions}</p>}
      {status === "error" && manager && <p role="alert">{messages.engineVersionListFailed}</p>}
      {installed.map((engine) => (
        <article key={engine.executablePath}>
          <strong>OpenSCAD {engine.version}</strong><span>{engine.source}</span><code>{engine.sha256}</code>
        </article>
      ))}
      {manager && status === "ready" && installed.length === 0 && <p role="status">{messages.noInstalledEngines}</p>}
      {official.length > 0 && <section aria-label={messages.officialEngineDownloads}>
        <h5>{messages.officialEngineDownloads}</h5>
        {official.map((release) => <article key={release.id}>
          <strong>OpenSCAD {release.version}</strong><span>{release.platform}</span>
          <span>{messages.archiveSha256}</span><code>{release.archiveSha256}</code>
          <button disabled={Boolean(installing)} onClick={() => install(release.id)} type="button">
            {installing === release.id ? messages.installingOfficialEngine : messages.downloadOfficialEngine(release.version)}
          </button>
        </article>)}
      </section>}
      <label><span>{messages.projectEnginePin}</span><select aria-label={messages.projectEnginePin} disabled={!project || installed.length === 0 || pinning} onChange={(event) => setSelected(event.currentTarget.value)} value={selected}>{installed.map((engine) => <option key={`${engine.version}:${engine.executablePath}`} value={engine.version}>{engine.version}</option>)}</select></label>
      <button disabled={!project || !selected || pinning} onClick={pin} type="button">{pinning ? messages.pinningEngine : messages.pinEngineToProject}</button>
      {!project && <p role="note">{messages.enginePinProjectRequired}</p>}
    </div>
  );
}
