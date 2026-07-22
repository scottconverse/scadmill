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

function namedStepBlock(jobId: string, stepName: string): string {
  const job = jobBlock(jobId);
  const marker = `      - name: ${stepName}\n`;
  const start = job.indexOf(marker);
  if (start === -1) throw new Error(`Workflow job ${jobId} is missing step ${stepName}.`);
  const remainder = job.slice(start + marker.length);
  const nextStep = remainder.search(/^ {6}- /m);
  return nextStep === -1 ? remainder : remainder.slice(0, nextStep);
}

function assertParityEvidenceUploadContract(step: string): void {
  expect(step).toContain("        if: always()\n");
  expect(step).toContain("          path: test-results/ac4-parity\n");
  expect(step).toContain("          if-no-files-found: error\n");
}

describe("regular CI workflow contract", () => {
  it("runs the full workflow for main and release-tag pushes", () => {
    expect(workflow).toContain("    branches: [main]\n    tags: ['v*']");
    expect(jobBlock("web")).toContain("run: pnpm check:blobs");
  });

  it("builds, lints, and render-tests the public website", () => {
    const website = jobBlock("website");

    expect(website).toContain("name: Public website checks");
    expect(website).toContain("cache-dependency-path: website/package-lock.json");
    expect(website).toContain("working-directory: website");
    expect(website).toContain("run: npm ci");
    expect(website).toContain("run: npm run lint");
    expect(website).toContain("run: npm test");
  });

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

  it("fails closed on high-impact dependency changes and every CI provenance path", () => {
    const web = jobBlock("web");
    const dependencyReview = namedStepBlock("web", "Review dependency changes");
    const base = namedStepBlock("web", "Resolve provenance comparison base");
    const provenance = namedStepBlock("web", "Provenance ledger");

    expect(dependencyReview).toContain("if: github.event_name == 'pull_request'");
    expect(dependencyReview).toContain(
      "uses: actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
    );
    expect(dependencyReview).toContain("fail-on-severity: high");
    expect(dependencyReview).toContain("license-check: false");
    expect(web).toContain("fetch-depth: 0");
    expect(base).toContain(`PUSH_BEFORE: \${{ github.event.before }}`);
    expect(base).toContain("base=\"$(git rev-parse HEAD^)\"");
    expect(base).toContain("git cat-file -e \"$base^{commit}\"");
    expect(provenance).toContain(
      `SCADMILL_PROVENANCE_BASE: \${{ steps.provenance-base.outputs.base }}`,
    );
    expect(() => {
      expect(provenance.replace("steps.provenance-base.outputs.base", "github.event.pull_request.base.sha"))
        .toContain(`SCADMILL_PROVENANCE_BASE: \${{ steps.provenance-base.outputs.base }}`);
    }).toThrow();
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

  it("retains production-composition batch-export evidence fail-closed on both browser platforms", () => {
    const acceptance = jobBlock("e2e");
    const browser = namedStepBlock("e2e", "Browser acceptance tests");
    const upload = namedStepBlock("e2e", "Retain batch export acceptance evidence");

    expect(acceptance).toMatch(/os:\s*\[\s*ubuntu-latest,\s*windows-latest\s*\]/u);
    expect(browser).not.toContain("if:");
    expect(browser).toContain(
      "SCADMILL_BATCH_EXPORT_ARTIFACT_DIR: test-results/batch-export-evidence",
    );
    expect(browser).toContain("run: pnpm test:e2e");
    expect(upload).toContain("        if: always()\n");
    expect(upload).toContain(`          name: batch-export-evidence-\${{ runner.os }}\n`);
    expect(upload).toContain("          path: test-results/batch-export-evidence\n");
    expect(upload).toContain("          if-no-files-found: error\n");
    expect(() => {
      expect(upload.replace("if-no-files-found: error", "if-no-files-found: warn"))
        .toContain("          if-no-files-found: error\n");
    }).toThrow();
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
    expect(namedStepBlock("e2e", "Stage source-built WASM for ephemeral verification"))
      .not.toContain("if:");
    expect(namedStepBlock("e2e", "Verify and stage ignored WASM runtime paths"))
      .not.toContain("if:");
    expect(jobBlock("parity")).toContain('"SCADMILL_AC4_OPENSCAD=$executable"');
  });

  it("fails closed when retained native/WASM parity evidence is missing", () => {
    const upload = namedStepBlock("parity", "Retain raw and canonical parity evidence");

    assertParityEvidenceUploadContract(upload);
    expect(() => assertParityEvidenceUploadContract(
      upload.replace("if-no-files-found: error", "if-no-files-found: warn"),
    )).toThrow();
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
