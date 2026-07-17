import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowStep {
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
  readonly with?: {
    readonly path?: string;
    readonly [key: string]: unknown;
  };
}

interface WorkflowJob {
  readonly steps: readonly WorkflowStep[];
}

interface Workflow {
  readonly jobs: Readonly<Record<string, WorkflowJob>>;
}

function namedStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps.find((candidate) => candidate.name === name);
  if (!step) {
    throw new Error(`Missing workflow step ${JSON.stringify(name)}.`);
  }
  return step;
}

describe("installer lifecycle contract", () => {
  it("produces an offline current-user NSIS installer with static Visual C++ linkage", async () => {
    const root = process.cwd();
    const [tauriConfigSource, cargoConfig, installerHooks] = await Promise.all([
      readFile(
        join(root, "src", "desktop-shell", "src-tauri", "tauri.conf.json"),
        "utf8",
      ),
      readFile(join(root, ".cargo", "config.toml"), "utf8").catch(() => ""),
      readFile(
        join(root, "src", "desktop-shell", "src-tauri", "windows", "installer-hooks.nsh"),
        "utf8",
      ),
    ]);
    const tauriConfig = JSON.parse(tauriConfigSource) as {
      bundle?: {
        active?: boolean;
        targets?: string[];
        windows?: {
          nsis?: { installMode?: string; installerHooks?: string };
          webviewInstallMode?: { type?: string };
        };
      };
    };

    expect(tauriConfig.bundle).toMatchObject({
      active: true,
      targets: ["nsis"],
      windows: {
        nsis: {
          installMode: "currentUser",
          installerHooks: "windows/installer-hooks.nsh",
        },
        webviewInstallMode: { type: "offlineInstaller" },
      },
    });
    expect(cargoConfig).toContain(
      '[target.\'cfg(all(windows, target_env = "msvc"))\']',
    );
    expect(cargoConfig).toContain(
      'rustflags = ["-C", "target-feature=+crt-static"]',
    );
    expect(installerHooks).toContain("NSIS_HOOK_POSTUNINSTALL");
    expect(installerHooks).toContain('DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.scad"');
    expect(installerHooks).toContain('ReadRegStr $R0 SHELL_CONTEXT "Software\\Classes\\.scad" ""');
    expect(installerHooks).toContain(`\${If} $R0 == ""`);
    expect(installerHooks).toContain('DeleteRegKey /ifempty SHELL_CONTEXT "Software\\Classes\\.scad"');
  });

  it("binds the Windows installed lifecycle to exact bytes and active WebView state", async () => {
    const root = process.cwd();
    const [workflowSource, lifecycle] = await Promise.all([
      readFile(join(root, ".github", "workflows", "ci.yml"), "utf8"),
      readFile(join(root, "scripts", "windows", "test-installed-lifecycle.ps1"), "utf8"),
    ]);
    const workflow = parse(workflowSource) as Workflow;
    const job = workflow.jobs["windows-installer"];
    expect(job).toBeDefined();

    const buildProof = namedStep(
      job,
      "Verify setup artifact and static Visual C++ runtime linkage",
    );
    const hash = namedStep(job, "Hash exact setup bytes before lifecycle");
    const lifecycleStep = namedStep(
      job,
      "Install, launch, verify association, and uninstall exact setup",
    );
    const upload = namedStep(job, "Upload Windows setup");
    expect(job.steps.indexOf(hash)).toBeLessThan(job.steps.indexOf(lifecycleStep));
    expect(job.steps.indexOf(lifecycleStep)).toBeLessThan(job.steps.indexOf(upload));
    expect(buildProof.run).toContain("7z e -y");
    expect(buildProof.run).toContain("SCADMILL_PACKAGED_APP=$packagedApplication");
    expect(buildProof.run).toContain("/dependents $packagedApplication");
    expect(lifecycleStep.run).toContain("-ExpectedApplication $env:SCADMILL_PACKAGED_APP");
    expect(lifecycleStep.run).toContain("Tee-Object -FilePath $log");
    expect(upload.if).toBe("always() && env.SCADMILL_INSTALLER != ''");
    expect(upload.with?.path).toContain("scadmill-windows-lifecycle");

    expect(lifecycle).toContain("Clean preinstall state verified.");
    expect(lifecycle).toContain('sentinelProgId = "ScadMill.Lifecycle.Sentinel"');
    expect(lifecycle).toContain("Uninstall did not restore the prior .scad association.");
    expect(lifecycle).toContain("The ScadMill association backup marker remained after uninstall.");
    expect(lifecycle).toContain("$installedApplicationHash -cne $expectedApplicationHash");
    expect(lifecycle).toContain("$expectedOpenCommand");
    expect(lifecycle).toContain("GetValue(\"\")");
    expect(lifecycle).toContain("Invoke-DevToolsExpression");
    expect(lifecycle).toContain('method = "Runtime.evaluate"');
    expect(lifecycle).toContain("document.querySelector('.cm-content')?.innerText");
    expect(lifecycle).toContain("Wait-EditorSource $debugPort $modelSource");
    expect(lifecycle).toContain("Associated fixture active in existing WebView");
    expect(lifecycle).toContain("The ScadMill ProgID remained after uninstall.");
  });

  it("requires a visible exact macOS/Linux runtime and retains failure evidence", async () => {
    const workflowSource = await readFile(
      join(process.cwd(), ".github", "workflows", "ci.yml"),
      "utf8",
    );
    const workflow = parse(workflowSource) as Workflow;
    const job = workflow.jobs["desktop-installers"];
    expect(job).toBeDefined();

    const prerequisites = namedStep(job, "Install Linux desktop build prerequisites");
    const mac = namedStep(job, "Mount, launch, and remove macOS candidate");
    const linux = namedStep(job, "Launch and remove Linux AppImage candidate");
    const upload = namedStep(job, "Upload platform installer");
    expect(prerequisites.run).toContain("xdotool");
    expect(mac.run).toContain("CGWindowListCopyWindowInfo");
    expect(mac.run).toContain("owner.int32Value == pid");
    expect(mac.run).toContain('test "$installed_executable_hash" = "$source_executable_hash"');
    expect(linux.run).toContain("Xvfb");
    expect(linux.run).toContain("xdotool search --onlyvisible --pid");
    expect(linux.run).toContain('readlink -f "/proc/$pid/exe"');
    expect(linux.run).toContain('test "$installed_hash" = "$expected_hash"');
    expect(upload.if).toBe("always() && env.SCADMILL_DESKTOP_INSTALLER != ''");
    expect(upload.with?.path).toContain("scadmill-*-window-evidence.txt");
    expect(job.steps.indexOf(mac)).toBeLessThan(job.steps.indexOf(upload));
    expect(job.steps.indexOf(linux)).toBeLessThan(job.steps.indexOf(upload));
  });
});
