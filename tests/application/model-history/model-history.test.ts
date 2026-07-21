import { describe, expect, it } from "vitest";

import { parseProjectPath } from "../../../src/application/files/project-path";
import {
  MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE,
  ModelHistoryTimeline,
  type ModelHistorySnapshotInput,
} from "../../../src/application/model-history/model-history";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function snapshot(index: number): ModelHistorySnapshotInput {
  return {
    snapshotId: `render-${index}`,
    workspaceIdentity: "project-a",
    documentId: "document-main",
    documentPath: parseProjectPath("main.scad"),
    renderIdentity: `sha256:${"a".repeat(64)}`,
    capturedAt: `2026-07-21T12:00:0${index}.000Z`,
    quality: index % 2 === 0 ? "full" : "preview",
    source: `width = ${index}; cube(width);`,
    parameters: { width: index, enabled: true, vector: [index, index + 1] },
  };
}

describe("FR-15.3 model history timeline", () => {
  it("retains one distinct source and parameter snapshot for every accepted render", () => {
    const timeline = new ModelHistoryTimeline();

    for (let index = 1; index <= 5; index += 1) timeline.capture(snapshot(index));

    const entries = timeline.listDocument("project-a", "document-main");
    expect(entries).toHaveLength(5);
    expect(entries.map(({ snapshotId }) => snapshotId)).toEqual([
      "render-1", "render-2", "render-3", "render-4", "render-5",
    ]);
    expect(entries[1]).toMatchObject({
      source: "width = 2; cube(width);",
      parameters: { width: 2, enabled: true, vector: [2, 3] },
      quality: "full",
    });
  });

  it("attaches a clone-safe thumbnail to the unique render snapshot", () => {
    const timeline = new ModelHistoryTimeline();
    timeline.capture(snapshot(1));
    timeline.capture(snapshot(2));

    expect(timeline.attachThumbnail("project-a", "render-2", PNG)).toBe(true);
    PNG[7] = 99;

    const entries = timeline.listDocument("project-a", "document-main");
    expect(entries[0]?.thumbnailPng).toBeUndefined();
    expect(entries[1]?.thumbnailPng).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    entries[1]?.thumbnailPng?.fill(0);
    expect(timeline.listDocument("project-a", "document-main")[1]?.thumbnailPng?.[0]).toBe(137);
  });

  it("bounds each workspace session while retaining the newest snapshots", () => {
    const timeline = new ModelHistoryTimeline();
    for (let index = 0; index < MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE + 2; index += 1) {
      timeline.capture({
        ...snapshot(index),
        capturedAt: new Date(Date.UTC(2026, 6, 21, 12, 0, index)).toISOString(),
      });
    }

    const entries = timeline.listWorkspace("project-a");
    expect(entries).toHaveLength(MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE);
    expect(entries[0]?.snapshotId).toBe("render-2");
  });
});
