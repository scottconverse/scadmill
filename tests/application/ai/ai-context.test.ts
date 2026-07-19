import { describe, expect, it } from "vitest";

import { buildAiContextMessage, DEFAULT_AI_CONTEXT_TOGGLES } from "../../../src/application/ai/ai-context";

describe("AI per-send context", () => {
  const inputs = { source: "cube(10);", diagnostics: ["warning: unused variable"], parameters: ["size: number"], screenshotDataUrl: "data:image/png;base64,abc" };

  it("includes only explicitly enabled context sections", () => {
    const message = buildAiContextMessage(inputs, { ...DEFAULT_AI_CONTEXT_TOGGLES, source: false, diagnostics: false, screenshot: true });
    expect(message).not.toContain("<current-file>");
    expect(message).not.toContain("<diagnostics>");
    expect(message).toContain("<parameters>");
    expect(message).toContain("<viewer-screenshot>");
  });

  it("bounds oversized source context and discloses truncation", () => {
    const message = buildAiContextMessage({ ...inputs, source: "x".repeat(128_001) }, DEFAULT_AI_CONTEXT_TOGGLES);
    expect(message).toContain("[truncated]");
    expect(message.length).toBeLessThan(130_000);
  });

  it("rejects an oversized screenshot instead of truncating it into invalid image data", () => {
    expect(() => buildAiContextMessage(
      { ...inputs, screenshotDataUrl: `data:image/png;base64,${"A".repeat(2_000_001)}` },
      { ...DEFAULT_AI_CONTEXT_TOGGLES, screenshot: true },
    )).toThrow("Viewer screenshot exceeds the AI context size limit.");
  });
});
