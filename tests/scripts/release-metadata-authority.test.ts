import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

function text(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

describe("public release metadata authority", () => {
  it("keeps release-policy tests derived from release.json instead of pinned literals", () => {
    const publicRelease = JSON.parse(text("website/public/release.json"));
    const candidateVersion = text("CANDIDATE_VERSION").trim();
    const policyTests = [
      "tests/scripts/release-metadata.test.ts",
      "tests/scripts/security-policy.test.ts",
      "website/tests/rendered-html.test.mjs",
    ];

    for (const path of policyTests) {
      const source = text(path);
      expect(source, path).toContain("release.json");
      expect(source, path).not.toContain(publicRelease.version);
      expect(source, path).not.toContain(candidateVersion);
      expect(source, path).not.toContain(publicRelease.sha256);
      expect(source, path).not.toContain(String(publicRelease.sizeBytes));
      expect(source, path).not.toMatch(/\b\d+\.\d+\.\d+-beta\.\d+\b/u);
      expect(source, path).not.toMatch(/\b[A-F0-9]{64}\b/u);
    }

    const releaseMetadataTest = text("tests/scripts/release-metadata.test.ts");
    expect(releaseMetadataTest).not.toMatch(/const INSTALLER_SIZE\s*=/u);
    expect(releaseMetadataTest).not.toMatch(/const INSTALLER_SHA256\s*=/u);
  });
});
