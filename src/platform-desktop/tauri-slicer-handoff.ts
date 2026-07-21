import { invoke } from "@tauri-apps/api/core";

import { sanitizeSuggestedArtifactName } from "../application/files/artifact-destination";
import type {
  SlicerHandoffPort,
  SlicerHandoffResult,
} from "../application/manufacturing/slicer-handoff";
import type { Invoke } from "./tauri-bridge";

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function decodeResult(value: unknown): SlicerHandoffResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Native slicer handoff returned an invalid result.");
  }
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 2
    || typeof candidate.slicerName !== "string" || candidate.slicerName.trim().length === 0
    || typeof candidate.temporaryFile !== "string" || candidate.temporaryFile.trim().length === 0) {
    throw new Error("Native slicer handoff returned an invalid result.");
  }
  return { slicerName: candidate.slicerName, temporaryFile: candidate.temporaryFile };
}

export function createTauriSlicerHandoff(invokeCommand: Invoke = invoke): SlicerHandoffPort {
  return {
    async open({ bytes, suggestedName, configuredExecutablePath }) {
      const result = await invokeCommand<unknown>("open_in_slicer", {
        contentsBase64: encodeBase64(bytes.slice()),
        suggestedName: sanitizeSuggestedArtifactName(suggestedName),
        ...(configuredExecutablePath?.trim()
          ? { configuredExecutablePath: configuredExecutablePath.trim() }
          : {}),
      });
      return decodeResult(result);
    },
  };
}
