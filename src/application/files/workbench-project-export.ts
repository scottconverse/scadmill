import { activeDocument } from "../documents/document-workspace";
import type { EngineService, ExportFormat } from "../engine/contracts";
import type { WorkbenchRuntime } from "../runtime/workbench-runtime";
import { startProjectExport } from "./project-export";
import { portableWorkbenchSnapshot } from "./workbench-portability";

export function startWorkbenchProjectExport(
  runtime: WorkbenchRuntime,
  engine: EngineService,
  format: ExportFormat,
) {
  const document = activeDocument(runtime.documents.getState());
  return startProjectExport({
    engine,
    destination: runtime.artifacts,
    snapshot: portableWorkbenchSnapshot(runtime),
    entryFile: document.path,
    format,
    parameters: {},
    timeoutMs: runtime.settings.getState().fullTimeoutMs,
    ...(format === "png" ? { image: { width: 1_024, height: 768 } } : {}),
  });
}
