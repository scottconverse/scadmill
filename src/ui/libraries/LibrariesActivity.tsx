import { type FormEvent, useEffect, useMemo, useState } from "react";

import type { ProjectStorage } from "../../application/files/project-file-service";
import type { ProjectSessionState } from "../../application/files/project-session";
import {
  createCustomOpenScadLibraryDescriptor,
  createOpenScadLibraryManager,
  type CustomOpenScadLibraryInput,
  type InstalledOpenScadLibrary,
  type LibraryArchiveDownload,
  type OpenScadLibraryDescriptor,
  type PreparedOpenScadLibrary,
  WELL_KNOWN_OPENSCAD_LIBRARIES,
} from "../../application/libraries/library-manager";
import { messages } from "../../messages/en";
import "./libraries.css";

export interface LibrariesActivityProps {
  readonly project: ProjectSessionState;
  readonly storage?: ProjectStorage;
  readonly download?: LibraryArchiveDownload;
  readonly onProjectFilesChanged: () => Promise<void>;
}

const EMPTY_CUSTOM_LIBRARY: CustomOpenScadLibraryInput = {
  displayName: "",
  version: "",
  archiveUrl: "",
  sourceUrl: "",
  vendorDirectory: "",
  licenseSpdxId: "",
  licenseUrl: "",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : messages.libraryUnknownError;
}

