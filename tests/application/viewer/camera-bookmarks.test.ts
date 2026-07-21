import { describe, expect, it } from "vitest";

import {
  parseCameraBookmarks,
  serializeCameraBookmarks,
} from "../../../src/application/viewer/camera-bookmarks";
import { createDefaultViewerCamera } from "../../../src/application/viewer/viewer-state";

describe("camera bookmark persistence", () => {
  it("round-trips bounded named camera poses deterministically", () => {
    const camera = createDefaultViewerCamera();
    const serialized = serializeCameraBookmarks([
      { id: "rear", name: "Rear detail", camera: { ...camera, position: [-20, 4, 8] } },
      { id: "front", name: "Front", camera },
    ]);

    expect(parseCameraBookmarks(serialized).map(({ id }) => id)).toEqual(["front", "rear"]);
  });

  it("rejects duplicate names, unknown fields, invalid cameras, and oversized lists", () => {
    const camera = createDefaultViewerCamera();
    expect(() => serializeCameraBookmarks([
      { id: "a", name: "Front", camera },
      { id: "b", name: "front", camera },
    ])).toThrow(/unique/iu);
    expect(() => parseCameraBookmarks('{"version":1,"bookmarks":[],"extra":true}')).toThrow();
    expect(() => parseCameraBookmarks('{"version":1,"bookmarks":[{"id":"a","name":"A","camera":{"projection":"perspective","position":[0,0,0],"target":[0,0,0],"up":[0,0,1],"zoom":0}}]}')).toThrow(/camera/iu);
    expect(() => serializeCameraBookmarks(Array.from({ length: 65 }, (_, index) => ({
      id: `id-${index}`,
      name: `View ${index}`,
      camera,
    })))).toThrow(/many/iu);
  });
});
