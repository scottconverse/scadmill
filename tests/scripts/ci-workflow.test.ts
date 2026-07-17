import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8").replaceAll(
  "\r\n",
  "\n",
);

function jobBlock(jobId: string): string {
  const marker = `  ${jobId}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) {
    return "";
  }

  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/^ {2}[a-zA-Z0-9_-]+:\n/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

describe("regular CI workflow contract", () => {
  it("runs desktop-shell Rust tests in the native V-2 lane", () => {
    expect(
      jobBlock("native").includes(
        "cargo test --locked --manifest-path src/desktop-shell/src-tauri/Cargo.toml",
      ),
      "the native job must execute the desktop-shell Rust test suite",
    ).toBe(true);
  });

  it("does not describe the resolved Q-0001 license policy as blocked", () => {
    expect(workflow.includes("Q-0001"), "the regular CI workflow must not retain stale Q-0001 copy").toBe(
      false,
    );
    expect(jobBlock("native").includes("name: Rust license policy")).toBe(true);
  });

  it("runs browser acceptance on both Linux and Windows for V-4", () => {
    const acceptance = jobBlock("e2e");

    expect(acceptance.length > 0, "the regular CI workflow must define an e2e job").toBe(true);
    expect(acceptance.includes(`runs-on: \${{ matrix.os }}`)).toBe(true);
    expect(/os:\s*\[\s*ubuntu-latest,\s*windows-latest\s*\]/.test(acceptance)).toBe(true);
    expect(acceptance.includes("if: runner.os == 'Linux'")).toBe(true);
    expect(acceptance.includes("if: runner.os == 'Windows'")).toBe(true);
    expect(acceptance.includes("run: pnpm test:e2e")).toBe(true);
  });

  it("stages the source-built WASM only inside ephemeral verification jobs", () => {
    const expectedArtifact = "openscad-wasm-0a66508c67374febcfc814a73b5b948dd84a1ca3";
    const expectedAction =
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093";
    for (const job of ["web", "e2e", "parity"]) {
      const workflowJob = jobBlock(job);
      expect(workflowJob).toContain(expectedAction);
      expect(workflowJob).toContain(expectedArtifact);
      expect(workflowJob).toContain(`path: \${{ runner.temp }}/openscad-wasm-source`);
      expect(workflowJob).toContain("run-id: 29529789154");
      expect(workflowJob).toContain("node scripts/stage-openscad-wasm-artifact.mjs");
    }
    expect(workflow).toContain("permissions:\n  actions: read\n  contents: read");
    expect(jobBlock("e2e")).toContain("if: runner.os == 'Linux'");
  });

  it("preflights signing before build, then signs, verifies, hashes, and uploads Windows setup", () => {
    const installer = jobBlock("windows-installer");
    const preflight = installer.indexOf("Signing credential preflight (fail fast)");
    const build = installer.indexOf("pnpm exec tauri build --bundles nsis --ci -- --locked");
    const sign = installer.indexOf("Azure/artifact-signing-action@c7ab2a863ab5f9a846ddb8265964877ef296ee82");
    const verify = installer.indexOf("Get-AuthenticodeSignature $env:SCADMILL_INSTALLER");
    const hash = installer.indexOf("Hash exact setup bytes before lifecycle");
    const upload = installer.indexOf("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");

    expect(installer).toContain("runs-on: windows-latest");
    expect(installer).toContain("https://codesigning.azure.net/.default");
    expect(installer).toContain(
      `azure-client-secret: \${{ secrets.AZURE_CLIENT_SECRET }}`,
    );
    expect(installer).toContain(`endpoint: \${{ secrets.AZURE_SIGNING_ENDPOINT }}`);
    expect(installer).toContain('signing-account-name: "scottconverse-signing"');
    expect(installer).toContain('certificate-profile-name: "ScottConversePublic"');
    expect(installer).toContain("if ($signature.Status -ne 'Valid')");
    expect(installer).not.toContain("azure/login");
    expect([preflight, build, sign, verify, hash, upload]).toEqual(
      [...[preflight, build, sign, verify, hash, upload]].sort((left, right) => left - right),
    );
    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThanOrEqual(0);
  });

  it("builds and hashes unsigned-capable macOS DMG and Linux AppImage artifacts", () => {
    const installers = jobBlock("desktop-installers");
    const build = installers.indexOf(
      `pnpm exec tauri build --bundles "\${{ matrix.bundle }}" --ci -- --locked`,
    );
    const hash = installers.indexOf('createHash("sha256")');
    const upload = installers.indexOf(
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    );

    expect(installers).toContain(`runs-on: \${{ matrix.os }}`);
    expect(installers).toContain("os: macos-latest");
    expect(installers).toContain("bundle: dmg");
    expect(installers).toContain("pattern: '*.dmg'");
    expect(installers).toContain("os: ubuntu-22.04");
    expect(installers).toContain("bundle: appimage");
    expect(installers).toContain("pattern: '*.AppImage'");
    expect(installers).toContain("if: runner.os == 'Linux'");
    expect(installers).toContain("rustc --version | grep '^rustc 1.96.0 '");
    expect(installers).toContain("if-no-files-found: error");
    expect([build, hash, upload]).toEqual(
      [...[build, hash, upload]].sort((left, right) => left - right),
    );
    expect(build).toBeGreaterThanOrEqual(0);
  });
});
