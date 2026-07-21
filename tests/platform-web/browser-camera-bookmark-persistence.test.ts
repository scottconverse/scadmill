import { describe, expect, it, vi } from "vitest";

import { createBrowserCameraBookmarkPersistence } from "../../src/platform-web/browser-camera-bookmark-persistence";

describe("createBrowserCameraBookmarkPersistence", () => {
  it("keeps each project under a distinct subpath-safe profile key", () => {
    const storage = { getItem: vi.fn(() => "saved"), setItem: vi.fn() };
    const persistence = createBrowserCameraBookmarkPersistence(storage);

    expect(persistence.load("project/a")).toBe("saved");
    persistence.save("project/a", "next");

    expect(storage.getItem).toHaveBeenCalledWith("scadmill:camera-bookmarks:v1:project%2Fa");
    expect(storage.setItem).toHaveBeenCalledWith("scadmill:camera-bookmarks:v1:project%2Fa", "next");
  });

  it("rejects an empty or unbounded workspace identity", () => {
    const persistence = createBrowserCameraBookmarkPersistence({ getItem: vi.fn(), setItem: vi.fn() });
    expect(() => persistence.load(" ")).toThrow(/identity/i);
    expect(() => persistence.save("x".repeat(257), "bookmarks")).toThrow(/identity/i);
  });
});
