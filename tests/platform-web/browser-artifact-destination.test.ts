import { expect, it, vi } from "vitest";

import {
  createBrowserArtifactDestination,
} from "../../src/platform-web/browser-artifact-destination";

it("downloads artifact bytes with a sanitized suggested name and releases the object URL", async () => {
  const createUrl = vi.fn().mockReturnValue("blob:scadmill-artifact");
  const triggerDownload = vi.fn();
  const revokeUrl = vi.fn();
  const destination = createBrowserArtifactDestination({
    createUrl,
    triggerDownload,
    revokeUrl,
  });

  const result = await destination.save({
    suggestedName: "../cube:preview.png",
    bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47),
    mimeType: "image/png",
  });

  const blob = createUrl.mock.calls[0]?.[0] as Blob;
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.of(0x89, 0x50, 0x4e, 0x47));
  expect(blob.type).toBe("image/png");
  expect(triggerDownload).toHaveBeenCalledWith("blob:scadmill-artifact", "cube-preview.png");
  expect(revokeUrl).toHaveBeenCalledWith("blob:scadmill-artifact");
  expect(result).toEqual({ location: "cube-preview.png" });
});
