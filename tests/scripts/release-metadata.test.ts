import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const BETA_VERSION = "0.1.0-beta.1";

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
  });
});
