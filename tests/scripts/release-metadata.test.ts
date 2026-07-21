import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const BETA_VERSION = "0.1.0-beta.1";
const INSTALLER = `ScadMill_${BETA_VERSION}_x64-setup.exe`;
const INSTALLER_SHA256 = "D196878A49804F852C49A81ACBB4AC5C232A88DA737F2D756F9B6376E435A588";

function text(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function packageVersion(manifest: string): string | undefined {
  return /^\[package\]\r?\nname = "[^"]+"\r?\nversion = "([^"]+)"/mu.exec(manifest)?.[1];
}

function lockedPackageVersion(lockfile: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^name = "${escaped}"\\r?\\nversion = "([^"]+)"`, "mu")
    .exec(lockfile)?.[1];
}

describe("public beta release metadata", () => {
  it("uses one exact 0.1.0-beta.1 version across web and native artifacts", () => {
    expect(JSON.parse(text("package.json")).version).toBe(BETA_VERSION);
    expect(JSON.parse(text("src/desktop-shell/src-tauri/tauri.conf.json")).version)
      .toBe(BETA_VERSION);
    expect(packageVersion(text("src/desktop-shell/src-tauri/Cargo.toml"))).toBe(BETA_VERSION);
    expect(packageVersion(text("src/native-engine/Cargo.toml"))).toBe(BETA_VERSION);
    expect(lockedPackageVersion(
      text("src/desktop-shell/src-tauri/Cargo.lock"),
      "scadmill-desktop",
    )).toBe(BETA_VERSION);
    expect(lockedPackageVersion(
      text("src/desktop-shell/src-tauri/Cargo.lock"),
      "scadmill-native-engine",
    )).toBe(BETA_VERSION);
    expect(lockedPackageVersion(
      text("src/native-engine/Cargo.lock"),
      "scadmill-native-engine",
    )).toBe(BETA_VERSION);

    expect(text("PUBLIC_VERSION").trim()).toBe(BETA_VERSION);

    const websiteManifest = JSON.parse(text("website/package.json"));
    const publicRelease = JSON.parse(text("website/public/release.json"));
    expect(websiteManifest.name).toBe("scadmill-website");
    expect(websiteManifest.version).toBe(BETA_VERSION);
    expect(publicRelease.version).toBe(BETA_VERSION);
    expect(publicRelease.filename).toBe(INSTALLER);
    expect(publicRelease.sha256).toBe(INSTALLER_SHA256);
  });

  it("prints the current version on every public product surface", () => {
    const publicSurfaces = [
      "README.md",
      "ARCHITECTURE.md",
      "CHANGELOG.md",
      "PRIVACY.md",
      "SECURITY.md",
      "docs/FAQ.md",
      "docs/USER-GUIDE.md",
      "docs/WINDOWS-BETA.md",
      `docs/RELEASE-NOTES-${BETA_VERSION}.md`,
      "docs/RELEASE-ROLLBACK.md",
      "index.html",
      "website/README.md",
      "website/app/page.tsx",
      "website/app/manual/page.tsx",
      "website/app/architecture/page.tsx",
      "website/app/shared.tsx",
    ];

    for (const surface of publicSurfaces) {
      const contents = text(surface);
      if (surface.startsWith("website/app/")) {
        expect(contents, surface).toMatch(/RELEASE\.version|<ReleaseBar \/>/u);
      } else {
        expect(contents, surface).toContain(BETA_VERSION);
      }
    }

    for (const surface of ["README.md", "docs/WINDOWS-BETA.md", `docs/RELEASE-NOTES-${BETA_VERSION}.md`]) {
      expect(text(surface), surface).toContain(INSTALLER);
      expect(text(surface), surface).toContain(INSTALLER_SHA256);
    }
  });
});
