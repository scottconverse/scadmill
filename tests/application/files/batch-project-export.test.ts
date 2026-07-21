import { expect, it, vi } from "vitest";

import type { NamedParameterSet } from "../../../src/application/parameters/parameter-set-codec";
import {
  startBatchProjectExport,
  type BatchExportItemCompletion,
} from "../../../src/application/files/batch-project-export";
import type { ProjectExportOperation } from "../../../src/application/files/project-export";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, reject, resolve };
}

function completion(fileName: string): BatchExportItemCompletion {
  return {
    format: "stl-binary",
    location: `Downloads/${fileName}`,
    fileName,
    fileSizeBytes: 84,
    diagnostics: [],
  };
}

const sets: readonly NamedParameterSet[] = [
  { name: "Small", values: { width: 10 } },
  { name: "Tall / risky", values: { width: 20 } },
  { name: "Large", values: { width: 30 } },
];

it("AC-15.d exports selected parameter sets sequentially with templated names", async () => {
  const runs = sets.map(() => deferred<BatchExportItemCompletion>());
  const startExport = vi.fn((_: NamedParameterSet, fileName: string): ProjectExportOperation => {
    const run = runs[startExport.mock.calls.length - 1];
    if (!run) throw new Error("Unexpected batch item.");
    return { jobId: fileName, done: run.promise, cancel: vi.fn() };
  });
  const operation = startBatchProjectExport({
    entryFile: "parts/widget.scad",
    format: "stl-binary",
    sets,
    fileNameTemplate: "{model}-{set}.{ext}",
    startExport,
  });

  expect(startExport).toHaveBeenCalledTimes(1);
  expect(startExport.mock.calls[0]?.[1]).toBe("widget-Small.stl");
  runs[0]?.resolve(completion("widget-Small.stl"));
  await vi.waitFor(() => expect(startExport).toHaveBeenCalledTimes(2));
  expect(startExport.mock.calls[1]?.[1]).toBe("widget-Tall _ risky.stl");
  runs[1]?.reject(new Error("Engine exited for item two."));
  await vi.waitFor(() => expect(startExport).toHaveBeenCalledTimes(3));
  runs[2]?.resolve(completion("widget-Large.stl"));

  const result = await operation.done;
  expect(result.items.map(({ status }) => status)).toEqual(["success", "failure", "success"]);
  expect(result.items[0]?.completion?.location).toBe("Downloads/widget-Small.stl");
  expect(result.items[1]?.error).toContain("item two");
  expect(result.completed).toBe(3);
});

it("cancels the active item and never starts later items", async () => {
  const first = deferred<BatchExportItemCompletion>();
  const second = deferred<BatchExportItemCompletion>();
  const cancelSecond = vi.fn();
  const startExport = vi.fn()
    .mockReturnValueOnce({ jobId: "one", done: first.promise, cancel: vi.fn() })
    .mockReturnValueOnce({ jobId: "two", done: second.promise, cancel: cancelSecond });
  const operation = startBatchProjectExport({
    entryFile: "widget.scad",
    format: "stl-binary",
    sets,
    fileNameTemplate: "{model}-{set}.{ext}",
    startExport,
  });
  first.resolve(completion("widget-Small.stl"));
  await vi.waitFor(() => expect(startExport).toHaveBeenCalledTimes(2));

  operation.cancel();
  expect(cancelSecond).toHaveBeenCalledOnce();
  second.reject(new Error("cancelled"));

  const result = await operation.done;
  expect(result.cancelled).toBe(true);
  expect(result.items.map(({ status }) => status)).toEqual([
    "success", "cancelled", "cancelled",
  ]);
  expect(startExport).toHaveBeenCalledTimes(2);
});
