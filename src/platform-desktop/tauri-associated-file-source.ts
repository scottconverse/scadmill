import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  AssociatedFileOpenRequest,
  AssociatedFileOpenSource,
} from "../application/platform/scadmill-platform";

export const ASSOCIATED_FILE_WAKE_EVENT = "scadmill://associated-files-ready";

export type ListenForAssociatedFileWake = (
  event: typeof ASSOCIATED_FILE_WAKE_EVENT,
  listener: () => void,
) => Promise<() => void>;

export type TakePendingAssociatedFiles = () => Promise<readonly AssociatedFileOpenRequest[]>;

const listenForWake: ListenForAssociatedFileWake = (event, listener) =>
  listen(event, listener);
export function parseAssociatedFileRequests(value: unknown): readonly AssociatedFileOpenRequest[] {
  if (!Array.isArray(value)) throw new Error("The desktop file-open queue returned an invalid list.");
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("The desktop file-open queue returned an invalid request.");
    }
    const { projectId, displayName, entryFile } = candidate as Record<string, unknown>;
    if (
      typeof projectId !== "string" || !projectId.trim()
      || typeof displayName !== "string" || !displayName.trim()
      || typeof entryFile !== "string" || !/^[^\\/]+\.scad$/iu.test(entryFile)
    ) throw new Error("The desktop file-open queue returned an invalid request.");
    return { projectId, displayName, entryFile };
  });
}

const takePending: TakePendingAssociatedFiles = async () =>
  parseAssociatedFileRequests(await invoke<unknown>("take_pending_associated_files"));

export async function createTauriAssociatedFileSource(
  listenForEvent: ListenForAssociatedFileWake = listenForWake,
  takePendingRequests: TakePendingAssociatedFiles = takePending,
): Promise<AssociatedFileOpenSource> {
  const subscribers = new Set<(request: AssociatedFileOpenRequest) => void>();
  const errorSubscribers = new Set<(message: string) => void>();
  const waiting: AssociatedFileOpenRequest[] = [];
  const waitingErrors: string[] = [];
  let drainChain = Promise.resolve();
  const report = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : "Desktop file-open failed.";
    if (errorSubscribers.size === 0) waitingErrors.push(message);
    else for (const subscriber of errorSubscribers) subscriber(message);
  };
  const drain = () => {
    drainChain = drainChain
      .then(async () => {
        for (const request of await takePendingRequests()) {
          if (subscribers.size === 0) waiting.push(request);
          else for (const subscriber of subscribers) subscriber(request);
        }
      })
      .catch(report);
  };
  await listenForEvent(ASSOCIATED_FILE_WAKE_EVENT, drain);
  drain();
  return Object.freeze({
    subscribe(listener: (request: AssociatedFileOpenRequest) => void) {
      subscribers.add(listener);
      if (subscribers.size === 1) {
        for (const request of waiting.splice(0)) listener(request);
      }
      drain();
      return () => subscribers.delete(listener);
    },
    subscribeErrors(listener: (message: string) => void) {
      errorSubscribers.add(listener);
      if (errorSubscribers.size === 1) {
        for (const message of waitingErrors.splice(0)) listener(message);
      }
      return () => errorSubscribers.delete(listener);
    },
  });
}
