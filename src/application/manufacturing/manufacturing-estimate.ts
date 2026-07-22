export const KIRI_MOTO_VERSION = "4.7.1";

export interface ManufacturingEstimateProfile {
  readonly id: string;
  readonly name: string;
  readonly device: Readonly<Record<string, unknown>>;
  readonly process: Readonly<Record<string, unknown>>;
}

export interface ManufacturingEstimate {
  readonly engineName: "Kiri:Moto";
  readonly engineVersion: typeof KIRI_MOTO_VERSION;
  readonly profileId: string;
  readonly profileName: string;
  readonly timeSeconds: number;
  readonly filamentMillimeters: number;
}

function profile(
  id: string,
  name: string,
  buildVolume: readonly [number, number, number],
  nozzleDiameter: number,
  layerHeight: number,
): ManufacturingEstimateProfile {
  return Object.freeze({
    id,
    name,
    device: Object.freeze({
      bedWidth: buildVolume[0],
      bedDepth: buildVolume[1],
      maxHeight: buildVolume[2],
      extruders: Object.freeze([Object.freeze({
        extFilament: 1.75,
        extNozzle: nozzleDiameter,
        extOffsetX: 0,
        extOffsetY: 0,
      })]),
    }),
    process: Object.freeze({
      processName: name,
      firstSliceHeight: layerHeight,
      sliceHeight: layerHeight,
      sliceFillSparse: 0.2,
      sliceFillType: "grid",
      sliceShells: nozzleDiameter <= 0.4 ? 3 : 2,
      sliceTopLayers: 3,
      sliceBottomLayers: 3,
      outputFeedrate: nozzleDiameter <= 0.4 ? 50 : 45,
      outputSeekrate: 80,
    }),
  });
}

export const MANUFACTURING_ESTIMATE_PROFILES = Object.freeze([
  profile(
    "generic-cartesian-220-pla-04",
    "Generic Cartesian 220 × 220 × 250 mm / 0.4 mm nozzle",
    [220, 220, 250],
    0.4,
    0.2,
  ),
  profile(
    "generic-cartesian-300-pla-04",
    "Generic Cartesian 300 × 300 × 300 mm / 0.4 mm nozzle",
    [300, 300, 300],
    0.4,
    0.2,
  ),
  profile(
    "generic-cartesian-300-pla-06",
    "Generic Cartesian 300 × 300 × 300 mm / 0.6 mm nozzle",
    [300, 300, 300],
    0.6,
    0.3,
  ),
]) satisfies readonly ManufacturingEstimateProfile[];

export function manufacturingEstimateProfile(id: string): ManufacturingEstimateProfile {
  const selected = MANUFACTURING_ESTIMATE_PROFILES.find((candidate) => candidate.id === id);
  if (!selected) throw new Error(`Unknown manufacturing estimate profile: ${id}`);
  return selected;
}

function nonnegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative and finite.`);
  return value;
}

export function formatEstimateTime(seconds: number): string {
  const rounded = Math.round(nonnegativeFinite(seconds, "Estimate time"));
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours > 0) return `${hours} hr${minutes > 0 ? ` ${minutes} min` : ""}`;
  if (minutes > 0) return `${minutes} min${remainingSeconds > 0 ? ` ${remainingSeconds} sec` : ""}`;
  return `${remainingSeconds} sec`;
}

export function formatEstimateFilament(millimeters: number): string {
  const value = nonnegativeFinite(millimeters, "Estimate filament");
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)} m` : `${Math.round(value)} mm`;
}
