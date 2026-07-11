import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import type { ExportFormat } from "../../application/engine/contracts";
import { defaultExportFormat } from "../../application/files/export-flow";
import type {
  ProjectExportCompletion,
  ProjectExportOperation,
} from "../../application/files/project-export";
import { messages } from "../../messages/en";

export interface ProjectExportDialogProps {
  readonly entryFile: string;
  readonly destinationDescription: string;
  readonly modelKind?: "2d" | "3d";
  readonly openRequest?: number;
  readonly startExport: (format: ExportFormat) => ProjectExportOperation;
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
            ? `${completion.boundingBox.size.join(" × ")} mm`
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
}: ProjectExportDialogProps) {
  const [open, setOpen] = useState(openRequest !== undefined);
  const [format, setFormat] = useState<ExportFormat>(() => defaultExportFormat(modelKind));
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completion, setCompletion] = useState<ProjectExportCompletion | null>(null);
  const [operationContext, setOperationContext] = useState<ExportContext | null>(null);
  const activeOperation = useRef<ProjectExportOperation | null>(null);
  const handledOpenRequest = useRef(openRequest);

  const showDialog = useCallback(() => {
    setFormat(defaultExportFormat(modelKind));
    setCompletion(null);
    setOperationContext(null);
    setError(null);
    setCancelling(false);
    setOpen(true);
  }, [modelKind]);
  useEffect(() => {
    if (openRequest === undefined || handledOpenRequest.current === openRequest) return;
    handledOpenRequest.current = openRequest;
    showDialog();
  }, [openRequest, showDialog]);
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
    setOperationContext({ entryFile, destinationDescription });
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
    if (!activeOperation.current || cancelling) return;
    activeOperation.current.cancel();
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
            <dl>
              <dt>{messages.projectExportDestination}</dt>
              <dd>{displayedDestination}</dd>
            </dl>
            <div className="project-export-actions">
              <button disabled={busy} type="submit">{messages.projectExportAction}</button>
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
        </section>
      )}
    </div>
  );
}
