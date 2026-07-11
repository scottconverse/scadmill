import { type ChangeEvent, useEffect, useState } from "react";

import {
  type ProjectPortabilityController,
  ShareLinkCopyError,
} from "../../application/files/project-portability";
import { messages } from "../../messages/en";
import "./project-portability.css";

export interface ProjectPortabilityPanelProps {
  readonly controller: ProjectPortabilityController;
  readonly handleStartupShare?: boolean;
  readonly showActions?: boolean;
}

function detail(reason: unknown): string {
  return reason instanceof Error ? reason.message : messages.projectPortabilityUnknownError;
}

export function ProjectPortabilityPanel({
  controller,
  handleStartupShare = true,
  showActions = true,
}: ProjectPortabilityPanelProps) {
  const [busy, setBusy] = useState<"share" | "export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [shareHref, setShareHref] = useState<string | null>(null);
  const [sharedOrigin, setSharedOrigin] = useState<string | null>(null);

  useEffect(() => {
    if (!handleStartupShare) return undefined;
    let mounted = true;
    void controller.openStartupShare().then((shared) => {
      if (mounted && shared) setSharedOrigin(shared.origin);
    }).catch((reason: unknown) => {
      if (mounted) setError(`${messages.sharedSourceOpenFailedPrefix} ${detail(reason)}`);
    });
    return () => { mounted = false; };
  }, [controller, handleStartupShare]);

  const copyShareLink = async () => {
    if (busy) return;
    setBusy("share");
    setError(null);
    setShareHref(null);
    try {
      const href = await controller.copyShareLink();
      setShareHref(href);
      setStatus(messages.shareLinkCopied);
    } catch (reason) {
      if (reason instanceof ShareLinkCopyError) {
        setShareHref(reason.href);
        setError(messages.shareLinkCopyManually);
      } else {
        setError(`${messages.shareLinkFailedPrefix} ${detail(reason)}`);
      }
    } finally {
      setBusy(null);
    }
  };
  const exportProjectZip = async () => {
    if (busy) return;
    setBusy("export");
    setError(null);
    try {
      const result = await controller.exportProjectZip();
      setStatus(messages.projectZipExported(result.location));
    } catch (reason) {
      setError(`${messages.projectZipExportFailedPrefix} ${detail(reason)}`);
    } finally {
      setBusy(null);
    }
  };
  const importProjectZip = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || busy) return;
    setBusy("import");
    setError(null);
    try {
      const imported = await controller.importProjectZip(file);
      setStatus(messages.projectZipImported(imported.displayName));
    } catch (reason) {
      setError(`${messages.projectZipImportFailedPrefix} ${detail(reason)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label={messages.projectPortability} className="project-portability">
      {sharedOrigin && (
        <aside aria-label={messages.sharedSourceNotice} className="shared-source-banner">
          <span>{messages.sharedSourceBanner(sharedOrigin)}</span>
          <button
            aria-label={messages.dismissSharedSourceBanner}
            onClick={() => setSharedOrigin(null)}
            type="button"
          >
            ×
          </button>
        </aside>
      )}
      {showActions && <div className="project-portability-actions">
        <button disabled={busy !== null} onClick={() => void copyShareLink()} type="button">
          {messages.copyShareLink}
        </button>
        <button
          disabled={busy !== null || !controller.artifactSavingAvailable}
          onClick={() => void exportProjectZip()}
          title={controller.artifactSavingAvailable ? undefined : messages.artifactSavingUnavailable}
          type="button"
        >
          {messages.exportProjectZip}
        </button>
        <label
          aria-disabled={busy !== null || !controller.projectImportAvailable}
          className="project-portability-import"
          title={controller.projectImportAvailable
            ? undefined
            : messages.projectStorageUnavailableForImport}
        >
          {messages.importProjectZip}
          <input
            accept=".zip,application/zip"
            aria-label={messages.importProjectZip}
            disabled={busy !== null || !controller.projectImportAvailable}
            onChange={(event) => void importProjectZip(event)}
            type="file"
          />
        </label>
      </div>}
      {showActions && !controller.projectImportAvailable && (
        <p role="note">{messages.projectStorageUnavailableForPortability}</p>
      )}
      {showActions && <p role="note">{messages.shareLinkPrivacyNote}</p>}
      {showActions && shareHref && (
        <input
          aria-label={messages.shareLinkValue}
          className="project-portability-share-link"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={shareHref}
        />
      )}
      {status && <p aria-live="polite" role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
