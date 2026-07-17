import { describe, expect, it, vi } from "vitest";

import { createTauriRenderCacheStorage } from "../../src/platform-desktop/tauri-render-cache";

describe("Tauri render cache storage", () => {
  it("maps binary read/write and touch/remove commands without exposing filesystem paths", async () => {
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "render_cache_read") return Promise.resolve([1, 2, 3]);
      return Promise.resolve(undefined);
    });
    const storage = createTauriRenderCacheStorage(invoke);
    const key = `sha256:${"a".repeat(64)}`;
    await expect(storage.read("C:\\project", key)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await storage.write("C:\\project", key, new Uint8Array([4, 5]), 512);
    if (storage.touch) await storage.touch("C:\\project", key, 10);
    await storage.remove("C:\\project", key);
    if (storage.clear) await storage.clear("C:\\project");

    expect(invoke).toHaveBeenCalledWith("render_cache_write", {
      projectIdentity: "C:\\project",
      key,
      bytes: new Uint8Array([4, 5]),
      maxBytes: 512,
    });
    expect(invoke).toHaveBeenCalledWith("render_cache_touch", { projectIdentity: "C:\\project", key });
    expect(invoke).toHaveBeenCalledWith("render_cache_remove", { projectIdentity: "C:\\project", key });
    expect(invoke).toHaveBeenCalledWith("render_cache_clear", { projectIdentity: "C:\\project" });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("project\\\\");
  });

  it("filters malformed list records and accepts both byte-array and Uint8Array reads", async () => {
    const invoke = vi.fn().mockImplementation((command: string) => {
      if (command === "render_cache_read") return Promise.resolve(new Uint8Array([8]));
      if (command === "render_cache_list") return Promise.resolve([
        { key: `sha256:${"a".repeat(64)}`, byteSize: 4, lastAccessMs: 2 },
        { key: "bad", byteSize: "4", lastAccessMs: 2 },
      ]);
      return Promise.resolve(undefined);
    });
    const storage = createTauriRenderCacheStorage(invoke);
    await expect(storage.read("project", "key")).resolves.toEqual(new Uint8Array([8]));
    await expect(storage.list("project")).resolves.toEqual([{ key: `sha256:${"a".repeat(64)}`, byteSize: 4, lastAccessMs: 2 }]);
  });

  it("keeps maxBytes optional for direct best-effort writes", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const storage = createTauriRenderCacheStorage(invoke);
    const key = `sha256:${"b".repeat(64)}`;

    await storage.write("project", key, new Uint8Array([1]));

    expect(invoke).toHaveBeenCalledWith("render_cache_write", {
      projectIdentity: "project",
      key,
      bytes: new Uint8Array([1]),
    });
  });
});
