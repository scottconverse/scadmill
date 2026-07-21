import { invoke } from "@tauri-apps/api/core";

import {
  sanitizeSuggestedArtifactName,
  type ArtifactDestination,
} from "../application/files/artifact-destination";
import type { Invoke } from "./tauri-bridge";

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

export function createTauriArtifactDestination(invokeCommand: Invoke = invoke): ArtifactDestination {
  return {
    available: true,
    kind: "desktop-downloads",
    save: async ({ suggestedName, bytes }) => {
      const location = await invokeCommand<string>("save_artifact", {
        suggestedName: sanitizeSuggestedArtifactName(suggestedName),
        contentsBase64: encodeBase64(bytes),
      });
      if (typeof location !== "string" || location.length === 0) {
        throw new Error("Native artifact saving returned no destination.");
      }
      return { location };
    },
  };
}
