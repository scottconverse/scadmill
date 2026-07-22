import { describe, expect, it, vi } from "vitest";

import {
  formatEstimateFilament,
  formatEstimateTime,
  KIRI_MOTO_VERSION,
  MANUFACTURING_ESTIMATE_PROFILES,
  manufacturingEstimateProfile,
} from "../../../src/application/manufacturing/manufacturing-estimate";
import type { KiriMotoEngine } from "../../../src/application/manufacturing/kiri-moto-estimator";
import { estimateWithKiriMoto } from "../../../src/application/manufacturing/kiri-moto-estimator";

function fakeEngine(done: unknown) {
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
      listener({ export: { done } });
      return "; generated output is deliberately discarded";
    }),
  };
  return engine;
}

describe("manufacturing estimate profiles", () => {
  it("offers distinct generic machine profiles and rejects an unknown selection", () => {
    expect(MANUFACTURING_ESTIMATE_PROFILES.length).toBeGreaterThanOrEqual(2);
    expect(new Set(MANUFACTURING_ESTIMATE_PROFILES.map(({ id }) => id)).size)
      .toBe(MANUFACTURING_ESTIMATE_PROFILES.length);
    expect(MANUFACTURING_ESTIMATE_PROFILES.every(({ name }) => name.startsWith("Generic ")))
      .toBe(true);
    expect(manufacturingEstimateProfile(MANUFACTURING_ESTIMATE_PROFILES[0].id))
      .toBe(MANUFACTURING_ESTIMATE_PROFILES[0]);
    expect(() => manufacturingEstimateProfile("not-a-profile")).toThrow(/unknown/i);
  });

  it("formats estimate figures without manufacturing precision theater", () => {
    expect(formatEstimateTime(1765.5459577924212)).toBe("29 min 26 sec");
    expect(formatEstimateTime(3_661)).toBe("1 hr 1 min");
    expect(formatEstimateFilament(1560.5689130488631)).toBe("1.56 m");
    expect(formatEstimateFilament(843.2)).toBe("843 mm");
  });
});

describe("estimateWithKiriMoto", () => {
  it("runs the pinned offline FDM stages and accepts only Kiri:Moto result metadata", async () => {
    const profile = MANUFACTURING_ESTIMATE_PROFILES[0];
    const engine = fakeEngine({ time: 1765.5459577924212, distance: 1560.5689130488631 });
    const stl = Uint8Array.of(1, 2, 3);

    await expect(estimateWithKiriMoto(stl, profile, () => engine)).resolves.toEqual({
      engineName: "Kiri:Moto",
      engineVersion: KIRI_MOTO_VERSION,
      profileId: profile.id,
      profileName: profile.name,
      timeSeconds: 1765.5459577924212,
      filamentMillimeters: 1560.5689130488631,
    });
    expect(engine.setMode).toHaveBeenCalledWith("FDM");
    expect(engine.setDevice).toHaveBeenCalledWith(profile.device);
    expect(engine.setProcess).toHaveBeenCalledWith(profile.process);
    expect(engine.setController).toHaveBeenCalledWith({ threaded: false });
    expect(engine.parse).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(engine.slice).toHaveBeenCalledOnce();
    expect(engine.prepare).toHaveBeenCalledOnce();
    expect(engine.export).toHaveBeenCalledOnce();
    expect(stl).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("rejects missing, non-finite, or negative engine claims", async () => {
    const profile = MANUFACTURING_ESTIMATE_PROFILES[0];
    for (const done of [undefined, { time: Number.NaN, distance: 1 }, { time: 1, distance: -1 }]) {
      await expect(estimateWithKiriMoto(Uint8Array.of(1), profile, () => fakeEngine(done)))
        .rejects.toThrow(/invalid estimate/i);
    }
  });
});
