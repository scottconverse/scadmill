import { describe, expect, it, vi } from "vitest";

import {
  ASSOCIATED_FILE_WAKE_EVENT,
  createTauriAssociatedFileSource,
  parseAssociatedFileRequests,
  type ListenForAssociatedFileWake,
} from "../../src/platform-desktop/tauri-associated-file-source";

describe("Tauri associated-file source", () => {
  it("rejects malformed shell payloads before they reach application code", () => {
    expect(() => parseAssociatedFileRequests([{ projectId: "C:\\models" }])).toThrow(
      "invalid request",
    );
    expect(() => parseAssociatedFileRequests([{
      projectId: "C:\\models",
      displayName: "models",
      entryFile: "..\\escape.scad",
    }])).toThrow("invalid request");
  });

  it("retains startup requests until subscription and drains later wakes in FIFO order", async () => {
    let wake: (() => void) | undefined;
    const listen: ListenForAssociatedFileWake = vi.fn(async (event, listener) => {
      expect(event).toBe(ASSOCIATED_FILE_WAKE_EVENT);
      wake = listener;
      return () => undefined;
    });
    const batches = [
      [{ projectId: "C:\\models", displayName: "models", entryFile: "first.scad" }],
      [
        { projectId: "C:\\parts", displayName: "parts", entryFile: "second.scad" },
        { projectId: "C:\\parts", displayName: "parts", entryFile: "third.scad" },
      ],
      [],
    ];
    const takePending = vi.fn(async () => batches.shift() ?? []);

    const source = await createTauriAssociatedFileSource(listen, takePending);
    await Promise.resolve();
    const received: string[] = [];
    source.subscribe((request) => received.push(request.entryFile));
    await Promise.resolve();
    await Promise.resolve();
    wake?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toEqual(["first.scad", "second.scad", "third.scad"]);
    expect(takePending.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
