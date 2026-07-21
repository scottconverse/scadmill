import { describe, expect, it, vi } from "vitest";

import type { EngineService, ExportResult } from "../../../src/application/engine/contracts";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import {
  startSlicerHandoff,
  type SlicerHandoffPort,
} from "../../../src/application/manufacturing/slicer-handoff";

function engine(result: ExportResult = { ok: true, bytes: Uint8Array.of(80, 75, 3, 4), diagnostics: [], rawLog: "" }) {
  const service: EngineService = {
    render: vi.fn(),
    export: vi.fn(() => ({
      jobId: "slicer-export",
      subscribeOutput: () => () => undefined,
      done: Promise.resolve(result),
    })),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  return service;
}

const snapshot = createProjectSnapshot("project", new Map([
  ["main.scad", "cube(10);"],
]));

describe("startSlicerHandoff", () => {
  it("exports a full-quality 3MF and opens it with the selected native slicer", async () => {
    const service = engine();
    const open = vi.fn(async () => ({
      slicerName: "PrusaSlicer",
      temporaryFile: "C:/Temp/ScadMill/main.3mf",
    }));
    const handoff: SlicerHandoffPort = { open };

    const operation = startSlicerHandoff({
      engine: service,
      handoff,
      snapshot,
      entryFile: "main.scad",
      parameters: { width: 10 },
      timeoutMs: 60_000,
      configuredExecutablePath: "C:/Tools/prusa-slicer.exe",
    });

    await expect(operation.done).resolves.toEqual({
      slicerName: "PrusaSlicer",
      temporaryFile: "C:/Temp/ScadMill/main.3mf",
    });
    expect(service.export).toHaveBeenCalledWith(expect.objectContaining({
      entryFile: "main.scad",
      files: snapshot.files,
      format: "3mf",
      parameters: { width: 10 },
      timeoutMs: 60_000,
    }));
    expect(open).toHaveBeenCalledWith({
      bytes: Uint8Array.of(80, 75, 3, 4),
      suggestedName: "main.3mf",
      configuredExecutablePath: "C:/Tools/prusa-slicer.exe",
    });
  });

  it("does not launch a slicer when 3MF export fails and forwards cancellation", async () => {
    const service = engine({ ok: false, diagnostics: [], rawLog: "export failed" });
    const handoff: SlicerHandoffPort = { open: vi.fn() };
    const operation = startSlicerHandoff({
      engine: service,
      handoff,
      snapshot,
      entryFile: "main.scad",
      parameters: {},
      timeoutMs: 60_000,
    });

    operation.cancel();
    await expect(operation.done).rejects.toThrow(/3MF export failed/i);
    expect(service.cancel).toHaveBeenCalledWith("slicer-export");
    expect(handoff.open).not.toHaveBeenCalled();
  });
});
