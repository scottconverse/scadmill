import { describe, expect, it } from "vitest";

import type { RenderState } from "../../src/application/runtime/workbench-runtime";
import { messages } from "../../src/messages/en";
import { renderStatusLabel } from "../../src/ui/workbench-status";

describe("workbench render status", () => {
  it("reports a completed cancellation as cancelled rather than failed", () => {
    const render: RenderState = {
      status: "failure",
      entryFile: "main.scad",
      result: {
        kind: "failure",
        reason: "cancelled",
        diagnostics: [],
        rawLog: "cancelled",
      },
    };

    expect(renderStatusLabel(render, false, "main.scad")).toBe(messages.renderCancelledStatus);
  });
});
