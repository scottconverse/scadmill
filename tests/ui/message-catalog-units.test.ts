import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sources = {
  console: readFileSync(new URL("../../src/ui/diagnostics/DiagnosticConsole.tsx", import.meta.url), "utf8"),
  exportDialog: readFileSync(new URL("../../src/ui/files/ProjectExportDialog.tsx", import.meta.url), "utf8"),
  details: readFileSync(new URL("../../src/ui/viewer/ViewerDetailsPanel.tsx", import.meta.url), "utf8"),
  pane: readFileSync(new URL("../../src/ui/viewer/ViewerPane.tsx", import.meta.url), "utf8"),
  overlays: readFileSync(new URL("../../src/ui/viewer/model-viewer-overlays.tsx", import.meta.url), "utf8"),
  progress: readFileSync(new URL("../../src/ui/viewer/RenderProgressOverlay.tsx", import.meta.url), "utf8"),
};
const rawUnitPatterns = [
  /\bmm(?:\/px)?\b/u,
  /toFixed\([^)]*\)\}\s*s\b/u,
];

function hasRawUnitLiteral(source: string): boolean {
  return rawUnitPatterns.some((pattern) => pattern.test(source));
}

describe("user-visible unit localization", () => {
  it("routes elapsed-time, distance, and dimension units through the message catalog", () => {
    expect(sources.console).toContain("messages.consoleElapsedSeconds(");
    expect(sources.exportDialog).toContain("messages.dimensionsMillimeters(");
    expect(sources.details).toContain("messages.millimeters(");
    expect(sources.pane).toContain("messages.dimensionsMillimeters(");
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
