import {
  sanitizeSuggestedArtifactName,
  type ArtifactDestination,
} from "../application/files/artifact-destination";

export interface BrowserDownloadEnvironment {
  createUrl(blob: Blob): string;
  triggerDownload(url: string, fileName: string): void;
  revokeUrl(url: string): void;
}

function browserEnvironment(): BrowserDownloadEnvironment {
  return {
    createUrl: (blob) => URL.createObjectURL(blob),
    triggerDownload: (url, fileName) => {
      const anchor = document.createElement("a");
      anchor.download = fileName;
      anchor.href = url;
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    },
    revokeUrl: (url) => URL.revokeObjectURL(url),
  };
}

export function createBrowserArtifactDestination(
  environment: BrowserDownloadEnvironment = browserEnvironment(),
): ArtifactDestination {
  return {
    available: true,
    kind: "browser-downloads",
    save: async ({ suggestedName, bytes, mimeType }) => {
      const fileName = sanitizeSuggestedArtifactName(suggestedName);
      const copiedBytes = Uint8Array.from(bytes);
      const url = environment.createUrl(new Blob([copiedBytes.buffer], { type: mimeType }));
      try {
        environment.triggerDownload(url, fileName);
      } finally {
        environment.revokeUrl(url);
      }
      return { location: fileName };
    },
  };
}
