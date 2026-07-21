import type { ProjectFileContent } from "./project-snapshot";

interface ExternalChangeBase {
  readonly savedSource: string;
  readonly localSource: string;
}

export interface ModifiedExternalChange extends ExternalChangeBase {
  readonly kind: "modified";
  readonly diskSource: string;
}

export interface DeletedExternalChange extends ExternalChangeBase {
  readonly kind: "deleted";
}

export interface TypeChangedExternalChange extends ExternalChangeBase {
  readonly kind: "type-changed";
}

export type ExternalChange =
  | ModifiedExternalChange
  | DeletedExternalChange
  | TypeChangedExternalChange;

export type ExternalChangeChoice = "reload" | "keep" | "diff";

export function detectExternalChange(
  savedSource: string,
  localSource: string,
  diskSource: ProjectFileContent | undefined,
): ExternalChange | null {
  if (diskSource === undefined) return { kind: "deleted", savedSource, localSource };
  if (diskSource instanceof Uint8Array) {
    return { kind: "type-changed", savedSource, localSource };
  }
  return diskSource === savedSource
    ? null
    : { kind: "modified", savedSource, localSource, diskSource };
}

export function resolveExternalChange(change: ExternalChange, choice: ExternalChangeChoice) {
  if (change.kind !== "modified") {
    if (choice !== "keep") {
      throw new Error("A deleted or binary-replaced source file cannot be reloaded or diffed.");
    }
    return {
      source: change.localSource,
      savedSource: change.savedSource,
      dirty: change.localSource !== change.savedSource,
    } as const;
  }
  if (choice === "diff") return { before: change.localSource, after: change.diskSource } as const;
  if (choice === "reload") {
    return { source: change.diskSource, savedSource: change.diskSource, dirty: false } as const;
  }
  return { source: change.localSource, savedSource: change.diskSource, dirty: true } as const;
}
