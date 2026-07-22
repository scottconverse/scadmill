import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import type { ExportFormat } from "../../application/engine/contracts";
import { defaultExportFormat } from "../../application/files/export-flow";
import type {
  ProjectExportCompletion,
  ProjectExportOperation,
} from "../../application/files/project-export";
import type {
  BatchExportItemState,
  BatchExportState,
  BatchProjectExportOperation,
} from "../../application/files/batch-project-export";
import type { NamedParameterSet } from "../../application/parameters/parameter-set-codec";
import { messages } from "../../messages/en";

export interface ProjectExportDialogProps {
  readonly entryFile: string;
  readonly destinationDescription: string;
  readonly modelKind?: "2d" | "3d";
  readonly openRequest?: number;
  readonly startExport: (format: ExportFormat) => ProjectExportOperation;
  readonly parameterSets?: readonly NamedParameterSet[];
  readonly startBatchExport?: (
    format: ExportFormat,
    sets: readonly NamedParameterSet[],
    fileNameTemplate: string,
  ) => BatchProjectExportOperation;
}

interface FormatOption {
  readonly value: ExportFormat;
  readonly label: string;
}

interface ExportContext {
  readonly entryFile: string;
  readonly destinationDescription: string;
}

export const PROJECT_EXPORT_FORMATS: readonly FormatOption[] = Object.freeze([
  { value: "3mf", label: messages.projectExportFormat3mf },
  { value: "stl-binary", label: messages.projectExportFormatStlBinary },
  { value: "stl-ascii", label: messages.projectExportFormatStlAscii },
  { value: "off", label: messages.projectExportFormatOff },
  { value: "amf", label: messages.projectExportFormatAmf },
  { value: "svg", label: messages.projectExportFormatSvg },
  { value: "dxf", label: messages.projectExportFormatDxf },
  { value: "png", label: messages.projectExportFormatPng },
]);

function isMesh(format: ExportFormat): boolean {
  return format === "3mf"
    || format === "stl-binary"
    || format === "stl-ascii"
    || format === "off"
    || format === "amf";
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? messages.projectExportFailedWithDetail(reason.message)
    : messages.projectExportFailed;
}

function batchItemLabel(item: BatchExportItemState): string {
  switch (item.status) {
    case "pending": return messages.projectBatchExportPending(item.setName);
    case "running": return messages.projectBatchExportRunning(item.setName);
    case "success": return messages.projectBatchExportSaved(item.setName);
    case "failure": return messages.projectBatchExportFailed(item.setName, item.error ?? "Unknown failure");
    case "cancelled": return messages.projectBatchExportCancelled(item.setName);
  }
}

function ExportSummary({ completion }: { readonly completion: ProjectExportCompletion }) {
  return (
    <section aria-label={messages.projectExportSummary} className="project-export-summary">
      <h3>{messages.projectExportSaved}</h3>
      <p>{messages.projectExportSavedTo(completion.location)}</p>
      <p>{messages.projectExportFileSize(completion.fileSizeBytes)}</p>
      {isMesh(completion.format) && (
        <>
          <p>{messages.projectExportTriangles(
            completion.triangleCount ?? messages.projectExportFactUnavailable,
          )}</p>
          <p>{messages.projectExportBoundingBox(completion.boundingBox
            ? messages.dimensionsMillimeters(completion.boundingBox.size)
            : messages.projectExportFactUnavailable)}</p>
        </>
      )}
      {completion.diagnostics.length > 0 && (
        <details>
          <summary>{messages.projectExportEngineMessages(completion.diagnostics.length)}</summary>
          <pre>{completion.diagnostics.map((diagnostic) => messages.projectExportDiagnostic(
            diagnostic.severity,
            diagnostic.message,
            diagnostic.file,
            diagnostic.line,
          )).join("\n")}</pre>
        </details>
      )}
    </section>
  );
}

