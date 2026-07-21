import type { ExportFormat } from "../engine/contracts";
import type { NamedParameterSet } from "../parameters/parameter-set-codec";
import type { ProjectExportCompletion, ProjectExportOperation } from "./project-export";

export type BatchExportItemCompletion = ProjectExportCompletion;
export type BatchExportItemStatus = "pending" | "running" | "success" | "failure" | "cancelled";

export interface BatchExportItemState {
  readonly setName: string;
  readonly fileName: string;
  readonly status: BatchExportItemStatus;
  readonly completion?: BatchExportItemCompletion;
  readonly error?: string;
}

export interface BatchExportState {
  readonly items: readonly BatchExportItemState[];
  readonly completed: number;
  readonly total: number;
  readonly cancelled: boolean;
}

export interface BatchProjectExportInput {
  readonly entryFile: string;
  readonly format: ExportFormat;
  readonly sets: readonly NamedParameterSet[];
  readonly fileNameTemplate: string;
  readonly startExport: (
    set: NamedParameterSet,
    fileName: string,
  ) => ProjectExportOperation;
}

export interface BatchProjectExportOperation {
  readonly done: Promise<BatchExportState>;
  getState(): BatchExportState;
  subscribe(listener: (state: BatchExportState) => void): () => void;
  cancel(): void;
}

const EXTENSIONS: Readonly<Record<ExportFormat, string>> = Object.freeze({
  "3mf": "3mf",
  "stl-binary": "stl",
  "stl-ascii": "stl",
  off: "off",
  amf: "amf",
  svg: "svg",
  dxf: "dxf",
  png: "png",
});

function modelStem(entryFile: string): string {
  const leaf = entryFile.split("/").at(-1) ?? "model";
  const dot = leaf.lastIndexOf(".");
  return sanitizeFileToken(dot > 0 ? leaf.slice(0, dot) : leaf, "model");
}

function sanitizeFileToken(value: string, fallback: string): string {
  const sanitized = [...value.trim()]
    .map((character) => (
      character.charCodeAt(0) <= 0x1f || "<>:\"/\\|?*".includes(character)
        ? "_"
        : character
    ))
    .join("")
    .replace(/[ .]+$/gu, "")
    .slice(0, 120);
  return sanitized || fallback;
}

export function batchExportFileName(
  entryFile: string,
  setName: string,
  format: ExportFormat,
  template: string,
): string {
  const normalizedTemplate = template.trim();
  if (!normalizedTemplate || normalizedTemplate.length > 240) {
    throw new Error("Batch export filename template must contain 1 to 240 characters.");
  }
  if (!normalizedTemplate.includes("{set}")) {
    throw new Error("Batch export filename template must include {set}.");
  }
  const fileName = normalizedTemplate
    .replaceAll("{model}", modelStem(entryFile))
    .replaceAll("{set}", sanitizeFileToken(setName, "set"))
    .replaceAll("{ext}", EXTENSIONS[format]);
  if (/[\\/]/u.test(fileName) || fileName === "." || fileName === "..") {
    throw new Error("Batch export filename template must produce a file name, not a path.");
  }
  if (/[{}]/u.test(fileName)) {
    throw new Error("Batch export filename template contains an unknown placeholder.");
  }
  return sanitizeFileToken(fileName, `model-set.${EXTENSIONS[format]}`);
}

function cloneState(
  items: readonly BatchExportItemState[],
  cancelled: boolean,
): BatchExportState {
  return {
    items: items.map((item) => ({ ...item })),
    completed: items.filter(({ status }) => (
      status === "success" || status === "failure" || status === "cancelled"
    )).length,
    total: items.length,
    cancelled,
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function startBatchProjectExport(
  input: BatchProjectExportInput,
): BatchProjectExportOperation {
  if (input.sets.length === 0) throw new Error("Select at least one parameter set to export.");
  const items: BatchExportItemState[] = input.sets.map((set) => ({
    setName: set.name,
    fileName: batchExportFileName(
      input.entryFile,
      set.name,
      input.format,
      input.fileNameTemplate,
    ),
    status: "pending",
  }));
  if (new Set(items.map(({ fileName }) => fileName.toLocaleLowerCase())).size !== items.length) {
    throw new Error("The selected parameter sets produce duplicate export file names.");
  }
  const listeners = new Set<(state: BatchExportState) => void>();
  let cancelled = false;
  let activeOperation: ProjectExportOperation | undefined;
  let state = cloneState(items, false);
  const publish = () => {
    state = cloneState(items, cancelled);
    for (const listener of listeners) listener(state);
  };
  const done = (async () => {
    for (let index = 0; index < input.sets.length; index += 1) {
      if (cancelled) break;
      const set = input.sets[index];
      const item = items[index];
      if (!set || !item) continue;
      items[index] = { ...item, status: "running" };
      publish();
      try {
        activeOperation = input.startExport(set, item.fileName);
        const completion = await activeOperation.done;
        if (!cancelled) items[index] = { ...item, status: "success", completion };
      } catch (reason) {
        items[index] = cancelled
          ? { ...item, status: "cancelled" }
          : { ...item, status: "failure", error: errorMessage(reason) };
      } finally {
        activeOperation = undefined;
        publish();
      }
    }
    if (cancelled) {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item?.status === "pending" || item?.status === "running") {
          items[index] = { ...item, status: "cancelled" };
        }
      }
      publish();
    }
    return state;
  })();
  return {
    done,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      activeOperation?.cancel();
      publish();
    },
  };
}
