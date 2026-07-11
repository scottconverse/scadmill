/// <reference lib="webworker" />

import { unzipSync, zipSync } from "fflate";

type ProjectZipWorkerRequest =
  | { readonly kind: "encode"; readonly entries: Record<string, Uint8Array> }
  | {
      readonly kind: "decode";
      readonly archive: Uint8Array;
      readonly decompressedLimit: number;
      readonly expandedTooLargeMessage: string;
    };

type ProjectZipWorkerResponse =
  | { readonly kind: "encoded"; readonly bytes: Uint8Array }
  | { readonly kind: "decoded"; readonly entries: Record<string, Uint8Array> }
  | { readonly kind: "error"; readonly name: string; readonly message: string };

const scope = self as DedicatedWorkerGlobalScope;
const DETERMINISTIC_ARCHIVE_TIME = new Date(1980, 0, 1);

function transferableBuffers(entries: Record<string, Uint8Array>): ArrayBuffer[] {
  const unique = new Set<ArrayBuffer>();
  for (const bytes of Object.values(entries)) {
    if (bytes.buffer instanceof ArrayBuffer) unique.add(bytes.buffer);
  }
  return [...unique];
}

scope.onmessage = ({ data }: MessageEvent<ProjectZipWorkerRequest>) => {
  try {
    if (data.kind === "encode") {
      const bytes = zipSync(data.entries, {
        level: 6,
        mtime: DETERMINISTIC_ARCHIVE_TIME,
      });
      const response: ProjectZipWorkerResponse = { kind: "encoded", bytes };
      scope.postMessage(response, [bytes.buffer]);
      return;
    }

    let total = 0;
    const entries = unzipSync(data.archive, {
      filter: ({ originalSize }) => {
        total += originalSize;
        if (total > data.decompressedLimit) throw new Error(data.expandedTooLargeMessage);
        return true;
      },
    });
    const response: ProjectZipWorkerResponse = { kind: "decoded", entries };
    scope.postMessage(response, transferableBuffers(entries));
  } catch (reason) {
    const response: ProjectZipWorkerResponse = {
      kind: "error",
      name: reason instanceof Error ? reason.name : "Error",
      message: reason instanceof Error ? reason.message : "Project ZIP worker failed.",
    };
    scope.postMessage(response);
  }
};
