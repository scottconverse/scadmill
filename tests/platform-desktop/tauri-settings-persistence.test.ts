import { describe, expect, it, vi } from "vitest";
import {
  createTauriSettingsPersistence,
  type TauriInvoke,
} from "../../src/platform-desktop/tauri-settings-persistence";

describe("desktop settings persistence", () => {
  it("preloads the platform config file before exposing the synchronous settings boundary", async () => {
    const invoke = vi.fn().mockResolvedValue('{"version":1}') as TauriInvoke;
    const persistence = await createTauriSettingsPersistence(invoke);

    expect(invoke).toHaveBeenCalledWith("load_settings");
    expect(persistence.load()).toBe('{"version":1}');
  });

  it("serializes config writes so an older async write cannot overtake a newer one", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const invoke = vi.fn(<T>(command: string, args?: Record<string, unknown>) => {
      if (command === "load_settings") return Promise.resolve(null as T);
      const value = String(args?.serializedSettings);
      if (value === "first") {
        return new Promise<T>((resolve) => {
          releaseFirst = () => { order.push(value); resolve(undefined as T); };
        });
      }
      order.push(value);
      return Promise.resolve(undefined as T);
    }) as TauriInvoke;
    const persistence = await createTauriSettingsPersistence(invoke);

    persistence.save("first");
    persistence.save("second");
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf("function"));
    expect(order).toEqual([]);
    releaseFirst?.();
    await vi.waitFor(() => expect(order).toEqual(["first", "second"]));
    expect(persistence.load()).toBe("second");
  });

  it("reports a failed write, keeps the last durable cache, and lets a later write recover", async () => {
    const invoke = vi.fn(<T>(command: string, args?: Record<string, unknown>) => {
      if (command === "load_settings") return Promise.resolve("durable" as T);
      const value = String(args?.serializedSettings);
      return value === "failed"
        ? Promise.reject(new Error("disk full"))
        : Promise.resolve(undefined as T);
    }) as TauriInvoke;
    const persistence = await createTauriSettingsPersistence(invoke);

    await expect(persistence.save("failed")).rejects.toThrow("disk full");
    expect(persistence.load()).toBe("durable");

    await expect(persistence.save("recovered")).resolves.toBeUndefined();
    expect(persistence.load()).toBe("recovered");
  });
});
