import type { ProjectSnapshot } from "../files/project-snapshot";
import { parseProjectPath } from "../files/project-path";

export const PROJECT_MANIFEST_PATH = parseProjectPath("scadmill.project.json");
const ENGINE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;

export type ProjectEnginePinInspection =
  | { readonly kind: "none" }
  | { readonly kind: "pinned"; readonly version: string }
  | { readonly kind: "invalid" };

export function inspectProjectEnginePin(snapshot: ProjectSnapshot): ProjectEnginePinInspection {
  try {
    const version = projectEnginePin(snapshot);
    return version ? { kind: "pinned", version } : { kind: "none" };
  } catch {
    return { kind: "invalid" };
  }
}

export function projectEnginePin(snapshot: ProjectSnapshot): string | undefined {
  const source = snapshot.files.get(PROJECT_MANIFEST_PATH);
  if (source === undefined) return undefined;
  if (typeof source !== "string" || new TextEncoder().encode(source).byteLength > 16_384) {
    throw new Error("The ScadMill project manifest is invalid.");
  }
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("The ScadMill project manifest is invalid."); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The ScadMill project manifest is invalid.");
  }
  const manifest = value as Record<string, unknown>;
  if (Object.keys(manifest).length !== 2
    || manifest.schemaVersion !== 1
    || typeof manifest.engineVersion !== "string"
    || !ENGINE_VERSION.test(manifest.engineVersion)) {
    throw new Error("The ScadMill project manifest is invalid.");
  }
  return manifest.engineVersion;
}

export function serializeProjectEnginePin(engineVersion: string): string {
  const normalized = engineVersion.trim();
  if (!ENGINE_VERSION.test(normalized)) throw new Error("The engine version pin is invalid.");
  return `${JSON.stringify({ schemaVersion: 1, engineVersion: normalized }, null, 2)}\n`;
}
