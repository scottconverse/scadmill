import { expect, it, vi } from "vitest";

import {
  createTauriArtifactDestination,
} from "../../src/platform-desktop/tauri-artifact-destination";

it("sends artifact bytes to the native durable destination", async () => {
  const invoke = vi.fn().mockResolvedValue("C:\\Users\\Scott\\Downloads\\cube.png");
  const destination = createTauriArtifactDestination(invoke);

  await expect(destination.save({
    suggestedName: "cube.png",
    bytes: Uint8Array.of(0, 1, 254, 255),
    mimeType: "image/png",
  })).resolves.toEqual({ location: "C:\\Users\\Scott\\Downloads\\cube.png" });

  expect(invoke).toHaveBeenCalledWith("save_artifact", {
    suggestedName: "cube.png",
    contentsBase64: "AAH+/w==",
  });
});
