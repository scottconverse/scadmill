import { describe, expect, it, vi } from "vitest";

import type { KiriMotoEngine } from "../../../src/application/manufacturing/kiri-moto-estimator";
import { runManufacturingEstimate } from "../../../src/application/manufacturing/manufacturing-estimate-runtime";

function fakeEngine() {
  let listener: (event: unknown) => void = () => undefined;
  const engine: KiriMotoEngine = {
    setListener: vi.fn((next) => { listener = next; return engine; }),
    setMode: vi.fn(() => engine),
    setDevice: vi.fn(() => engine),
    setProcess: vi.fn(() => engine),
    setController: vi.fn(() => engine),
    parse: vi.fn(async () => engine),
    slice: vi.fn(async () => engine),
    prepare: vi.fn(async () => engine),
    export: vi.fn(async () => {
      listener({ export: { done: { time: 3_600, distance: 2_500 } } });
      return "; discarded";
    }),
  };
  return engine;
}

describe("runManufacturingEstimate", () => {
  it("prepares a full-render mesh off-thread before invoking the pinned engine", async () => {
    const source = Uint8Array.of(1, 2, 3);
    const prepared = Uint8Array.of(4, 5, 6);
    const prepareStl = vi.fn(async () => prepared);
    const engine = fakeEngine();
    const createEngine = vi.fn(() => engine);

    await expect(runManufacturingEstimate(
      source,
      "3mf",
      "generic-cartesian-220-pla-04",
      undefined,
      { prepareStl, createEngine },
    )).resolves.toMatchObject({
      engineName: "Kiri:Moto",
      engineVersion: "4.7.1",
      profileId: "generic-cartesian-220-pla-04",
      timeSeconds: 3_600,
      filamentMillimeters: 2_500,
    });
    expect(prepareStl).toHaveBeenCalledWith(source, "3mf", undefined);
    expect(createEngine).toHaveBeenCalledOnce();
    expect(engine.parse).toHaveBeenCalledWith(expect.any(ArrayBuffer));
  });

  it("does not start Kiri:Moto after cancellation during preprocessing", async () => {
    const controller = new AbortController();
    const createEngine = vi.fn(() => fakeEngine());
    const prepareStl = vi.fn(async () => {
      controller.abort();
      return Uint8Array.of(1);
    });

    await expect(runManufacturingEstimate(
      Uint8Array.of(1),
      "stl-binary",
      "generic-cartesian-220-pla-04",
      controller.signal,
      { prepareStl, createEngine },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(createEngine).not.toHaveBeenCalled();
  });
});
