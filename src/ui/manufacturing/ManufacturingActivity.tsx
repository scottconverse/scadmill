import { useEffect, useRef, useState } from "react";

import type { Quality, RenderSuccess3D } from "../../application/engine/contracts";
import type { SlicerHandoffResult } from "../../application/manufacturing/slicer-handoff";
import { printabilityReportLines } from "../../application/manufacturing/printability";
import { runPrintabilityOffThread } from "../../application/manufacturing/printability-worker-client";
import { messages } from "../../messages/en";
import { ManufacturingEstimatePanel, type ManufacturingEstimateRunner } from "./ManufacturingEstimatePanel";
import { SlicerHandoffPanel } from "./SlicerHandoffPanel";
import "./manufacturing.css";

export interface ManufacturingActivityProps {
  readonly estimateRunner?: ManufacturingEstimateRunner;
  readonly quality?: Quality;
  readonly result?: RenderSuccess3D;
  readonly multiObject?: boolean;
  readonly onOpenInSlicer?: (configuredExecutablePath?: string) => Promise<SlicerHandoffResult>;
}

export function ManufacturingActivity({ estimateRunner, quality, result, multiObject = (result?.mesh.parts?.length ?? 0) > 1, onOpenInSlicer }: ManufacturingActivityProps) {
  const [buildWidth, setBuildWidth] = useState("220");
  const [buildDepth, setBuildDepth] = useState("220");
  const [buildHeight, setBuildHeight] = useState("250");
  const [nozzleDiameter, setNozzleDiameter] = useState("0.4");
  const [lines, setLines] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const activeCheck = useRef<AbortController | null>(null);
  const supported = quality === "full" && (result?.mesh.format === "stl-binary" || result?.mesh.format === "3mf");
  useEffect(() => () => activeCheck.current?.abort(), []);
  const run = () => {
    if (!supported || !result || (result.mesh.format !== "stl-binary" && result.mesh.format !== "3mf")) return;
    activeCheck.current?.abort();
    const controller = new AbortController();
    activeCheck.current = controller;
    setRunning(true); setError(null);
    void runPrintabilityOffThread(result.mesh.bytes, {
        buildVolumeMm: [Number(buildWidth), Number(buildDepth), Number(buildHeight)],
        nozzleDiameterMm: Number(nozzleDiameter),
      }, undefined, controller.signal, result.mesh.format).then((report) => {
        if (activeCheck.current !== controller) return;
        setLines(printabilityReportLines(report)); setRunning(false); activeCheck.current = null;
      }, () => {
        if (activeCheck.current !== controller) return;
        setLines([]); setError(messages.printabilityCheckFailed); setRunning(false); activeCheck.current = null;
      });
  };
  return (
    <div className="manufacturing-activity">
      <section>
        <h3>{messages.printabilityReport}</h3>
        <p>{messages.printabilityExplanation}</p>
        {!supported && <p role="status">{messages.printabilityNeedsFullRender}</p>}
        <fieldset>
          <legend>{messages.buildVolume}</legend>
          <label><span>{messages.buildWidth}</span><input aria-label={messages.buildWidth} min="0.001" onChange={(event) => setBuildWidth(event.currentTarget.value)} step="any" type="number" value={buildWidth} /></label>
          <label><span>{messages.buildDepth}</span><input aria-label={messages.buildDepth} min="0.001" onChange={(event) => setBuildDepth(event.currentTarget.value)} step="any" type="number" value={buildDepth} /></label>
          <label><span>{messages.buildHeight}</span><input aria-label={messages.buildHeight} min="0.001" onChange={(event) => setBuildHeight(event.currentTarget.value)} step="any" type="number" value={buildHeight} /></label>
          <label><span>{messages.nozzleDiameter}</span><input aria-label={messages.nozzleDiameter} min="0.001" onChange={(event) => setNozzleDiameter(event.currentTarget.value)} step="any" type="number" value={nozzleDiameter} /></label>
        </fieldset>
        <button disabled={!supported || running} onClick={run} type="button">{running ? messages.checkingPrintability : messages.runPrintabilityCheck}</button>
        {error && <p className="manufacturing-error" role="alert">{error}</p>}
        {lines.length > 0 && <ul aria-label={messages.printabilityReport}>{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
      </section>
      <ManufacturingEstimatePanel estimateRunner={estimateRunner} quality={quality} result={result} />
      <SlicerHandoffPanel multiObject={multiObject} onOpen={onOpenInSlicer} />
    </div>
  );
}
