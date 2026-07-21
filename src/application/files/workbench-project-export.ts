import { activeDocument } from "../documents/document-workspace";
import type { EngineService, ExportFormat, ParamValue } from "../engine/contracts";
import {
  startBatchProjectExport,
  type BatchProjectExportOperation,
} from "./batch-project-export";
import type { NamedParameterSet } from "../parameters/parameter-set-codec";
import { parameterDocument } from "../parameters/parameter-state";
import type { WorkbenchRuntime } from "../runtime/workbench-runtime";
import { startProjectExport } from "./project-export";
import { portableWorkbenchSnapshot } from "./workbench-portability";

export function startWorkbenchProjectExport(
  runtime: WorkbenchRuntime,
  engine: EngineService,
  format: ExportFormat,
) {
  const document = activeDocument(runtime.documents.getState());
  const overrides = parameterDocument(runtime.parameters.getState(), document.id).overrides;
  const parameters: Record<string, ParamValue> = {};
  for (const [name, value] of Object.entries(overrides)) {
    Object.defineProperty(parameters, name, {
      configurable: true,
      enumerable: true,
      value: Array.isArray(value) ? [...value] : value,
      writable: true,
    });
  }
  return startProjectExport({
    engine,
    destination: runtime.artifacts,
    snapshot: portableWorkbenchSnapshot(runtime),
    entryFile: document.path,
    format,
    parameters,
    timeoutMs: runtime.settings.getState().fullTimeoutMs,
    ...(format === "png" ? { image: { width: 1_024, height: 768 } } : {}),
  });
}

export function startWorkbenchBatchProjectExport(
  runtime: WorkbenchRuntime,
  engine: EngineService,
  format: ExportFormat,
  sets: readonly NamedParameterSet[],
  fileNameTemplate: string,
): BatchProjectExportOperation {
  const document = activeDocument(runtime.documents.getState());
  const snapshot = portableWorkbenchSnapshot(runtime);
  const timeoutMs = runtime.settings.getState().fullTimeoutMs;
  return startBatchProjectExport({
    entryFile: document.path,
    format,
    sets,
    fileNameTemplate,
    startExport: (set, outputFileName) => {
      const parameters: Record<string, ParamValue> = {};
      for (const [name, value] of Object.entries(set.values)) {
        Object.defineProperty(parameters, name, {
          configurable: true,
          enumerable: true,
          value: Array.isArray(value) ? [...value] : value,
          writable: true,
        });
      }
      return startProjectExport({
        engine,
        destination: runtime.artifacts,
        snapshot,
        entryFile: document.path,
        format,
        parameters,
        timeoutMs,
        outputFileName,
        ...(format === "png" ? { image: { width: 1_024, height: 768 } } : {}),
      });
    },
  });
}
