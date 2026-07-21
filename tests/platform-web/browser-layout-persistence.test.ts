import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_LAYOUT_STORAGE_KEY,
  createBrowserLayoutPersistence,
} from "../../src/platform-web/browser-layout-persistence";

describe("createBrowserLayoutPersistence", () => {
  it("loads and saves the browser-profile layout under one versioned key", () => {
    const storage = {
      getItem: vi.fn(() => "persisted-layout"),
      setItem: vi.fn(),
    };
    const persistence = createBrowserLayoutPersistence(storage);

    expect(persistence.load("workspace-a")).toBe("persisted-layout");
    persistence.save("workspace-a", "next-layout");
    expect(persistence.load("workspace-b")).toBe("persisted-layout");

    expect(storage.getItem).toHaveBeenCalledTimes(2);
    expect(storage.getItem).toHaveBeenCalledWith(BROWSER_LAYOUT_STORAGE_KEY);
    expect(storage.setItem).toHaveBeenCalledWith(BROWSER_LAYOUT_STORAGE_KEY, "next-layout");
  });

  it("falls back to an ephemeral session when browser storage is unavailable", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    };
    const persistence = createBrowserLayoutPersistence(storage);

    expect(persistence.load("workspace-a")).toBeNull();
    expect(() => persistence.save("workspace-a", "layout")).not.toThrow();
  });

  it("also survives a browser that throws while exposing localStorage", () => {
    const exposeStorage = vi.fn(() => {
      throw new Error("SecurityError");
    });
    const persistence = createBrowserLayoutPersistence(undefined, exposeStorage);

    expect(persistence.load("workspace-a")).toBeNull();
    expect(() => persistence.save("workspace-a", "layout")).not.toThrow();
    expect(exposeStorage).toHaveBeenCalledOnce();
  });
});
