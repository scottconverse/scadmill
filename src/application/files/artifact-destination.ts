export interface ArtifactSaveRequest {
  readonly suggestedName: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export interface ArtifactSaveResult {
  readonly location: string;
}

export interface ArtifactDestination {
  readonly available: boolean;
  readonly kind?: "browser-downloads" | "desktop-downloads" | "unavailable" | "custom";
  save(request: ArtifactSaveRequest): Promise<ArtifactSaveResult>;
}

const WINDOWS_RESERVED = /^(?:aux|clock\$|con|conin\$|conout\$|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export function sanitizeSuggestedArtifactName(suggestedName: string): string {
  const leaf = suggestedName.split(/[\\/]/u).at(-1) ?? "";
  const portable = [...leaf]
    .map((character) =>
      character.charCodeAt(0) <= 0x1f || "<>:\"/\\|?*".includes(character) ? "-" : character
    )
    .join("")
    .replace(/[. ]+$/u, "")
    .trim();
  if (!portable) return "artifact.bin";
  return WINDOWS_RESERVED.test(portable) ? `_${portable}` : portable;
}

export const UNAVAILABLE_ARTIFACT_DESTINATION: ArtifactDestination = Object.freeze({
  available: false,
  kind: "unavailable",
  save: async () => {
    throw new Error("Artifact saving is unavailable in this environment.");
  },
});
