import { useEffect, useRef, useState } from "react";

import {
  isDocumentDirty,
  type DocumentWorkspaceState,
} from "../../application/documents/document-workspace";
import type { ProjectSessionState } from "../../application/files/project-session";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import {
  BUILT_IN_SAMPLES,
  type BuiltInSample,
} from "../../application/welcome/built-in-samples";
import { messages } from "../../messages/en";

export interface WelcomeLauncherProps {
  readonly documents: DocumentWorkspaceState;
  readonly project: ProjectSessionState;
  readonly runtime: WorkbenchRuntime;
  readonly showOnLaunch: boolean;
  onNewFile(): void;
  onOpenProject(): void;
  onOpenRecentProject(projectId: string, displayName: string): void;
  onShowOnLaunchChange(show: boolean): void;
}

export function WelcomeLauncher({
  documents,
  project,
  runtime,
  showOnLaunch,
  onNewFile,
  onOpenProject,
  onOpenRecentProject,
  onShowOnLaunchChange,
}: WelcomeLauncherProps) {
  const [open, setOpen] = useState(showOnLaunch);
  const [showAtStartup, setShowAtStartup] = useState(showOnLaunch);
  const [pendingSample, setPendingSample] = useState<BuiltInSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const pristineScratch = project.mode === "scratch"
    && documents.documents.length === 1
    && !isDocumentDirty(documents.documents[0])
    && documents.documents[0].source.trim().length === 0;

  useEffect(() => {
    if (open) firstAction.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setPendingSample(null);
    setError(null);
    globalThis.setTimeout(() => launcher.current?.focus(), 0);
  };
  const openSample = async (sample: BuiltInSample) => {
    setError(null);
    try {
      await runtime.dispatch({
        kind: "open-welcome-sample-confirmed",
        origin: "user",
        documentId: runtime.documents.getInitialState().documents[0].id,
        path: sample.path,
        source: sample.source,
      });
      close();
    } catch (reason) {
      setPendingSample(null);
      setError(reason instanceof Error ? reason.message : messages.welcomeSampleFailed);
    }
  };
  const requestSample = (sample: BuiltInSample) => {
    if (pristineScratch) void openSample(sample);
    else setPendingSample(sample);
  };
  const updateStartupPreference = (next: boolean) => {
    setError(null);
    try {
      onShowOnLaunchChange(next);
      setShowAtStartup(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : messages.welcomePreferenceCouldNotBeSaved);
    }
  };

  return (
    <>
      <button
        className="welcome-launcher"
        onClick={() => { setOpen(true); setError(null); }}
        ref={launcher}
        type="button"
      >{messages.openWelcome}</button>
      {open && (
        <div className="welcome-modal-layer">
          <section
            aria-label={messages.welcomeTitle}
            aria-modal="true"
            className="welcome-dialog"
            onKeyDown={(event) => { if (event.key === "Escape") close(); }}
            role="dialog"
          >
            <header className="welcome-header">
              <div>
                <span className="welcome-mark" aria-hidden="true">S</span>
                <div><h2>{messages.welcomeTitle}</h2><p>{messages.welcomeIntro}</p></div>
              </div>
              <button aria-label={messages.closeWelcome} onClick={close} type="button">Close</button>
            </header>
            {pendingSample ? (
              <section aria-label={messages.replaceCurrentWork} className="welcome-confirmation" role="alertdialog">
                <h3>{messages.replaceCurrentWork}</h3>
                <p>{messages.replaceCurrentWorkDetail(pendingSample.name)}</p>
                <div>
                  <button onClick={() => setPendingSample(null)} type="button">{messages.cancelWelcomeReplacement}</button>
                  <button onClick={() => void openSample(pendingSample)} type="button">
                    {messages.replaceWithSample(pendingSample.name)}
                  </button>
                </div>
              </section>
            ) : (
              <div className="welcome-content">
                <section className="welcome-start">
                  <h3>{messages.welcomeStart}</h3>
                  <div>
                    <button ref={firstAction} onClick={() => { if (!pristineScratch) onNewFile(); close(); }} type="button">
                      {messages.newFile}
                    </button>
                    <button onClick={() => { onOpenProject(); close(); }} type="button">{messages.openProject}</button>
                  </div>
                  <h3>{messages.recentProjects}</h3>
                  {project.recentProjects.length === 0
                    ? <p>{messages.noRecentProjects}</p>
                    : <ul>{project.recentProjects.map(({ projectId, displayName }) => (
                      <li key={projectId}>
                        <button onClick={() => { onOpenRecentProject(projectId, displayName); close(); }} type="button">
                          {messages.reopenProject(displayName)}
                        </button>
                      </li>
                    ))}</ul>}
                </section>
                <section className="welcome-samples">
                  <h3>{messages.builtInSamples}</h3>
                  <div className="welcome-sample-grid">
                    {BUILT_IN_SAMPLES.map((sample) => (
                      <article key={sample.id}>
                        <span aria-hidden="true" className="welcome-sample-icon">{sample.dimension === "3d" ? "3D" : "2D"}</span>
                        <div><h4>{sample.name}</h4><p>{sample.summary}</p></div>
                        <button aria-label={messages.openSample(sample.name)} onClick={() => requestSample(sample)} type="button">
                          {messages.openSampleAction}
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            )}
            {error && <p className="welcome-error" role="alert">{error}</p>}
            <footer>
              <label className="welcome-startup-toggle">
                <input
                  aria-label={messages.showWelcomeOnStartup}
                  checked={showAtStartup}
                  onChange={(event) => updateStartupPreference(event.currentTarget.checked)}
                  type="checkbox"
                />
                {messages.showWelcomeOnStartup}
              </label>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
