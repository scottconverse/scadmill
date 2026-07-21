import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Workbench cache-paint boundary", () => {
  it("keeps cache status and History subscriptions out of the expensive root", () => {
    const source = readFileSync(new URL("../../src/ui/Workbench.tsx", import.meta.url), "utf8");

    expect(source).toContain("sameRenderStateExceptCached");
    expect(source).toContain("<RenderStatusText");
    expect(source).toContain("<HistoryActivityConnector");
    expect(source).not.toContain("useReadonlyStore(runtime.history,");
    expect(source).not.toContain("useReadonlyStore(runtime.historyDetails,");
    expect(source).not.toContain("renderStatusLabel(render,");
  });
});
