import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const CANDIDATE_VERSION = "0.1.0-beta.3";
const PUBLIC_VERSION = "0.1.0-beta.2";
const INSTALLER = `ScadMill_${PUBLIC_VERSION}_x64-setup.exe`;
const INSTALLER_SIZE = 211_574_008;
const INSTALLER_SHA256 = "49C107B1648D918B7DAF16B47B4F3BAD0500EDB160D8E734E6C400E7E2578A91";
const PUBLIC_SITE = "https://scadmill-beta.sconverse.chatgpt.site";

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
  it("separates the exact candidate application version from the current public release", () => {
    expect(text("CANDIDATE_VERSION").trim()).toBe(CANDIDATE_VERSION);
    expect(JSON.parse(text("package.json")).version).toBe(CANDIDATE_VERSION);
    expect(JSON.parse(text("src/desktop-shell/src-tauri/tauri.conf.json")).version)
      .toBe(CANDIDATE_VERSION);
    expect(packageVersion(text("src/desktop-shell/src-tauri/Cargo.toml"))).toBe(CANDIDATE_VERSION);
    expect(packageVersion(text("src/native-engine/Cargo.toml"))).toBe(CANDIDATE_VERSION);
    expect(lockedPackageVersion(
      text("src/desktop-shell/src-tauri/Cargo.lock"),
      "scadmill-desktop",
    )).toBe(CANDIDATE_VERSION);
    expect(lockedPackageVersion(
      text("src/desktop-shell/src-tauri/Cargo.lock"),
      "scadmill-native-engine",
    )).toBe(CANDIDATE_VERSION);
    expect(lockedPackageVersion(
      text("src/native-engine/Cargo.lock"),
      "scadmill-native-engine",
    )).toBe(CANDIDATE_VERSION);
    expect(text("index.html")).toContain(CANDIDATE_VERSION);

    expect(text("PUBLIC_VERSION").trim()).toBe(PUBLIC_VERSION);

    const websiteManifest = JSON.parse(text("website/package.json"));
    const publicRelease = JSON.parse(text("website/public/release.json"));
    expect(websiteManifest.name).toBe("scadmill-website");
    expect(websiteManifest.version).toBe(PUBLIC_VERSION);
    expect(publicRelease.version).toBe(PUBLIC_VERSION);
    expect(publicRelease.filename).toBe(INSTALLER);
    expect(publicRelease.sizeBytes).toBe(INSTALLER_SIZE);
    expect(publicRelease.sha256).toBe(INSTALLER_SHA256);
    expect(publicRelease.site).toBe(PUBLIC_SITE);
    expect(publicRelease.releasePage).toBe(
      `https://github.com/scottconverse/scadmill/releases/tag/v${PUBLIC_VERSION}`,
    );
    expect(publicRelease.download).toBe(
      `https://github.com/scottconverse/scadmill/releases/download/v${PUBLIC_VERSION}/${INSTALLER}`,
    );
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
      `docs/RELEASE-NOTES-${PUBLIC_VERSION}.md`,
      "docs/RELEASE-ROLLBACK.md",
      `docs/RELEASE-ROLLBACK-${PUBLIC_VERSION}.md`,
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
        expect(contents, surface).toContain(PUBLIC_VERSION);
      }
    }

    for (const surface of ["README.md", "docs/USER-GUIDE.md", "docs/WINDOWS-BETA.md", `docs/RELEASE-NOTES-${PUBLIC_VERSION}.md`]) {
      expect(text(surface), surface).toContain(INSTALLER);
      expect(text(surface), surface).toContain(INSTALLER_SHA256);
    }

    for (const surface of ["README.md", "ARCHITECTURE.md", "docs/USER-GUIDE.md", `docs/RELEASE-NOTES-${PUBLIC_VERSION}.md`, "website/README.md"]) {
      expect(text(surface), surface).toContain(PUBLIC_SITE);
    }
  });

  it("keeps shipped maturity, evidence boundaries, and M6 geometry honest", () => {
    const currentCapabilitySurfaces = [
      "README.md",
      "ARCHITECTURE.md",
      "docs/FAQ.md",
      "docs/USER-GUIDE.md",
      "docs/WINDOWS-BETA.md",
      `docs/RELEASE-NOTES-${PUBLIC_VERSION}.md`,
      "website/app/page.tsx",
      "website/app/manual/page.tsx",
      "website/app/architecture/page.tsx",
    ];

    for (const surface of currentCapabilitySurfaces) {
      expect(text(surface), surface).not.toMatch(/development (?:branch|builds?)/iu);
    }

    for (const surface of ["README.md", "docs/USER-GUIDE.md", "website/app/architecture/page.tsx"]) {
      const contents = text(surface);
      expect(contents, surface).not.toContain("Windows Sandbox install-to-uninstall");
      expect(contents, surface).toContain("hosted-Windows");
      expect(contents, surface).toContain("source-bound");
    }

    for (const surface of ["README.md", "docs/USER-GUIDE.md", "website/app/manual/page.tsx", "website/app/architecture/page.tsx"]) {
      const contents = text(surface);
      expect(contents, surface).toContain("color-preserving 3MF");
      expect(contents, surface).toContain("SVG");
    }
  });

  it("keeps the normative M6 color format internally consistent", () => {
    const spec = text("spec/scadmill-spec-v0.6.md");
    const questions = text("spec/QUESTIONS.md");
    const releaseNotes = text(`docs/RELEASE-NOTES-${PUBLIC_VERSION}.md`);
    const fr1515 = spec.slice(spec.indexOf("- FR-15.15"), spec.indexOf("- FR-15.16"));
    const ac15k = spec.slice(spec.indexOf("- AC-15.k"), spec.indexOf("- AC-15.l"));

    expect(fr1515).toContain("<m:colorgroup>");
    expect(fr1515).toContain("<m:color");
    expect(fr1515).toMatch(/must\s+not contain a `<basematerials>` group/iu);
    expect(fr1515).not.toContain("displaycolor");
    expect(ac15k).toContain("<m:colorgroup>");
    expect(ac15k).toContain("<m:color");
    expect(ac15k).toMatch(/no `<basematerials>` group exists/iu);
    expect(ac15k).not.toContain("displaycolor");
    expect(spec).toMatch(/\| A-11 \|[^\n]+Q-0042/iu);
    expect(questions).toMatch(/## Q-0042 — Resolved[^\n]*— owner-directed/iu);
    expect(questions).not.toContain("Open/actionable — M6 engine-format contradiction");
    expect(releaseNotes).toContain("## Resolved specification correction");
    expect(releaseNotes).not.toContain("## Known specification question");
  });

  it("documents both explicit verified OpenSCAD setup paths without implying automatic management", () => {
    const windowsBeta = text("docs/WINDOWS-BETA.md");

    expect(windowsBeta).toContain("Download official OpenSCAD 2026.06.12");
    expect(windowsBeta).toContain("never downloads or updates OpenSCAD automatically");
    expect(windowsBeta).toContain("manual verified setup");
    expect(windowsBeta).not.toContain("is not managed or updated by ScadMill");
  });

  it("records the completed Q-0034 parity proof instead of an unresolved rerun", () => {
    const questions = text("spec/QUESTIONS.md");
    const q0034 = questions.slice(
      questions.indexOf("## Q-0034"),
      questions.indexOf("## Q-0001"),
    );

    expect(q0034).toContain("All six required cases passed");
    expect(q0034).toContain("historical M3 candidate `1b6343a`");
    expect(q0034).not.toContain("remains unproven");
    expect(q0034).not.toContain("must now rerun");
  });

  it("keeps the specification-question index visibly current", () => {
    const questions = text("spec/QUESTIONS.md");

    expect(questions).toContain("## Current queue index");
    expect(questions).not.toMatch(/## Queue index — \d{4}-\d{2}-\d{2}/u);
  });

  it("describes the absent updater without promising an undefined later milestone", () => {
    const privacy = text("PRIVACY.md");
    const websiteManual = text("website/app/manual/page.tsx");

    for (const surface of [privacy, websiteManual]) {
      expect(surface).toContain("no automatic updater is included in this beta");
      expect(surface).not.toContain("updater itself arrives in a later milestone");
      expect(surface).not.toContain("updater itself is later work");
    }
  });

  it("uses present-tense uninstall guidance on the published Windows surface", () => {
    const windowsBeta = text("docs/WINDOWS-BETA.md");

    expect(windowsBeta).toContain("To uninstall ScadMill through");
    expect(windowsBeta).not.toContain("After publication, uninstall ScadMill through");
  });
});
