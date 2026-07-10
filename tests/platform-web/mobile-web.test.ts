import { describe, expect, it } from "vitest";

import { isMobileWebClient } from "../../src/platform-web/mobile-web";

describe("isMobileWebClient", () => {
  it("prefers the browser mobile client hint when available", () => {
    expect(isMobileWebClient({ userAgent: "Desktop", userAgentData: { mobile: true } })).toBe(true);
    expect(isMobileWebClient({ userAgent: "Android Mobile", userAgentData: { mobile: false } })).toBe(false);
  });

  it("falls back to mobile user agents and touch-mode iPadOS", () => {
    expect(isMobileWebClient({ userAgent: "Mozilla/5.0 (Linux; Android 15) Mobile" })).toBe(true);
    expect(
      isMobileWebClient({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }),
    ).toBe(true);
    expect(
      isMobileWebClient({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", platform: "Win32", maxTouchPoints: 0 }),
    ).toBe(false);
  });
});
