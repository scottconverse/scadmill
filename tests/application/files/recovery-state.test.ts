import { describe, expect, it } from "vitest";

import {
  RecoveryCoordinator,
  type RecoveryPersistence,
} from "../../../src/application/files/recovery-state";
import { createDocumentWorkspace, reduceDocumentWorkspace } from "../../../src/application/documents/document-workspace";

function memoryPersistence(initial: string | null = null) {
  let value = initial;
  const persistence: RecoveryPersistence = {
    load: () => value,
    save: (serialized) => { value = serialized; },
    clear: () => { value = null; },
  };
  return { persistence, value: () => value };
}

describe("crash recovery", () => {
  it("captures only unsaved buffers and restores byte-identical Unicode text", () => {
    const memory = memoryPersistence();
    const coordinator = new RecoveryCoordinator(memory.persistence, () => "2026-07-10T12:00:00.000Z");
    const initial = createDocumentWorkspace([
      { id: "main", path: "main.scad", source: "cube(10);" },
      { id: "notes", path: "notes.txt", source: "saved" },
    ]);
    const edited = reduceDocumentWorkspace(initial, {
      kind: "edit",
      documentId: "main",
      source: "// recovered λ 🚀\ncube(11);\n",
    });

    coordinator.capture("project-a", edited);
    const restarted = new RecoveryCoordinator(memory.persistence).load();

    expect(restarted).toEqual({
      version: 1,
      projectId: "project-a",
      capturedAt: "2026-07-10T12:00:00.000Z",
      buffers: [{
        documentId: "main",
        path: "main.scad",
        source: "// recovered λ 🚀\ncube(11);\n",
        savedSource: "cube(10);",
      }],
    });
  });

  it("clears recovery on a clean session and rejects malformed persisted data", () => {
    const memory = memoryPersistence("{\"version\":2}");
    const coordinator = new RecoveryCoordinator(memory.persistence);

    expect(coordinator.load()).toBeNull();
    coordinator.capture("scratch", createDocumentWorkspace());
    expect(memory.value()).toBeNull();
  });

  it("rejects recovery snapshots beyond the bounded durable payload", () => {
    const memory = memoryPersistence();
    const coordinator = new RecoveryCoordinator(memory.persistence);
    const initial = createDocumentWorkspace([{
      id: "main",
      path: "main.scad",
      source: "",
    }]);
    const edited = reduceDocumentWorkspace(initial, {
      kind: "edit",
      documentId: "main",
      source: "x".repeat(4 * 1024 * 1024 + 1),
    });

    expect(() => coordinator.capture("scratch", edited)).toThrow(
      "Unsaved work exceeds the 4 MiB recovery limit.",
    );
    expect(memory.value()).toBeNull();
  });

  it("returns the exact pending-plus-current snapshot that it saves", () => {
    const pending = {
      version: 1 as const,
      projectId: "scratch",
      capturedAt: "2026-07-10T12:00:00.000Z",
      buffers: [{
        documentId: "main",
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    };
    const memory = memoryPersistence();
    const coordinator = new RecoveryCoordinator(
      memory.persistence,
      () => "2026-07-10T12:01:00.000Z",
    );
    const current = reduceDocumentWorkspace(createDocumentWorkspace(), {
      kind: "edit",
      documentId: "document-main",
      source: "sphere(99);",
    });

    const combined = coordinator.captureAlongside(pending, current);

    expect(combined).toEqual(JSON.parse(memory.value() ?? "null"));
    expect(combined.buffers.map(({ source }) => source)).toEqual([
      "cube(77);",
      "sphere(99);",
    ]);
  });
});
