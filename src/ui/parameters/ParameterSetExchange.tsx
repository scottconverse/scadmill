import { type ChangeEvent, useRef, useState } from "react";

import type { ArtifactDestination } from "../../application/files/artifact-destination";
import type { CustomizerParameter } from "../../application/parameters/customizer-schema";
import {
  decodeParameterSets,
  encodeParameterSets,
  type NamedParameterSet,
} from "../../application/parameters/parameter-set-codec";
import { messages } from "../../messages/en";

export const PARAMETER_SET_FILE_SIZE_LIMIT_BYTES = 1_048_576;

export interface ParameterSetExchangeProps {
  readonly artifactDestination: ArtifactDestination;
  readonly documentId: string;
  readonly parameters: readonly CustomizerParameter[];
  readonly sets: readonly NamedParameterSet[];
  readonly onReplaceSets: (sets: readonly NamedParameterSet[]) => void;
}

export function ParameterSetExchange({
  artifactDestination,
  documentId,
  parameters,
  sets,
  onReplaceSets,
}: ParameterSetExchangeProps) {
  const importRequest = useRef(0);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const exportSets = async () => {
    if (exporting || !artifactDestination.available) return;
    setExporting(true);
    setError(null);
    setStatus(null);
    try {
      const result = await artifactDestination.save({
        suggestedName: `${documentId}.json`,
        bytes: new TextEncoder().encode(encodeParameterSets(sets)),
        mimeType: "application/json",
      });
      setStatus(messages.parameterSetsExportedTo(result.location));
    } catch {
      setError(messages.parameterSetExportFailed);
    } finally {
      setExporting(false);
    }
  };

  const importSets = (event: ChangeEvent<HTMLInputElement>) => {
    const requestId = ++importRequest.current;
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError(null);
    setStatus(null);
    if (file.size > PARAMETER_SET_FILE_SIZE_LIMIT_BYTES) {
      setError(messages.parameterSetImportTooLarge);
      return;
    }
    void file.text().then((source) => {
      if (requestId !== importRequest.current) return;
      try {
        const imported = decodeParameterSets(source, parameters);
        onReplaceSets(imported);
        setStatus(messages.parameterSetsImported(imported.length));
      } catch {
        setError(messages.parameterSetImportFailed);
      }
    }).catch(() => {
      if (requestId === importRequest.current) setError(messages.parameterSetImportFailed);
    });
  };

  return (
    <div className="parameter-set-exchange">
      <button
        aria-label={messages.exportParameterSets}
        disabled={exporting || !artifactDestination.available}
        onClick={() => void exportSets()}
        title={artifactDestination.available ? undefined : messages.artifactSavingUnavailable}
        type="button"
      >{messages.exportParameterSets}</button>
      <label aria-disabled={exporting}>
        <span>{messages.importParameterSets}</span>
        <input
          accept="application/json,.json"
          aria-label={messages.importParameterSets}
          disabled={exporting}
          onChange={importSets}
          type="file"
        />
      </label>
      {status && (
        <p aria-label={messages.parameterSetTransferStatus} role="status">{status}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
