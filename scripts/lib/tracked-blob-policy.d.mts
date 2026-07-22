export interface TrackedBlobEntry {
  readonly path: string;
  readonly size: number;
  readonly lfsPointer: boolean;
}

export interface TrackedBlobViolation {
  readonly path: string;
  readonly rule: "git-lfs-pointer" | "tracked-blob-size";
  readonly message: string;
}

export const DEFAULT_TRACKED_BLOB_LIMIT: number;
export const TRACKED_BLOB_EXCEPTIONS: Readonly<Record<string, number>>;
export function evaluateTrackedBlobEntries(
  entries: readonly TrackedBlobEntry[],
): TrackedBlobViolation[];
