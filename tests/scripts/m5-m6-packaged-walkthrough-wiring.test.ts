import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("M5/M6 packaged walkthrough wiring", () => {
  it("runs and host-verifies the named M5/M6 inventory inside the release Sandbox", async () => {
    const [bootstrap, wrapper, runner] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "windows", "run-packaged-desktop-sandbox.ps1"), "utf8"),
      readFile(join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"), "utf8"),
      readFile(join(process.cwd(), "scripts", "run-m5-m6-packaged-walkthrough.mjs"), "utf8"),
    ]);

    expect(bootstrap).toContain("run-m5-m6-packaged-walkthrough.mjs");
    expect(bootstrap).toContain("m5-m6-packaged-walkthrough.json");
    expect(bootstrap).toContain("M5_M6_GUEST_PASS");
    expect(bootstrap.indexOf("run-packaged-desktop-evidence.mjs")).toBeLessThan(
      bootstrap.indexOf("run-m5-m6-packaged-walkthrough.mjs"),
    );
    expect(bootstrap).toContain("if ($exitCode -eq 0)");
    expect(wrapper).toContain("run-m5-m6-packaged-walkthrough.mjs");
    expect(wrapper).toContain("host-m5-m6-verification.json");
    expect(wrapper).toContain("m5M6PackagedWalkthrough");
    expect(wrapper).toContain("[Parameter(Mandatory = $true)] [string] $CiEvidenceRoot");
    expect(wrapper).toContain(".IndexOf(");
    expect(wrapper).not.toContain(".Contains($PathFragment");
    expect(wrapper).toContain("gh run view $CiRunId");
    expect(wrapper).toContain("Exact CI run head differs from source commit");
    expect(wrapper).toContain("Cleanroom canonical application differs from exact CI's canonical application");
    expect(wrapper).toContain("Get-AuthenticodeSignature -LiteralPath $installerPath");
    expect(wrapper).toContain("Batch artifact byte count differs");
    expect(wrapper).toContain("hostM5M6Arguments");
    expect(runner).toContain("screenshotElement");
    expect(runner).toContain("view.dispatch({selection: {anchor: view.state.doc.length}})");
    expect(runner).toContain("BOSL2 removal state");
    expect(runner).toContain("Installed OpenSCAD versions could not be read.");
    expect(runner).not.toContain("Engine version list could not be loaded");
  });
});
