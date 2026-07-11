export const PINNED_OPENSCAD_VERSION = "2026.06.12";

export function acceptsPinnedEngineVersion(version: string): boolean {
  return version.trim() === PINNED_OPENSCAD_VERSION;
}
