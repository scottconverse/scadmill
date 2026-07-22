import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRACKED_BLOB_LIMIT,
  evaluateTrackedBlobEntries,
} from "../../scripts/lib/tracked-blob-policy.mjs";

describe("tracked blob policy", () => {
  it("accepts ordinary tracked files and the bounded known large assets", () => {
    expect(evaluateTrackedBlobEntries([
      { path: "src/main.tsx", size: 10_000, lfsPointer: false },
      { path: "src/vendor/kiri-moto/4.7.1/run/engine.js", size: 4_000_000, lfsPointer: false },
      { path: "website/public/og.png", size: 2_200_000, lfsPointer: false },
    ])).toEqual([]);
  });

  it("rejects a new oversized tracked file", () => {
    expect(evaluateTrackedBlobEntries([
      { path: "build/accidental-installer.exe", size: DEFAULT_TRACKED_BLOB_LIMIT + 1, lfsPointer: false },
    ])).toEqual([
      expect.objectContaining({ path: "build/accidental-installer.exe", rule: "tracked-blob-size" }),
    ]);
  });

  it("rejects a known large asset that exceeds its explicit cap", () => {
    expect(evaluateTrackedBlobEntries([
      { path: "src/vendor/kiri-moto/4.7.1/run/engine.js", size: 4_500_001, lfsPointer: false },
    ])).toEqual([
      expect.objectContaining({
        path: "src/vendor/kiri-moto/4.7.1/run/engine.js",
        rule: "tracked-blob-size",
      }),
    ]);
  });

  it("rejects Git LFS pointer files regardless of pointer size", () => {
    expect(evaluateTrackedBlobEntries([
      { path: "assets/model.bin", size: 130, lfsPointer: true },
    ])).toEqual([
      expect.objectContaining({ path: "assets/model.bin", rule: "git-lfs-pointer" }),
    ]);
  });
});