export function ProjectExportDialog({
  entryFile,
  destinationDescription,
  modelKind = "3d",
  openRequest,
  startExport,
  parameterSets = [],
  startBatchExport,
}: ProjectExportDialogProps) {
  const [open, setOpen] = useState(openRequest !== undefined);
  const [format, setFormat] = useState<ExportFormat>(() => defaultExportFormat(modelKind));
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completion, setCompletion] = useState<ProjectExportCompletion | null>(null);
  const [operationContext, setOperationContext] = useState<ExportContext | null>(null);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [selectedSetNames, setSelectedSetNames] = useState<ReadonlySet<string>>(
    () => new Set(parameterSets.map(({ name }) => name)),
  );
  const [fileNameTemplate, setFileNameTemplate] = useState("{model}-{set}.{ext}");
  const [batchState, setBatchState] = useState<BatchExportState | null>(null);
  const activeOperation = useRef<ProjectExportOperation | null>(null);
  const activeBatchOperation = useRef<BatchProjectExportOperation | null>(null);
  const batchUnsubscribe = useRef<(() => void) | null>(null);
  const handledOpenRequest = useRef(openRequest);

  const showDialog = useCallback(() => {
    setFormat(defaultExportFormat(modelKind));
    setCompletion(null);
    setOperationContext(null);
    setError(null);
    setCancelling(false);
    setMode("single");
    setSelectedSetNames(new Set(parameterSets.map(({ name }) => name)));
    setFileNameTemplate("{model}-{set}.{ext}");
    setBatchState(null);
    setOpen(true);
  }, [modelKind, parameterSets]);
  useEffect(() => {
    if (openRequest === undefined || handledOpenRequest.current === openRequest) return;
    handledOpenRequest.current = openRequest;
    showDialog();
  }, [openRequest, showDialog]);
  useEffect(() => () => batchUnsubscribe.current?.(), []);
  const closeDialog = () => {
    if (!busy) setOpen(false);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setCancelling(false);
    setError(null);
    setCompletion(null);
    setBatchState(null);
    setOperationContext({ entryFile, destinationDescription });
    if (mode === "batch") {
      if (!startBatchExport) {
        setError(errorMessage(new Error(messages.projectBatchExportUnavailable)));
        setBusy(false);
        return;
      }
      const selectedSets = parameterSets.filter(({ name }) => selectedSetNames.has(name));
      let operation: BatchProjectExportOperation;
      try {
        operation = startBatchExport(format, selectedSets, fileNameTemplate);
        activeBatchOperation.current = operation;
        setBatchState(operation.getState());
        batchUnsubscribe.current = operation.subscribe(setBatchState);
      } catch (reason) {
        setOperationContext(null);
        setError(errorMessage(reason));
        setBusy(false);
        return;
      }
      void operation.done.then(
        setBatchState,
        (reason) => setError(errorMessage(reason)),
      ).finally(() => {
        if (activeBatchOperation.current === operation) {
          batchUnsubscribe.current?.();
          batchUnsubscribe.current = null;
          activeBatchOperation.current = null;
          setBusy(false);
          setCancelling(false);
        }
      });
      return;
    }
    let operation: ProjectExportOperation;
    try {
      operation = startExport(format);
      activeOperation.current = operation;
    } catch (reason) {
      setOperationContext(null);
      setError(errorMessage(reason));
      setBusy(false);
      return;
    }
    void operation.done.then(
      (result) => {
        if (activeOperation.current === operation) setCompletion(result);
      },
      (reason) => {
        if (activeOperation.current === operation) setError(errorMessage(reason));
      },
    ).finally(() => {
      if (activeOperation.current === operation) {
        activeOperation.current = null;
        setBusy(false);
        setCancelling(false);
      }
    });
  };
  const cancel = () => {
    if (cancelling) return;
    const operation = activeOperation.current ?? activeBatchOperation.current;
    if (!operation) return;
    operation.cancel();
    setCancelling(true);
  };
  const displayedEntryFile = operationContext?.entryFile ?? entryFile;
  const displayedDestination = operationContext?.destinationDescription ?? destinationDescription;

  return (
    <div className="project-export">
      <button onClick={showDialog} type="button">{messages.openProjectExport}</button>
      {open && (
        <section
          aria-labelledby="project-export-title"
          aria-modal="true"
          className="project-export-dialog"
          role="dialog"
        >
          <h2 id="project-export-title">{messages.projectExportTitle(displayedEntryFile)}</h2>
          <p>{messages.projectExportFullQualityNotice}</p>
          <form onSubmit={submit}>
            {startBatchExport && parameterSets.length > 0 ? (
              <fieldset disabled={busy}>
                <legend>{messages.projectExportScope}</legend>
                <label>
                  <input
                    checked={mode === "single"}
                    name="project-export-scope"
                    onChange={() => setMode("single")}
                    type="radio"
                  />
                  {messages.projectExportSingle}
                </label>
                <label>
                  <input
                    checked={mode === "batch"}
                    name="project-export-scope"
                    onChange={() => setMode("batch")}
                    type="radio"
                  />
                  {messages.projectExportBatch}
                </label>
              </fieldset>
            ) : null}
            <label>
              {messages.projectExportFormat}
              <select
                disabled={busy}
                onChange={(event) => setFormat(event.currentTarget.value as ExportFormat)}
                value={format}
              >
                {PROJECT_EXPORT_FORMATS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            {format === "3mf" && <p role="note">{messages.slicerFilamentHonesty}</p>}
            {mode === "batch" && startBatchExport ? (
              <fieldset disabled={busy}>
                <legend>{messages.projectBatchExportSets}</legend>
                {parameterSets.map((set) => (
                  <label key={set.name}>
                    <input
                      checked={selectedSetNames.has(set.name)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelectedSetNames((current) => {
                          const next = new Set(current);
                          if (checked) next.add(set.name);
                          else next.delete(set.name);
                          return next;
                        });
                      }}
                      type="checkbox"
                    />
                    {set.name}
                  </label>
                ))}
                <label>
                  {messages.projectBatchExportTemplate}
                  <input
                    onChange={(event) => setFileNameTemplate(event.currentTarget.value)}
                    value={fileNameTemplate}
                  />
                </label>
              </fieldset>
            ) : null}
            <dl>
              <dt>{messages.projectExportDestination}</dt>
              <dd>{displayedDestination}</dd>
            </dl>
            <div className="project-export-actions">
              <button
                disabled={busy || (mode === "batch" && selectedSetNames.size === 0)}
                type="submit"
              >
                {mode === "batch" ? messages.projectBatchExportAction : messages.projectExportAction}
              </button>
              {busy && (
                <button disabled={cancelling} onClick={cancel} type="button">
                  {cancelling ? messages.cancellingProjectExport : messages.cancelProjectExport}
                </button>
              )}
              <button disabled={busy} onClick={closeDialog} type="button">
                {messages.closeProjectExport}
              </button>
            </div>
          </form>
          {busy && (
            <p aria-live="polite">
              {cancelling
                ? messages.projectExportCancellingProgress
                : messages.projectExportProgress}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {completion && <ExportSummary completion={completion} />}
          {batchState && (
            <section aria-label={messages.projectBatchExportProgress}>
              <p>{messages.projectBatchExportCompleted(batchState.completed, batchState.total)}</p>
              <ol>
                {batchState.items.map((item) => (
                  <li key={item.setName}>{batchItemLabel(item)}</li>
                ))}
              </ol>
            </section>
          )}
        </section>
      )}
    </div>
  );
}
