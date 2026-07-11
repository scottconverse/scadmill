import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  acceptsPinnedEngineVersion,
  PINNED_OPENSCAD_VERSION,
} from "../../../src/application/engine/engine-pin";

describe("OpenSCAD engine pin", () => {
  it("matches the single version recorded in ENGINE_VERSION", () => {
    const manifest = readFileSync(new URL("../../../ENGINE_VERSION", import.meta.url), "utf8");
    const recorded = /^version:\s*(\S+)\s*$/mu.exec(manifest)?.[1];

    expect(PINNED_OPENSCAD_VERSION).toBe("2026.06.12");
    expect(PINNED_OPENSCAD_VERSION).toBe(recorded);
  });

  it("accepts only the exact pinned snapshot", () => {
    expect(acceptsPinnedEngineVersion("2026.06.12")).toBe(true);
    expect(acceptsPinnedEngineVersion("2021.01")).toBe(false);
    expect(acceptsPinnedEngineVersion("2026.06.13")).toBe(false);
  });
});
