import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sources = {
  console: readFileSync(new URL("../../src/ui/diagnostics/DiagnosticConsole.tsx", import.meta.url), "utf8"),
  exportDialog: readFileSync(new URL("../../src/ui/files/ProjectExportDialog.tsx", import.meta.url), "utf8"),
  details: readFileSync(new URL("../../src/ui/viewer/ViewerDetailsPanel.tsx", import.meta.url), "utf8"),
  pane: readFileSync(new URL("../../src/ui/viewer/ViewerPane.tsx", import.meta.url), "utf8"),
  overlays: readFileSync(new URL("../../src/ui/viewer/model-viewer-overlays.tsx", import.meta.url), "utf8"),
};

describe("user-visible unit localization", () => {
  it("routes elapsed-time, distance, and dimension units through the message catalog", () => {
    expect(sources.console).toContain("messages.consoleElapsedSeconds(");
    expect(sources.exportDialog).toContain("messages.dimensionsMillimeters(");
    expect(sources.details).toContain("messages.millimeters(");
    expect(sources.pane).toContain("messages.dimensionsMillimeters(");
    expect(sources.overlays).toContain("messages.millimeters(");
  });
});
