import { describe, expect, it } from "vitest";

import {
  sanitizeSuggestedArtifactName,
} from "../../../src/application/files/artifact-destination";

describe("sanitizeSuggestedArtifactName", () => {
  it("keeps a portable leaf name and removes path and Windows hazards", () => {
    expect(sanitizeSuggestedArtifactName("../renders/cube:final?.png")).toBe("cube-final-.png");
    expect(sanitizeSuggestedArtifactName("CON.png")).toBe("_CON.png");
  });

  it("uses a safe fallback for empty names", () => {
    expect(sanitizeSuggestedArtifactName("...   ")).toBe("artifact.bin");
  });
});
