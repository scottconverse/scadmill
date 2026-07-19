import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const expectedLicenseSha256 = "48cd794e75be685e275287a0a24e0ef6820851770aff9dc0bbc31624a0213443";

describe("ScadMill product license", () => {
  it("declares Apache-2.0 consistently across source and package surfaces", async () => {
    const tauriConfigPath = resolve(
      repositoryRoot,
      "src/desktop-shell/src-tauri/tauri.conf.json",
    );
    const [license, packageManifest, nativeManifest, desktopManifest, tauriConfig] =
      await Promise.all([
        readFile(resolve(repositoryRoot, "LICENSE"), "utf8"),
        readFile(resolve(repositoryRoot, "package.json"), "utf8"),
        readFile(resolve(repositoryRoot, "src/native-engine/Cargo.toml"), "utf8"),
        readFile(resolve(repositoryRoot, "src/desktop-shell/src-tauri/Cargo.toml"), "utf8"),
        readFile(tauriConfigPath, "utf8"),
      ]);

    expect(createHash("sha256").update(license).digest("hex")).toBe(expectedLicenseSha256);
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");
    expect(license).toContain("http://www.apache.org/licenses/");
    expect(license).toContain("END OF TERMS AND CONDITIONS");
    expect(license).toContain("Copyright 2026 Scott Converse");
    expect(license).toContain('Licensed under the Apache License, Version 2.0 (the "License");');
    expect(license).not.toContain("All rights reserved");
    expect(JSON.parse(packageManifest).license).toBe("Apache-2.0");
    expect(nativeManifest).toMatch(/^license = "Apache-2\.0"$/m);
    expect(desktopManifest).toMatch(/^license = "Apache-2\.0"$/m);

    const bundle = JSON.parse(tauriConfig).bundle;
    expect(bundle.license).toBe("Apache-2.0");
    expect(bundle.licenseFile).toBe("../../../LICENSE");
    const bundledLicensePath = resolve(dirname(tauriConfigPath), bundle.licenseFile);
    expect(await realpath(bundledLicensePath)).toBe(
      await realpath(resolve(repositoryRoot, "LICENSE")),
    );
    expect(await readFile(bundledLicensePath, "utf8")).toBe(license);
  });
});
