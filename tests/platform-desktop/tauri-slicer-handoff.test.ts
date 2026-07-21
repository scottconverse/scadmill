import { describe, expect, it, vi } from "vitest";

import { createTauriSlicerHandoff } from "../../src/platform-desktop/tauri-slicer-handoff";
import type { Invoke } from "../../src/platform-desktop/tauri-bridge";

describe("createTauriSlicerHandoff", () => {
  it("passes a defensive base64 copy and optional configured executable to the native command", async () => {
    const response = {
      slicerName: "OrcaSlicer",
      temporaryFile: "C:\\Temp\\ScadMill\\wheel.3mf",
    };
    const invoke = vi.fn(async () => response) as unknown as Invoke;
    const bytes = Uint8Array.of(80, 75, 3, 4);
    const service = createTauriSlicerHandoff(invoke);

    await expect(service.open({
      bytes,
      suggestedName: "../wheel.3mf",
      configuredExecutablePath: " C:\\Apps\\OrcaSlicer.exe ",
    })).resolves.toEqual({
      slicerName: "OrcaSlicer",
      temporaryFile: "C:\\Temp\\ScadMill\\wheel.3mf",
    });
    expect(invoke).toHaveBeenCalledWith("open_in_slicer", {
      contentsBase64: "UEsDBA==",
      suggestedName: "wheel.3mf",
      configuredExecutablePath: "C:\\Apps\\OrcaSlicer.exe",
    });
    expect(bytes).toEqual(Uint8Array.of(80, 75, 3, 4));
  });

  it("rejects malformed native success claims", async () => {
    const response = { slicerName: "", temporaryFile: 4 };
    const invoke = vi.fn(async () => response) as unknown as Invoke;
    const service = createTauriSlicerHandoff(invoke);
    await expect(service.open({ bytes: Uint8Array.of(1), suggestedName: "part.3mf" }))
      .rejects.toThrow(/invalid result/i);
  });
});
