import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const execFileAsync = promisify(execFile);

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

function assertCanonicalPayloadIdentity(run: string | undefined): void {
  expect(run).toContain("node ./scripts/verify-tauri-bundle-identity.mjs");
  expect(run).toContain("--built $application");
  expect(run).toContain("--packaged $packagedApplication");
  expect(run).toContain("--out $identityEvidence");
  expect(run).toContain('"built-packaged-identity.json"');
  expect(run).toContain("if ($LASTEXITCODE -ne 0)");
  expect(run).toContain("Built application SHA256: $($identity.builtSha256)");
  expect(run).toContain("Exact setup application payload SHA256: $($identity.packagedSha256)");
  expect(run).toContain("Normalized identity match: $($identity.normalizedMatch)");
  expect(run).toContain('"SCADMILL_INSTALLER_IDENTITY_EVIDENCE=$identityEvidence"');
}

describe("installer lifecycle contract", () => {
  it("produces an offline current-user NSIS installer with static Visual C++ linkage", async () => {
    const root = process.cwd();
    const [
      tauriConfigSource,
      windowsConfigSource,
      packageSource,
      cargoConfig,
      installerHooks,
    ] =
      await Promise.all([
      readFile(
        join(root, "src", "desktop-shell", "src-tauri", "tauri.conf.json"),
        "utf8",
      ),
      readFile(
        join(root, "src", "desktop-shell", "src-tauri", "tauri.windows.conf.json"),
        "utf8",
      ),
      readFile(join(root, "package.json"), "utf8"),
      readFile(join(root, ".cargo", "config.toml"), "utf8").catch(() => ""),
      readFile(
        join(root, "src", "desktop-shell", "src-tauri", "windows", "installer-hooks.nsh"),
        "utf8",
      ),
      ]);
    const tauriConfig = JSON.parse(tauriConfigSource) as {
      build?: { beforeBuildCommand?: string };
      bundle?: {
        active?: boolean;
        targets?: string[];
        resources?: Record<string, string>;
        windows?: {
          nsis?: { compression?: string; installMode?: string; installerHooks?: string };
          webviewInstallMode?: { type?: string };
        };
      };
    };
    const windowsConfig = JSON.parse(windowsConfigSource) as {
      build?: { beforeBuildCommand?: string };
      bundle?: { resources?: Record<string, string> };
    };
    const packageManifest = JSON.parse(packageSource) as {
      scripts?: Readonly<Record<string, string>>;
    };

    expect(tauriConfig.bundle).toMatchObject({
      active: true,
      targets: ["nsis"],
      windows: {
        nsis: {
          compression: "zlib",
          installMode: "currentUser",
          installerHooks: "windows/installer-hooks.nsh",
        },
        webviewInstallMode: { type: "offlineInstaller" },
      },
    });
    expect(tauriConfig.bundle?.resources).toBeUndefined();
    expect(windowsConfig.bundle?.resources).toEqual({
      "../../../THIRD-PARTY-NOTICES.txt": "THIRD-PARTY-NOTICES.txt",
    });
    expect(tauriConfig.build?.beforeBuildCommand).toBe("pnpm --dir ../.. build:desktop");
    expect(windowsConfig.build?.beforeBuildCommand).toBe(
      "pnpm --dir ../.. build:desktop:tauri-prebuild",
    );
    expect(packageManifest.scripts?.["build:desktop:tauri-prebuild"]).toBe(
      "pnpm check:notices && pnpm build:desktop",
    );
    expect(cargoConfig).toContain(
      '[target.\'cfg(all(windows, target_env = "msvc"))\']',
    );
    expect(cargoConfig).toContain(
      'rustflags = ["-C", "target-feature=+crt-static"]',
    );
    expect(installerHooks).toContain("NSIS_HOOK_POSTINSTALL");
    expect(installerHooks).toContain(
      String.raw`WriteRegStr SHELL_CONTEXT "Software\Classes\OpenSCAD model\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""`,
    );
    expect(installerHooks).toContain("NSIS_HOOK_POSTUNINSTALL");
    expect(installerHooks).toContain('DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.scad"');
    expect(installerHooks).toContain('ReadRegStr $R0 SHELL_CONTEXT "Software\\Classes\\.scad" ""');
    expect(installerHooks).toContain(`\${If} $R0 == ""`);
    expect(installerHooks).toContain('DeleteRegKey /ifempty SHELL_CONTEXT "Software\\Classes\\.scad"');
  });

  it("binds the Windows installed lifecycle to exact bytes and active WebView state", async () => {
    const root = process.cwd();
    const [workflowSource, lifecycle, closeHelper] = await Promise.all([
      readFile(join(root, ".github", "workflows", "ci.yml"), "utf8"),
      readFile(join(root, "scripts", "windows", "test-installed-lifecycle.ps1"), "utf8"),
      readFile(join(root, "scripts", "windows", "lib", "installed-lifecycle-window.ps1"), "utf8"),
    ]);
    const workflow = parse(workflowSource) as Workflow;
    const job = workflow.jobs["windows-installer"];
    expect(job).toBeDefined();

    const buildProof = namedStep(
      job,
      "Verify setup artifact and static Visual C++ runtime linkage",
    );
    const sign = namedStep(job, "Sign setup executable");
    const noticesCheck = namedStep(job, "Verify distributable third-party notices");
    const build = namedStep(job, "Build offline NSIS setup");
    const hash = namedStep(job, "Hash exact setup bytes before lifecycle");
    const lifecycleStep = namedStep(
      job,
      "Install, launch, verify association, and uninstall exact setup",
    );
    const upload = namedStep(job, "Upload Windows setup");
    expect(lifecycle).toContain("Actual: '$openCommand'. Expected: '$expectedOpenCommand'.");
    expect(lifecycle).toContain("function Wait-WindowRect");
    expect(lifecycle).toContain("function Wait-VisibleWindowRect");
    expect(lifecycle).toContain("function Wait-WebViewReady");
    expect(lifecycle).toContain('. (Join-Path $PSScriptRoot "lib\\installed-lifecycle-window.ps1")');
    expect(lifecycle).toContain("GetWindowThreadProcessId");
    expect(closeHelper).toContain("$Target.Refresh()");
    expect(closeHelper).toContain("$currentHandle = [IntPtr](& $ResolveCurrentHandle $Process)");
    expect(closeHelper).toContain("$ownerProcessId -ne [int]$Process.Id");
    expect(closeHelper).toContain("& $PostClose $currentHandle");
    expect(closeHelper).not.toContain("SendMessage");
    expect(lifecycle).toContain("$requiredStableProbes = 3");
    expect(lifecycle).toContain("$minimumObservation = [DateTime]::UtcNow.AddMilliseconds(600)");
    expect(lifecycle).toContain("Last probe error:");
    expect(lifecycle).toContain(
      "$restored = Wait-WindowRect $second $secondHandle $expected $tolerance",
    );
    expect(lifecycle).toContain(
      "[void](Wait-VisibleWindowRect $third $thirdHandle $offscreenExpected $tolerance $virtualLeft $virtualTop $virtualRight $virtualBottom)",
    );
    expect(lifecycle).toContain("$offscreenWidth = [Math]::Max(800, $restoredWidth - 97)");
    expect(lifecycle).toContain("$offscreenHeight = [Math]::Max(600, $restoredHeight - 67)");
    expect(lifecycle).toContain("$matchesRestoredSize");
    expect(lifecycle).toContain("Expected size:");
    expect(lifecycle).toContain("Size deltas:");
    expect(lifecycle).toContain("function Format-WindowSize");
    expect(lifecycle).toContain("The observed off-monitor probe rectangle remained visible.");
    expect(lifecycle).toContain(
      "$offscreenExpected = Wait-WindowRect $second $secondHandle $offscreenRequested $tolerance",
    );
    expect(lifecycle).toContain("$offscreenExpected.Right -gt $virtualLeft");
    expect(lifecycle).toContain("Last actual:");
    expect(lifecycle).toContain("Deltas:");
    expect(lifecycle).not.toContain("$restored = Read-WindowRect $secondHandle");
    expect(lifecycle).not.toContain("$visible = Read-WindowRect $thirdHandle");
    const firstLaunch = lifecycle.indexOf("$first = Start-Process");
    const firstHandle = lifecycle.indexOf("$firstHandle = Wait-MainWindow $first", firstLaunch);
    const firstReady = lifecycle.indexOf("Wait-WebViewReady $debugPort", firstHandle);
    const firstMove = lifecycle.indexOf("[ScadMillWindowProbe]::MoveWindow($firstHandle", firstReady);
    const secondLaunch = lifecycle.indexOf("$second = Start-Process");
    const secondReady = lifecycle.indexOf("Wait-WebViewReady $debugPort", secondLaunch);
    const secondRestore = lifecycle.indexOf("$restored = Wait-WindowRect", secondReady);
    const associationReady = lifecycle.indexOf(
      'Write-Host "Associated fixture active in existing WebView',
      secondRestore,
    );
    const refreshedSecondHandle = lifecycle.indexOf(
      "$secondHandle = Wait-MainWindow $second",
      associationReady,
    );
    const offscreenMove = lifecycle.indexOf(
      "[ScadMillWindowProbe]::MoveWindow($secondHandle, 40000, 40000",
      associationReady,
    );
    const offscreenSettle = lifecycle.indexOf("$offscreenExpected = Wait-WindowRect", secondRestore);
    const secondClose = lifecycle.indexOf("Close-Normally $second", offscreenSettle);
    const thirdLaunch = lifecycle.indexOf("$third = Start-Process");
    const thirdReady = lifecycle.indexOf("Wait-WebViewReady $debugPort", thirdLaunch);
    const thirdRestore = lifecycle.indexOf("[void](Wait-VisibleWindowRect", thirdReady);
    expect(firstLaunch).toBeGreaterThan(-1);
    expect(firstHandle).toBeGreaterThan(firstLaunch);
    expect(firstReady).toBeGreaterThan(firstHandle);
    expect(firstMove).toBeGreaterThan(firstReady);
    expect(secondLaunch).toBeGreaterThan(-1);
    expect(secondReady).toBeGreaterThan(secondLaunch);
    expect(secondRestore).toBeGreaterThan(secondReady);
    expect(associationReady).toBeGreaterThan(secondRestore);
    expect(refreshedSecondHandle).toBeGreaterThan(associationReady);
    expect(offscreenMove).toBeGreaterThan(refreshedSecondHandle);
    expect(offscreenSettle).toBeGreaterThan(secondRestore);
    expect(secondClose).toBeGreaterThan(offscreenSettle);
    expect(thirdLaunch).toBeGreaterThan(-1);
    expect(thirdReady).toBeGreaterThan(thirdLaunch);
    expect(thirdRestore).toBeGreaterThan(thirdReady);
    expect(job.steps.indexOf(hash)).toBeLessThan(job.steps.indexOf(lifecycleStep));
    expect(job.steps.indexOf(noticesCheck)).toBeLessThan(job.steps.indexOf(build));
    expect(job.steps.indexOf(build)).toBeLessThan(job.steps.indexOf(buildProof));
    expect(job.steps.indexOf(buildProof)).toBeLessThan(job.steps.indexOf(sign));
    expect(job.steps.indexOf(lifecycleStep)).toBeLessThan(job.steps.indexOf(upload));
    expect(buildProof.run).toContain("7z e -y");
    expect(buildProof.run).toContain("SCADMILL_PACKAGED_APP=$packagedApplication");
    expect(buildProof.run).toContain("/dependents $packagedApplication");
    assertCanonicalPayloadIdentity(buildProof.run);
    expect(() => assertCanonicalPayloadIdentity(
      buildProof.run?.replace(
        "--packaged $packagedApplication",
        "--packaged $application",
      ),
    )).toThrow();
    expect(() => assertCanonicalPayloadIdentity(
      buildProof.run?.replace("node ./scripts/verify-tauri-bundle-identity.mjs", ""),
    )).toThrow();
    expect(lifecycleStep.run).toContain("-ExpectedApplication $env:SCADMILL_PACKAGED_APP");
    expect(lifecycleStep.run).toContain("-ExpectedNotices ./THIRD-PARTY-NOTICES.txt");
    expect(lifecycleStep.run).toContain("Tee-Object -FilePath $log");
    expect(upload.if).toBe("always() && env.SCADMILL_INSTALLER != ''");
    expect(upload.with?.path).toContain("scadmill-windows-lifecycle");

    expect(lifecycle).toContain("Clean preinstall state verified.");
    expect(lifecycle).toContain('sentinelProgId = "ScadMill.Lifecycle.Sentinel"');
    expect(lifecycle).toContain("Uninstall did not restore the prior .scad association.");
    expect(lifecycle).toContain("The ScadMill association backup marker remained after uninstall.");
    expect(lifecycle).toContain("$installedApplicationHash -cne $expectedApplicationHash");
    expect(lifecycle).toContain("$installedNoticesHash -cne $expectedNoticesHash");
    expect(lifecycle).toContain("Third-party notices remained installed after uninstall.");
    expect(lifecycle).toContain("$expectedOpenCommand");
    expect(lifecycle).toContain("GetValue(\"\")");
    expect(lifecycle).toContain("Invoke-DevToolsExpression");
    expect(lifecycle).toContain('method = "Runtime.evaluate"');
    expect(lifecycle).toContain("document.querySelector('.cm-content')?.innerText");
    expect(lifecycle).toContain("Wait-EditorSource $debugPort $modelSource");
    expect(lifecycle).toContain("Associated fixture active in existing WebView");
    expect(lifecycle).toContain("The ScadMill ProgID remained after uninstall.");
  });

  it("behaviorally rejects stale close targets and preserves the bounded failure path", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.platform === "win32" ? "powershell.exe" : "pwsh",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(process.cwd(), "tests", "scripts", "windows-lifecycle-close.behavior.ps1"),
      ],
      { timeout: 30_000, windowsHide: true },
    );
    expect(stderr).toBe("");
    expect(stdout).toContain("Windows lifecycle close behavior: PASS");
  }, 40_000);

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
    expect(job.steps.some((step) => step.name === "Verify distributable third-party notices")).toBe(
      false,
    );
    expect(prerequisites.run).toContain("xdotool");
    expect(mac.run).toContain("CGWindowListCopyWindowInfo");
    expect(mac.run).toContain("owner.int32Value == pid");
    expect(mac.run).toContain("set -euo pipefail");
    const attachStart = mac.run?.indexOf("printf 'Y\\n' | hdiutil attach") ?? -1;
    const mountedStart = mac.run?.indexOf("mounted=1", attachStart) ?? -1;
    const attachBlock = mac.run?.slice(attachStart, mountedStart) ?? "";
    expect(attachBlock).toBe(
      `printf 'Y\\n' | hdiutil attach \\\n  -nobrowse \\\n  -readonly \\\n  -mountpoint "$mount_point" \\\n  "$SCADMILL_DESKTOP_INSTALLER"\n`,
    );
    expect(mac.run).not.toContain("-acceptlicense");
    expect(attachBlock).not.toContain("-quiet");
    expect(attachBlock).not.toContain("-imagekey");
    expect(mac.run).not.toMatch(/\byes\b[^\n]*\|\s*hdiutil attach/u);
    expect(attachBlock).not.toContain("|| true");
    expect(mac.run?.match(/hdiutil attach/gu)).toHaveLength(1);
    expect(mac.run).toContain("trap cleanup_dmg EXIT");
    expect(mac.run).toContain('if [ "$mounted" -eq 1 ]; then');
    expect(mac.run).toContain('hdiutil detach "$mount_point" || cleanup_status=1');
    expect(mac.run).toContain(
      'if [ "$status" -eq 0 ] && [ "$cleanup_status" -ne 0 ]; then',
    );
    expect(mac.run).toContain('exit "$cleanup_status"');
    expect(mac.run).toContain('exit "$status"');
    const detached = mac.run?.indexOf('hdiutil detach "$mount_point"', mountedStart) ?? -1;
    const mountedClear = mac.run?.indexOf("mounted=0", detached) ?? -1;
    expect(attachStart).toBeGreaterThan(-1);
    expect(mountedStart).toBeGreaterThan(attachStart);
    expect(detached).toBeGreaterThan(mountedStart);
    expect(mountedClear).toBeGreaterThan(detached);
    expect(mac.run).toContain('test "$installed_executable_hash" = "$source_executable_hash"');
    expect(linux.run).toContain("Xvfb");
    expect(linux.run).toContain('APPIMAGE_EXTRACT_AND_RUN=1 "$installed"');
    expect(linux.run).toContain("collect_descendants()");
    expect(linux.run).toContain('readlink -f "/proc/$candidate_pid/exe"');
    expect(linux.run).toContain(
      'xdotool search --all --onlyvisible --pid "$candidate_pid" --name \'^ScadMill$\'',
    );
    expect(linux.run).toContain('xdotool getwindowpid "$window_id"');
    expect(linux.run).toContain('xdotool getwindowname "$window_id"');
    expect(linux.run).toContain('xdotool getwindowgeometry --shell "$window_id"');
    expect(linux.run).toContain("ps -eo pid=,ppid=,stat=,comm=,args=");
    expect(linux.run).toContain("AppImage launch proof failed");
    expect(linux.run).toContain("trap cleanup EXIT");
    const processGroupProbe = `launcher_group_ready=0
for _ in $(seq 1 20); do
  if ! kill -0 "$launcher_pid" 2>/dev/null; then
    break
  fi
  observed_launcher_pgid="$(ps -o pgid= -p "$launcher_pid" 2>/dev/null | tr -d ' ' || true)"
  if [ -n "$observed_launcher_pgid" ] && [ "$observed_launcher_pgid" = "$launcher_pid" ]; then
    launcher_pgid="$observed_launcher_pgid"
    launcher_group_ready=1
    break
  fi
  sleep 0.05
done
if [ "$launcher_group_ready" -ne 1 ]; then
  write_diagnostics "the exact AppImage launcher did not become its own isolated process group."
  exit 1
fi`;
    const cleanupTrap = linux.run?.indexOf("trap cleanup EXIT") ?? -1;
    const launcherStart = linux.run?.indexOf(
      'setsid env APPIMAGE_EXTRACT_AND_RUN=1 "$installed"',
    ) ?? -1;
    const processGroupStart = linux.run?.indexOf(processGroupProbe, launcherStart) ?? -1;
    const windowProbeStart = linux.run?.indexOf("ready=0", processGroupStart) ?? -1;
    expect(cleanupTrap).toBeGreaterThan(-1);
    expect(launcherStart).toBeGreaterThan(cleanupTrap);
    expect(processGroupStart).toBeGreaterThan(launcherStart);
    expect(windowProbeStart).toBeGreaterThan(processGroupStart);
    expect(linux.run).toContain('rm -f "$installed" || cleanup_status=1');
    expect(linux.run).toContain('[ -e "$installed" ] || [ -e "$extract_root" ]');
    expect(linux.run).toContain("AppImage cleanup failed to remove");
    expect(linux.run).toContain("visible_window_pid=$runtime_pid");
    expect(linux.run).not.toContain('readlink -f "/proc/$pid/exe"');
    expect(linux.run).toContain('test "$installed_hash" = "$expected_hash"');
    expect(upload.if).toBe("always() && env.SCADMILL_DESKTOP_INSTALLER != ''");
    expect(upload.with?.path).toContain("scadmill-*-window-evidence.txt");
    expect(upload.with?.path).toContain("scadmill-*-window-diagnostics.txt");
    expect(job.steps.indexOf(mac)).toBeLessThan(job.steps.indexOf(upload));
    expect(job.steps.indexOf(linux)).toBeLessThan(job.steps.indexOf(upload));
  });
});
