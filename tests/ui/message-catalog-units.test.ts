import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { messages } from "../../src/messages/en";

const sources = {
  consoleHistory: readFileSync(new URL("../../src/application/diagnostics/console-state.ts", import.meta.url), "utf8"),
  console: readFileSync(new URL("../../src/ui/diagnostics/DiagnosticConsole.tsx", import.meta.url), "utf8"),
  exportDialog: readFileSync(new URL("../../src/ui/files/ProjectExportDialog.tsx", import.meta.url), "utf8"),
  details: readFileSync(new URL("../../src/ui/viewer/ViewerDetailsPanel.tsx", import.meta.url), "utf8"),
  pane: readFileSync(new URL("../../src/ui/viewer/ViewerPane.tsx", import.meta.url), "utf8"),
  boundsLabel: readFileSync(new URL("../../src/ui/viewer/viewer-bounds-label.ts", import.meta.url), "utf8"),
  overlays: readFileSync(new URL("../../src/ui/viewer/model-viewer-overlays.tsx", import.meta.url), "utf8"),
  parameterConnector: readFileSync(new URL("../../src/ui/parameters/ParameterPanelConnector.tsx", import.meta.url), "utf8"),
  progress: readFileSync(new URL("../../src/ui/viewer/RenderProgressOverlay.tsx", import.meta.url), "utf8"),
};
const rawUnitPatterns = [
  /\bmm(?:\/px)?\b/u,
  /\bms\b/u,
  /toFixed\([^)]*\)\}\s*s\b/u,
];

function hasRawUnitLiteral(source: string): boolean {
  return rawUnitPatterns.some((pattern) => pattern.test(source));
}

describe("user-visible unit localization", () => {
  it("routes elapsed-time, distance, and dimension units through the message catalog", () => {
    expect(sources.consoleHistory).toContain("messages.consoleRunning");
    expect(sources.consoleHistory).toContain("messages.consolePendingDuration");
    expect(sources.consoleHistory).toContain("messages.consoleDuration(");
    expect(sources.consoleHistory).toContain("messages.consoleExit(");
    expect(sources.consoleHistory).toContain("messages.consoleOutcome(");
    expect(sources.consoleHistory).toContain("messages.consoleQuality(");
    expect(sources.consoleHistory).toContain("messages.consoleSeverity(");
    expect(sources.consoleHistory).toContain("messages.consoleStream(");
    expect(sources.consoleHistory).toContain("messages.consoleElapsedSeconds(");
    expect(sources.consoleHistory).toContain("messages.consoleLinesDropped(");
    expect(sources.console).toContain("messages.consoleElapsedSeconds(");
    expect(sources.exportDialog).toContain("messages.dimensionsMillimeters(");
    expect(sources.details).toContain("messages.millimeters(");
    expect(sources.pane).toContain("boundsLabel(");
    expect(sources.boundsLabel).toContain("messages.dimensionsMillimeters(");
    expect(sources.overlays).toContain("messages.millimeters(");
    expect(sources.progress).toContain("messages.renderingElapsed(");
    for (const [name, source] of Object.entries(sources)) {
      expect(hasRawUnitLiteral(source), `${name} must not contain a raw unit literal`).toBe(false);
    }
  });

  it("detects the prior raw millimeter and compact-seconds forms", () => {
    expect(hasRawUnitLiteral("value mm")).toBe(true);
    expect(hasRawUnitLiteral("seconds.toFixed(3)}s")).toBe(true);
    expect(hasRawUnitLiteral("seconds.toFixed(1)} s")).toBe(true);
  });
});

describe("failure copy honesty", () => {
  it("does not guarantee settings rollback when persistence fails", () => {
    expect(messages.settingsSaveFailed).toContain("Review the current value");
    expect(messages.settingsSaveFailed).not.toMatch(/restored|unchanged/iu);
  });

  it("does not expose internal parameter-validation messages as localized UI copy", () => {
    expect(sources.parameterConnector).toContain("messages.parameterCommandFailed");
    expect(sources.parameterConnector).not.toContain("reason.message");
  });
});
