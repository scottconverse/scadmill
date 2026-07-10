import { lazy, Suspense } from "react";
import type { RenderSuccess3D } from "../application/engine/contracts";
import type { WorkbenchRuntime } from "../application/runtime/workbench-runtime";
import type { ThemePreference } from "../application/theme/theme-runtime";
import type { ThemeTokens } from "../application/theme/theme-schema";
import { messages } from "../messages/en";
import { useReadonlyStore } from "./use-readonly-store";
import "./workbench.css";

const CodeEditor = lazy(() => import("./editor/CodeEditor").then((module) => ({ default: module.CodeEditor })));
const ModelViewer = lazy(() => import("./viewer/ModelViewer").then((module) => ({ default: module.ModelViewer })));

export interface WorkbenchProps {
  runtime: WorkbenchRuntime;
  engineLabel: string;
  engineAvailable?: boolean;
  activeTheme: ThemeTokens;
  themePreference: ThemePreference;
  onThemePreferenceChange(preference: ThemePreference): void;
}

function boundsLabel(result?: RenderSuccess3D): string | null {
  const bounds = result?.stats.boundingBox;
  if (!bounds) return null;
  const size = bounds.max.map((maximum, axis) => maximum - bounds.min[axis]);
  return `${size.map((value) => Number(value.toFixed(3))).join(" \u00d7 ")} mm`;
}

export function Workbench({
  runtime,
  engineLabel,
  engineAvailable = true,
  activeTheme,
  themePreference,
  onThemePreferenceChange,
}: WorkbenchProps) {
  const document = useReadonlyStore(runtime.documents, (state) => state);
  const render = useReadonlyStore(runtime.render, (state) => state);
  const result = render.result?.kind === "3d" ? render.result : undefined;
  const measuredBounds = boundsLabel(result);

  return (
    <main className="workbench">
      <header className="titlebar">
        <div>
          <span className="brand-mark" aria-hidden="true">S</span>
          <h1>{messages.appName}</h1>
        </div>
        <div className="titlebar-actions">
          <button
            className="render-button"
            disabled={!engineAvailable || render.status === "rendering"}
            onClick={() =>
              void runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" })
            }
            type="button"
          >
            {render.status === "rendering" ? messages.rendering : messages.renderPreview}
          </button>
        </div>
      </header>

      {!engineAvailable && <div className="engine-banner" role="status">{messages.engineUnavailable}</div>}

      <div className="workspace-grid">
        <section className="editor-panel" aria-label={messages.editorRegion}>
          <div className="panel-heading">
            <span>{document.path}</span>
            {document.dirty && (
              <span className="dirty-marker" role="status">
                <span className="visually-hidden">Unsaved changes</span>{"\u25cf"}
              </span>
            )}
          </div>
          <Suspense fallback={<div className="surface-loading" role="status">{messages.loadingEditor}</div>}>
            <CodeEditor
              value={document.source}
              label={messages.editorRegion}
              onChange={(source) => void runtime.dispatch({ kind: "edit-document", origin: "user", source })}
            />
          </Suspense>
        </section>

        <section className="viewer-panel" aria-label={messages.viewerRegion}>
          <div className="panel-heading viewer-heading">
            <span>{messages.viewerRegion}</span>
            {render.quality === "preview" && render.status === "success" && (
              <span className="quality-badge">{messages.previewQuality}</span>
            )}
          </div>
          <Suspense fallback={<div className="surface-loading" role="status">{messages.loadingViewer}</div>}>
            <ModelViewer result={result} colors={activeTheme.viewer} />
          </Suspense>
          {measuredBounds && <output className="bounds-readout">{measuredBounds}</output>}
          {render.result?.kind === "failure" && (
            <div className="render-error" role="alert">{render.result.rawLog}</div>
          )}
        </section>
      </div>

      <footer className="statusbar">
        <span>{engineLabel}</span>
        <span>{render.status === "success" ? `Rendered ${render.result?.kind ?? ""}` : render.status}</span>
        <span>{messages.untitledStatus}</span>
        <label className="theme-picker">
          <span>{messages.themeLabel}</span>
          <select
            aria-label={messages.themeLabel}
            value={themePreference}
            onChange={(event) =>
              onThemePreferenceChange(event.currentTarget.value as ThemePreference)
            }
          >
            <option value="system">{messages.themeSystem}</option>
            <option value="light">{messages.themeLight}</option>
            <option value="dark">{messages.themeDark}</option>
            <option value="high-contrast">{messages.themeHighContrast}</option>
          </select>
        </label>
      </footer>
    </main>
  );
}
