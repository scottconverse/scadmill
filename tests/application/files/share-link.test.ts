import { describe, expect, it, vi } from "vitest";

import {
  ShareLinkError,
  decodeShareLink,
  encodeShareLink,
} from "../../../src/application/files/share-link";

describe("share links", () => {
  it("round-trips UTF-8 source entirely in the URL fragment", async () => {
    const source = "// λ 🚀\nmodule part(size = 10) { cube(size); }\npart();\n";
    const link = await encodeShareLink(source, "https://scadmill.example/workbench?mode=web#old");

    expect(link).toMatch(/^https:\/\/scadmill\.example\/workbench\?mode=web#scadmill-share=v1\./u);
    expect(link.slice(0, link.indexOf("#"))).not.toContain(encodeURIComponent(source));
    await expect(decodeShareLink(link)).resolves.toEqual({
      source,
      origin: "scadmill.example",
    });
  });

  it("compresses repetitive source before enforcing the approximately 50 KiB cap", async () => {
    const source = "cube([10, 20, 30]);\n".repeat(10_000);
    const link = await encodeShareLink(source, "https://example.test/");

    expect(link.length).toBeLessThan(source.length / 10);
    expect((await decodeShareLink(link)).source).toBe(source);
  });

  it("rejects oversized and malformed fragments without returning partial source", async () => {
    const incompressible = Array.from({ length: 70_000 }, (_, index) =>
      String.fromCharCode(33 + ((index * 47 + Math.floor(index / 91)) % 90))).join("");

    await expect(
      encodeShareLink(incompressible, "https://example.test/", { compressedByteLimit: 128 }),
    ).rejects.toBeInstanceOf(ShareLinkError);
    await expect(
      decodeShareLink("https://example.test/#scadmill-share=v2.invalid"),
    ).rejects.toThrow(/unsupported/u);
    await expect(
      decodeShareLink("https://example.test/#scadmill-share=v1.!not-base64!"),
    ).rejects.toThrow(/malformed/u);
  });

  it("stops decompression at the source limit without materializing the full stream", async () => {
    const link = await encodeShareLink("cube(1);\n".repeat(1_000), "https://example.test/");
    const fullMaterialization = vi
      .spyOn(Response.prototype, "arrayBuffer")
      .mockRejectedValue(new Error("full stream materialization attempted"));
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");

    await expect(
      decodeShareLink(link, { sourceByteLimit: 32 }),
    ).rejects.toThrow(/decompressed share-link payload is too large/iu);
    expect(fullMaterialization).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects an oversized encoded fragment before base64 allocation", async () => {
    const decode = vi.spyOn(globalThis, "atob");
    const payload = "A".repeat(100_000);

    await expect(decodeShareLink(
      `https://example.test/#scadmill-share=v1.${payload}`,
      { compressedByteLimit: 16 },
    )).rejects.toThrow(/compressed share-link payload is too large/iu);
    expect(decode).not.toHaveBeenCalled();
  });
});