export function LibrariesActivity({
  project,
  storage,
  download,
  onProjectFilesChanged,
}: LibrariesActivityProps) {
  const manager = useMemo(
    () => storage && project.mode === "project"
      ? createOpenScadLibraryManager({ projectId: project.snapshot.projectId, storage, download })
      : undefined,
    [download, project.mode, project.snapshot.projectId, storage],
  );
  const [installed, setInstalled] = useState<readonly InstalledOpenScadLibrary[]>([]);
  const [prepared, setPrepared] = useState<PreparedOpenScadLibrary>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [custom, setCustom] = useState<CustomOpenScadLibraryInput>(EMPTY_CUSTOM_LIBRARY);

  useEffect(() => {
    let active = true;
    setPrepared(undefined);
    setError(undefined);
    if (!manager) {
      setInstalled([]);
      return () => { active = false; };
    }
    setBusy("manifest");
    void manager.installed().then(
      (libraries) => { if (active) setInstalled(libraries); },
      (reason) => { if (active) setError(errorMessage(reason)); },
    ).finally(() => { if (active) setBusy(undefined); });
    return () => { active = false; };
  }, [manager]);

  if (project.mode !== "project") {
    return <p className="libraries-empty">{messages.libraryProjectRequired}</p>;
  }
  if (!manager) {
    return <p className="libraries-empty" role="alert">{messages.projectStorageUnavailable}</p>;
  }

  const review = async (descriptor: OpenScadLibraryDescriptor) => {
    setBusy(descriptor.id);
    setPrepared(undefined);
    setError(undefined);
    try {
      setPrepared(await manager.prepare(descriptor));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };
  const install = async () => {
    if (!prepared) return;
    setBusy(prepared.descriptor.id);
    setError(undefined);
    try {
      const replacing = installed.some(({ id }) => id === prepared.descriptor.id);
      const result = await manager.install(prepared, { repin: replacing });
      setInstalled((current) => [
        ...current.filter(({ id }) => id !== result.id),
        result,
      ].sort((left, right) => left.displayName.localeCompare(right.displayName)));
      setPrepared(undefined);
      await onProjectFilesChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };
  const remove = async (library: InstalledOpenScadLibrary) => {
    setBusy(library.id);
    setError(undefined);
    try {
      await manager.remove(library.id);
      setInstalled((current) => current.filter(({ id }) => id !== library.id));
      if (prepared?.descriptor.id === library.id) setPrepared(undefined);
      await onProjectFilesChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };
  const reviewCustom = (event: FormEvent) => {
    event.preventDefault();
    try {
      void review(createCustomOpenScadLibraryDescriptor(custom));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <section aria-label={messages.libraryManager} className="libraries-activity">
      <p className="libraries-intro">{messages.libraryManagerIntro}</p>
      {error && <p className="libraries-error" role="alert">{messages.libraryActionFailed(error)}</p>}
      <div className="library-catalog">
        {WELL_KNOWN_OPENSCAD_LIBRARIES.map((descriptor) => {
          const current = installed.find(({ id }) => id === descriptor.id);
          const waiting = busy === descriptor.id;
          return (
            <article className="library-card" key={descriptor.id}>
              <header>
                <h2>{descriptor.displayName}</h2>
                <span>{current
                  ? messages.libraryInstalledVersion(current.version)
                  : messages.libraryNotInstalled}</span>
              </header>
              <p>{messages.libraryPinnedVersion(descriptor.version)}</p>
              <p>
                <a href={descriptor.license.url} rel="noreferrer" target="_blank">
                  {descriptor.license.spdxId}
                </a>
                {" · "}
                <a href={descriptor.sourceUrl} rel="noreferrer" target="_blank">
                  {messages.librarySource}
                </a>
              </p>
              <div className="library-actions">
                {(!current || current.version !== descriptor.version) && (
                  <button
                    aria-label={messages.libraryReviewLicense(descriptor.displayName)}
                    disabled={Boolean(busy)}
                    onClick={() => void review(descriptor)}
                    type="button"
                  >
                    {waiting ? messages.libraryDownloading : current
                      ? messages.libraryReviewUpdate
                      : messages.libraryReviewLicenseAction}
                  </button>
                )}
                {current && (
                  <button
                    aria-label={messages.libraryRemove(descriptor.displayName)}
                    disabled={Boolean(busy)}
                    onClick={() => void remove(current)}
                    type="button"
                  >
                    {messages.libraryRemoveAction}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <details className="library-custom">
        <summary>{messages.libraryCustomTitle}</summary>
        <p>{messages.libraryCustomWarning}</p>
        <form onSubmit={reviewCustom}>
          {([
            ["displayName", messages.libraryCustomName],
            ["version", messages.libraryCustomVersion],
            ["vendorDirectory", messages.libraryCustomDirectory],
            ["archiveUrl", messages.libraryCustomArchiveUrl],
            ["sourceUrl", messages.libraryCustomSourceUrl],
            ["licenseSpdxId", messages.libraryCustomLicenseId],
            ["licenseUrl", messages.libraryCustomLicenseUrl],
          ] as const).map(([field, label]) => (
            <label key={field}>
              <span>{label}</span>
              <input
                name={field}
                onChange={(event) => setCustom((value) => ({
                  ...value,
                  [field]: event.currentTarget.value,
                }))}
                required
                type={field.toLowerCase().includes("url") ? "url" : "text"}
                value={custom[field]}
              />
            </label>
          ))}
          <button disabled={Boolean(busy)} type="submit">
            {messages.libraryReviewCustomLicense}
          </button>
        </form>
      </details>

      {prepared && (
        <section aria-label={messages.libraryLicenseReview} className="library-license-review">
          <header>
            <h2>{messages.libraryLicenseTitle(
              prepared.descriptor.displayName,
              prepared.descriptor.version,
            )}</h2>
            <button onClick={() => setPrepared(undefined)} type="button">
              {messages.cancelFileAction}
            </button>
          </header>
          <p>{messages.libraryLicenseNotice}</p>
          <pre>{prepared.licenseText}</pre>
          <button disabled={Boolean(busy)} onClick={() => void install()} type="button">
            {installed.some(({ id }) => id === prepared.descriptor.id)
              ? messages.libraryRepin(prepared.descriptor.displayName, prepared.descriptor.version)
              : messages.libraryInstall(prepared.descriptor.displayName, prepared.descriptor.version)}
          </button>
        </section>
      )}
    </section>
  );
}
