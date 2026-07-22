import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowStep {
  readonly name?: string;
  readonly run?: string;
}

interface Workflow {
  readonly jobs: Readonly<Record<string, { readonly steps: readonly WorkflowStep[] }>>;
}

describe("Windows public-beta update and repair lifecycle", () => {
  it("proves beta.2 upgrade, same-version repair, uninstall, and reinstall with retained state", async () => {
    const [source, workflowSource] = await Promise.all([
      readFile(
        join(process.cwd(), "scripts", "windows", "test-update-repair-lifecycle.ps1"),
        "utf8",
      ),
      readFile(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8"),
    ]);
    const workflow = parse(workflowSource) as Workflow;
    const step = workflow.jobs["windows-installer"]?.steps.find(
      ({ name }) => name === "Upgrade public beta, repair, uninstall, and reinstall exact setup",
    );

    expect(step?.run).toContain("test-update-repair-lifecycle.ps1");
    expect(step?.run).toContain("-PreviousInstaller $env:SCADMILL_PREVIOUS_INSTALLER");
    expect(step?.run).toContain("-CandidateInstaller $env:SCADMILL_INSTALLER");
    expect(source).toContain("Previous public installer SHA256 verified");
    expect(source).toContain("Candidate installed application SHA256 verified after upgrade");
    expect(source).toContain("Same-version repair preserved application and user state");
    expect(source).toContain("Uninstall preserved user-owned project and application-managed state");
    expect(source).toContain("Reinstall restored the exact candidate and retained state");
    expect(source).toContain("Get-FileHash -Algorithm SHA256 -LiteralPath $projectFile");
    expect(source).toContain("scadmill.scratch-autosave.v2");
    expect(source).toContain("scadmill.upgrade-proof.v1");
  });
});
