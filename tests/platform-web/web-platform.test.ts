// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { createWebPlatform } from "../../src/platform-web/web-platform";

describe("web platform composition", () => {
  it("declares only capabilities the browser implementation can provide", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const platform = createWebPlatform();

    expect(platform.kind).toBe("web");
    expect(platform.menus.presentation).toBe("web");
    expect(platform.wasm.available).toBe(true);
    expect(platform.files.revealInOs.available).toBe(false);
    expect(platform.files.trashInOs.available).toBe(false);
    expect(platform.files.fileAssociations.available).toBe(false);
    expect(platform.files.slicerHandoff.available).toBe(false);
    expect(platform.mcp.available).toBe(false);
    expect(platform.windowControls.available).toBe(false);
    expect(platform.dialogs.openDirectory.available).toBe(false);
    expect(platform.dialogs.saveFile.available).toBe(false);
    expect(platform.dialogs.message.available).toBe(true);
    expect(platform.engineVersionManager.available).toBe(false);

    await platform.clipboard.writeText("copied through the platform port");
    expect(writeText).toHaveBeenCalledWith("copied through the platform port");
  });
});
