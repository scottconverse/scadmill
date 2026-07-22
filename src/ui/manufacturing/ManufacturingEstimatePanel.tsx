import { useEffect, useRef, useState } from "react";

import type { MeshFormat, Quality, RenderSuccess3D } from "../../application/engine/contracts";
import {
  formatEstimateFilament,
  formatEstimateTime,
  type ManufacturingEstimate,
  MANUFACTURING_ESTIMATE_PROFILES,
} from "../../application/manufacturing/manufacturing-estimate";
import { runManufacturingEstimate } from "../../application/manufacturing/manufacturing-estimate-runtime";
import { messages } from "../../messages/en";

export type ManufacturingEstimateRunner = (
  bytes: Uint8Array,
  format: MeshFormat,
  profileId: string,
  signal: AbortSignal,
) => Promise<ManufacturingEstimate>;

export interface ManufacturingEstimatePanelProps {
  readonly estimateRunner?: ManufacturingEstimateRunner;
  readonly quality?: Quality;
  readonly result?: RenderSuccess3D;
}

export function ManufacturingEstimatePanel({
  estimateRunner = (bytes, format, profileId, signal) => runManufacturingEstimate(
    bytes,
    format,
    profileId,
    signal,
  ),
  quality,
  result,
}: ManufacturingEstimatePanelProps) {
  const [profileId, setProfileId] = useState(MANUFACTURING_ESTIMATE_PROFILES[0].id);
  const [estimate, setEstimate] = useState<ManufacturingEstimate>();
  const [error, setError] = useState(false);
  const [running, setRunning] = useState(false);
  const activeRun = useRef<AbortController | null>(null);
  const supported = quality === "full"
    && (result?.mesh.format === "stl-binary" || result?.mesh.format === "3mf");
  const estimateSource = supported ? result : undefined;
  const previousEstimateSource = useRef(estimateSource);
  useEffect(() => {
    if (previousEstimateSource.current !== estimateSource) {
      activeRun.current?.abort();
      activeRun.current = null;
      previousEstimateSource.current = estimateSource;
      setEstimate(undefined);
      setError(false);
      setRunning(false);
    }
    return () => activeRun.current?.abort();
  }, [estimateSource]);
  const run = () => {
    if (!supported || !result || running) return;
    const format = result.mesh.format;
    if (format !== "stl-binary" && format !== "3mf") return;
    activeRun.current?.abort();
    const controller = new AbortController();
    activeRun.current = controller;
    setRunning(true);
    setError(false);
    setEstimate(undefined);
    void estimateRunner(result.mesh.bytes, format, profileId, controller.signal).then((next) => {
      if (activeRun.current !== controller) return;
      activeRun.current = null;
      setEstimate(next);
      setRunning(false);
    }, () => {
      if (activeRun.current !== controller) return;
      activeRun.current = null;
      setError(true);
      setRunning(false);
    });
  };
  return (
    <section>
      <h3>{messages.manufacturingEstimate}</h3>
      <p>{messages.manufacturingEstimateExplanation}</p>
      {!supported && <p role="status">{messages.manufacturingEstimateNeedsFullRender}</p>}
      <label>
        <span>{messages.manufacturingEstimateProfile}</span>
        <select
          aria-label={messages.manufacturingEstimateProfile}
          disabled={!supported || running}
          onChange={(event) => {
            setProfileId(event.currentTarget.value);
            setEstimate(undefined);
            setError(false);
          }}
          value={profileId}
        >
          {MANUFACTURING_ESTIMATE_PROFILES.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}</option>
          ))}
        </select>
      </label>
      <button disabled={!supported || running} onClick={run} type="button">
        {running ? messages.manufacturingEstimating : messages.runManufacturingEstimate}
      </button>
      {error && <p className="manufacturing-error" role="alert">{messages.manufacturingEstimateFailed}</p>}
      {estimate && (
        <div className="manufacturing-estimate-result" role="status">
          <p>{messages.estimatedPrintTime(formatEstimateTime(estimate.timeSeconds))}</p>
          <p>{messages.estimatedFilamentUse(formatEstimateFilament(estimate.filamentMillimeters))}</p>
          <p>{messages.manufacturingEstimateDisclosure(estimate)}</p>
        </div>
      )}
    </section>
  );
}
