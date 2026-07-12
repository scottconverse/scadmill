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
    expect(persistence.load()).toEqual({
      kind: "loaded",
      serializedSettings: '{"version":1}',
    });
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
    expect(persistence.load()).toEqual({ kind: "loaded", serializedSettings: "second" });
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
    expect(persistence.load()).toEqual({ kind: "loaded", serializedSettings: "durable" });

    await expect(persistence.save("recovered")).resolves.toBeUndefined();
    expect(persistence.load()).toEqual({ kind: "loaded", serializedSettings: "recovered" });
  });

  it("retains a rejected load and never invokes a settings write afterward", async () => {
    let loadAttempts = 0;
    const invoke = vi.fn(<T>(command: string) => {
      if (command !== "load_settings") return Promise.resolve(undefined as T);
      loadAttempts += 1;
      return loadAttempts === 1
        ? Promise.reject(new Error("temporary sharing violation"))
        : Promise.resolve("existing-durable-settings" as T);
    }) as TauriInvoke;
    const persistence = await createTauriSettingsPersistence(invoke);

    expect(persistence.load()).toEqual({ kind: "error" });
    expect(persistence.load()).toEqual({ kind: "error" });
    await expect(persistence.save("replacement-settings")).rejects.toThrow("not loaded safely");
    expect(loadAttempts).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalledWith("save_settings", expect.anything());
  });
});
