import type {
  ManufacturingEstimate,
  ManufacturingEstimateProfile,
} from "./manufacturing-estimate";
import { KIRI_MOTO_VERSION } from "./manufacturing-estimate";

export interface KiriMotoEngine {
  setListener(listener: (event: unknown) => void): KiriMotoEngine;
  setMode(mode: "FDM"): KiriMotoEngine;
  setDevice(device: Readonly<Record<string, unknown>>): KiriMotoEngine;
  setProcess(process: Readonly<Record<string, unknown>>): KiriMotoEngine;
  setController(controller: Readonly<Record<string, unknown>>): KiriMotoEngine;
  parse(data: ArrayBuffer): Promise<KiriMotoEngine>;
  slice(): Promise<KiriMotoEngine>;
  prepare(): Promise<KiriMotoEngine>;
  export(): Promise<string>;
}

export type KiriMotoEngineFactory = () => KiriMotoEngine;

export async function estimateWithKiriMoto(
  stl: Uint8Array,
  profile: ManufacturingEstimateProfile,
  createEngine: KiriMotoEngineFactory,
): Promise<ManufacturingEstimate> {
  let timeSeconds: number | undefined;
  let filamentMillimeters: number | undefined;
  const engine = createEngine();
  engine.setListener((event) => {
    if (typeof event !== "object" || event === null) return;
    const exported = (event as Record<string, unknown>).export;
    if (typeof exported !== "object" || exported === null) return;
    const done = (exported as Record<string, unknown>).done;
    if (typeof done !== "object" || done === null) return;
    const record = done as Record<string, unknown>;
    if (typeof record.time === "number") timeSeconds = record.time;
    if (typeof record.distance === "number") filamentMillimeters = record.distance;
  });
  engine
    .setMode("FDM")
    .setDevice(profile.device)
    .setProcess(profile.process)
    .setController({ threaded: false });
  const copy = stl.slice();
  await engine.parse(copy.buffer);
  await engine.slice();
  await engine.prepare();
  await engine.export();
  if (
    timeSeconds === undefined
    || !Number.isFinite(timeSeconds)
    || timeSeconds < 0
    || filamentMillimeters === undefined
    || !Number.isFinite(filamentMillimeters)
    || filamentMillimeters < 0
  ) throw new Error("Kiri:Moto returned an invalid estimate.");
  return {
    engineName: "Kiri:Moto",
    engineVersion: KIRI_MOTO_VERSION,
    profileId: profile.id,
    profileName: profile.name,
    timeSeconds,
    filamentMillimeters,
  };
}
