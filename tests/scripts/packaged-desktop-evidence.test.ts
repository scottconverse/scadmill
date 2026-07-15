import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  mirrorWebViewDevToolsPort,
  parseSourceMetadata,
  parseBinaryStl,
  processHasExited,
  scanFileForBytes,
  unwrapWebDriverValue,
  validatePackagedWorkspaceLayoutObservation,
  validatePackagedWorkspaceLayoutRestart,
  validateSourceMetadata,
  validateHarnessManifest,
  validateSandboxConfig,
  validateCredentialProbe,
  webViewAutomationArgument,
} from "../../scripts/lib/packaged-desktop-evidence.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function binaryStl(triangles: readonly (readonly [number, number, number])[][]): Uint8Array {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, triangleIndex) => {
    const offset = 84 + triangleIndex * 50;
    triangle.forEach((vertex, vertexIndex) => {
      vertex.forEach((coordinate, axis) => {
        view.setFloat32(offset + 12 + vertexIndex * 12 + axis * 4, coordinate, true);
      });
    });
  });
  return bytes;
}

describe("packaged desktop evidence helpers", () => {
  it("parses exact binary-STL triangle counts and finite bounds", () => {
    const evidence = parseBinaryStl(binaryStl([
      [[0, 0, 0], [10, 0, 0], [0, 10, 0]],
      [[10, 0, 10], [10, 10, 10], [0, 10, 10]],
    ]));

    expect(evidence).toEqual({
      triangleCount: 2,
      bounds: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] },
    });
  });

  it("rejects truncated and non-finite binary-STL payloads", () => {
    const truncated = binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]).subarray(0, 100);
    expect(() => parseBinaryStl(truncated)).toThrow("length");

    const nonFinite = binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]);
    new DataView(nonFinite.buffer).setFloat32(96, Number.NaN, true);
    expect(() => parseBinaryStl(nonFinite)).toThrow("finite");
  });

  it("unwraps successful WebDriver values and preserves remote errors", () => {
    expect(unwrapWebDriverValue({ value: { sessionId: "session-1" } })).toEqual({
      sessionId: "session-1",
    });
    expect(() => unwrapWebDriverValue({
      value: { error: "no such element", message: "missing button", stacktrace: "remote stack" },
    })).toThrow("no such element: missing button");
  });

  it("accepts only the exact credential target and expected Win32 state", () => {
    expect(validateCredentialProbe({
      target: "ai-api-key.dev.scadmill.app",
      found: true,
      lastError: 0,
    }, "ai-api-key.dev.scadmill.app", true)).toMatchObject({ found: true, lastError: 0 });
    expect(validateCredentialProbe({
      target: "ai-api-key.dev.scadmill.app",
      found: false,
      lastError: 1168,
    }, "ai-api-key.dev.scadmill.app", false)).toMatchObject({ found: false, lastError: 1168 });
    expect(() => validateCredentialProbe({
      target: "other",
      found: false,
      lastError: 1168,
    }, "ai-api-key.dev.scadmill.app", false)).toThrow("target");
  });

  it("validates one exact opaque project layout observation", () => {
    const workspaceIdentity = `desktop-project:${"a".repeat(64)}`;
    const storageKey = `scadmill.desktop-workspace-layout.v1:${workspaceIdentity}`;
    const serializedLayout = JSON.stringify({
      version: 1,
      activeRail: "files",
      dockOpen: true,
      editorOpen: true,
      viewerOpen: true,
      parameterOpen: true,
      consoleOpen: false,
      dockWidth: 300,
      viewerWidth: 480,
      parameterHeight: 220,
      consoleHeight: 180,
      narrowView: "code",
    });

    expect(validatePackagedWorkspaceLayoutObservation({
      dockWidth: 300,
      storageEntries: [{ key: storageKey, value: serializedLayout }],
    }, 300)).toEqual({
      dockWidth: 300,
      serializedLayout,
      storageKey,
      workspaceIdentity,
    });
  });

  it("rejects serialized layout evidence that could expose a raw project path", () => {
    const workspaceIdentity = `desktop-project:${"a".repeat(64)}`;
    const storageKey = `scadmill.desktop-workspace-layout.v1:${workspaceIdentity}`;
    const serializedLayout = JSON.stringify({
      version: 1,
      activeRail: "files",
      dockOpen: true,
      editorOpen: true,
      viewerOpen: true,
      parameterOpen: true,
      consoleOpen: false,
      dockWidth: 300,
      viewerWidth: 480,
      parameterHeight: 220,
      consoleHeight: 180,
      narrowView: "code",
      projectPath: "C:\\Users\\Scott\\Secret",
    });

    expect(() => validatePackagedWorkspaceLayoutObservation({
      dockWidth: 300,
      storageEntries: [{ key: storageKey, value: serializedLayout }],
    }, 300)).toThrow("layout value has the wrong shape");
  });

  it("rejects scratch, ambiguous, and wrong-width packaged layout observations", () => {
    const workspaceIdentity = `desktop-project:${"a".repeat(64)}`;
    const storageKey = `scadmill.desktop-workspace-layout.v1:${workspaceIdentity}`;
    const layout = {
      version: 1,
      activeRail: "files",
      dockOpen: true,
      editorOpen: true,
      viewerOpen: true,
      parameterOpen: true,
      consoleOpen: false,
      dockWidth: 300,
      viewerWidth: 480,
      parameterHeight: 220,
      consoleHeight: 180,
      narrowView: "code",
    };
    const entry = { key: storageKey, value: JSON.stringify(layout) };

    expect(() => validatePackagedWorkspaceLayoutObservation({
      dockWidth: 300,
      storageEntries: [{ ...entry, key: "scadmill.desktop-workspace-layout.v1:scratch" }],
    }, 300)).toThrow("opaque project identity");
    expect(() => validatePackagedWorkspaceLayoutObservation({
      dockWidth: 300,
      storageEntries: [entry, entry],
    }, 300)).toThrow("wrong shape or width");
    expect(() => validatePackagedWorkspaceLayoutObservation({
      dockWidth: 300,
      storageEntries: [{ ...entry, value: JSON.stringify({ ...layout, dockWidth: 292 }) }],
    }, 300)).toThrow("wrong dock width");
  });

  it("requires an exact layout round trip through fresh app and WebView processes", () => {
    const workspaceIdentity = `desktop-project:${"a".repeat(64)}`;
    const layout = {
      dockWidth: 300,
      serializedLayout: JSON.stringify({
        version: 1,
        activeRail: "files",
        dockOpen: true,
        editorOpen: true,
        viewerOpen: true,
        parameterOpen: true,
        consoleOpen: false,
        dockWidth: 300,
        viewerWidth: 480,
        parameterHeight: 220,
        consoleHeight: 180,
        narrowView: "code",
      }),
      storageKey: `scadmill.desktop-workspace-layout.v1:${workspaceIdentity}`,
      workspaceIdentity,
    };

    expect(validatePackagedWorkspaceLayoutRestart({
      applicationPid: 120,
      webViewPids: [121, 122],
      layout,
    }, {
      applicationPid: 220,
      webViewPids: [221, 222],
      layout: { ...layout },
    })).toEqual({
      exactLayoutRestored: true,
      freshApplicationProcess: true,
      freshWebViewProcesses: true,
    });
  });

  it("rejects retained processes and changed values in a layout restart observation", () => {
    const workspaceIdentity = `desktop-project:${"a".repeat(64)}`;
    const serializedLayout = JSON.stringify({
      version: 1,
      activeRail: "files",
      dockOpen: true,
      editorOpen: true,
      viewerOpen: true,
      parameterOpen: true,
      consoleOpen: false,
      dockWidth: 300,
      viewerWidth: 480,
      parameterHeight: 220,
      consoleHeight: 180,
      narrowView: "code",
    });
    const layout = {
      dockWidth: 300,
      serializedLayout,
      storageKey: `scadmill.desktop-workspace-layout.v1:${workspaceIdentity}`,
      workspaceIdentity,
    };
    const before = { applicationPid: 120, webViewPids: [121, 122], layout };

    expect(() => validatePackagedWorkspaceLayoutRestart(before, {
      applicationPid: 120,
      webViewPids: [221, 222],
      layout,
    })).toThrow("fresh application process");
    expect(() => validatePackagedWorkspaceLayoutRestart(before, {
      applicationPid: 220,
      webViewPids: [122, 222],
      layout,
    })).toThrow("fresh WebView processes");
    expect(() => validatePackagedWorkspaceLayoutRestart(before, {
      applicationPid: 220,
      webViewPids: [221, 222],
      layout: {
        ...layout,
        serializedLayout: serializedLayout.replace('"viewerWidth":480', '"viewerWidth":500'),
      },
    })).toThrow("restored exactly");
  });

  it("observes the implicit HR separator through a concrete DOM selector", async () => {
    const runner = await readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8");

    expect(runner).toContain("querySelectorAll('hr[aria-label]')");
    expect(runner).not.toContain("querySelectorAll('[role=\"separator\"]')");
  });

  it("finds a sentinel split across streaming read boundaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-evidence-"));
    temporaryRoots.push(root);
    const path = join(root, "written.bin");
    await writeFile(path, Buffer.from("01234567SENTINEL-tail"));

    await expect(scanFileForBytes(path, Buffer.from("SENTINEL"), 12)).resolves.toBe(true);
    await expect(scanFileForBytes(path, Buffer.from("absent"), 12)).resolves.toBe(false);
  });

  it("mirrors the fresh WebView2 DevTools port file to EdgeDriver's expected parent", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-webview-port-"));
    temporaryRoots.push(root);
    const webViewRoot = join(root, "EBWebView");
    await mkdir(webViewRoot);

    const mirror = mirrorWebViewDevToolsPort(root, { timeoutMs: 1_000, intervalMs: 5 });
    await writeFile(join(webViewRoot, "DevToolsActivePort"), "54321\n/devtools/browser/fresh\n");

    await expect(mirror).resolves.toMatchObject({ copied: true });
    await expect(readFile(join(root, "DevToolsActivePort"), "utf8"))
      .resolves.toBe("54321\n/devtools/browser/fresh\n");
  });

  it("forces WebView2 remote debugging through the documented host-app switch", () => {
    expect(webViewAutomationArgument()).toBe(
      "--edge-webview-switches=--remote-debugging-port=0",
    );
  });

  it("grants the copied fixed WebView runtime AppContainer access before driver launch", async () => {
    const bootstrap = await readFile(
      join(process.cwd(), "scripts", "windows", "run-packaged-desktop-sandbox.ps1"),
      "utf8",
    );
    const allPackages = bootstrap.indexOf('"*S-1-15-2-2:(OI)(CI)(RX)"');
    const restrictedPackages = bootstrap.indexOf('"*S-1-15-2-1:(OI)(CI)(RX)"');
    const aclCommand = bootstrap.indexOf('& icacls.exe "$local\\webview" /grant $grant /T /C /Q');
    const runnerLaunch = bootstrap.indexOf('& "$local\\tools\\node.exe" @arguments');

    expect(allPackages).toBeGreaterThanOrEqual(0);
    expect(restrictedPackages).toBeGreaterThan(allPackages);
    expect(aclCommand).toBeGreaterThan(restrictedPackages);
    expect(runnerLaunch).toBeGreaterThan(aclCommand);
  });

  it("places the Visual C++ runtime beside the packaged app before launch", async () => {
    const [bootstrap, wrapper, runner] = await Promise.all([
      readFile(
        join(process.cwd(), "scripts", "windows", "run-packaged-desktop-sandbox.ps1"),
        "utf8",
      ),
      readFile(
        join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"),
        "utf8",
      ),
      readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8"),
    ]);
    const runtimeCopy = bootstrap.indexOf(
      'Copy-Item -LiteralPath "$local\\tools\\vcruntime140.dll" -Destination "$local\\app\\vcruntime140.dll" -Force -ErrorAction Stop',
    );
    const companionCopy = bootstrap.indexOf(
      'Copy-Item -LiteralPath "$local\\tools\\vcruntime140_1.dll" -Destination "$local\\app\\vcruntime140_1.dll" -Force -ErrorAction Stop',
    );
    const runnerLaunch = bootstrap.indexOf('& "$local\\tools\\node.exe" @arguments');

    expect(runtimeCopy).toBeGreaterThanOrEqual(0);
    expect(companionCopy).toBeGreaterThan(runtimeCopy);
    expect(runnerLaunch).toBeGreaterThan(companionCopy);
    expect(wrapper).toContain(
      '[Parameter(Mandatory = $true)] [string] $VisualCppRuntimeCompanion',
    );
    expect(wrapper).toContain(
      'Copy-Item -LiteralPath $visualCppRuntimeCompanionPath -Destination (Join-Path $stage "tools\\vcruntime140_1.dll")',
    );
    expect(runner).toContain('join(dirname(args["tauri-driver"]), "vcruntime140_1.dll")');
    expect(runner).toContain("1F2D41C4AA5DB0BC33EBF7B66D72943A817D7CE6CBE880502A9403823633093F");
  });

  it("binds evidence metadata to one clean source tree and its locked same-step build", () => {
    const appSha256 = "82".repeat(32);
    const metadata = {
      schemaVersion: 1,
      sourceCommit: "e6".repeat(20),
      sourceTree: "ab".repeat(20),
      branch: "agent/m2-r02-r03",
      canonicalApplication: "src/desktop-shell/src-tauri/target/release/scadmill.exe",
      applicationSha256: appSha256,
      worktree: { cleanBeforeBuild: true, cleanAfterBuild: true },
      lockfiles: {
        pnpm: { path: "pnpm-lock.yaml", sha256: "11".repeat(32) },
        nativeCargo: { path: "src/native-engine/Cargo.lock", sha256: "22".repeat(32) },
        desktopCargo: {
          path: "src/desktop-shell/src-tauri/Cargo.lock",
          sha256: "33".repeat(32),
        },
      },
      build: {
        startedAt: "2026-07-11T23:00:00.000Z",
        completedAt: "2026-07-11T23:02:00.000Z",
        commands: [
          "pnpm.cmd install --frozen-lockfile",
          "cargo.exe clean --manifest-path src/desktop-shell/src-tauri/Cargo.toml --target-dir src/desktop-shell/src-tauri/target",
          "pnpm.cmd exec tauri build --no-bundle --ci -- --locked",
        ],
        toolVersions: {
          node: "v24.17.0",
          pnpm: "11.7.0",
          cargo: "cargo 1.96.0 (example 2026-01-01)",
          rustc: "rustc 1.96.0 (example 2026-01-01)",
        },
      },
    };

    expect(validateSourceMetadata(metadata, appSha256)).toEqual(metadata);
    expect(() => validateSourceMetadata({
      ...metadata,
      applicationSha256: "00".repeat(32),
    }, appSha256)).toThrow("release hash");
    expect(() => validateSourceMetadata({
      ...metadata,
      worktree: { ...metadata.worktree, cleanBeforeBuild: false },
    }, appSha256)).toThrow("clean worktree");
    expect(() => validateSourceMetadata({
      ...metadata,
      build: { ...metadata.build, commands: metadata.build.commands.slice(1) },
    }, appSha256)).toThrow("locked build provenance");
  });

  it("parses PowerShell UTF-8 source metadata without accepting a mismatched app", () => {
    const appSha256 = "82".repeat(32);
    const serialized = `\uFEFF${JSON.stringify({
      schemaVersion: 1,
      sourceCommit: "e6".repeat(20),
      sourceTree: "ab".repeat(20),
      branch: "agent/m2-r02-r03",
      canonicalApplication: "src/desktop-shell/src-tauri/target/release/scadmill.exe",
      applicationSha256: appSha256,
      worktree: { cleanBeforeBuild: true, cleanAfterBuild: true },
      lockfiles: {
        pnpm: { path: "pnpm-lock.yaml", sha256: "11".repeat(32) },
        nativeCargo: { path: "src/native-engine/Cargo.lock", sha256: "22".repeat(32) },
        desktopCargo: {
          path: "src/desktop-shell/src-tauri/Cargo.lock",
          sha256: "33".repeat(32),
        },
      },
      build: {
        startedAt: "2026-07-11T23:00:00.000Z",
        completedAt: "2026-07-11T23:02:00.000Z",
        commands: [
          "pnpm.cmd install --frozen-lockfile",
          "cargo.exe clean --manifest-path src/desktop-shell/src-tauri/Cargo.toml --target-dir src/desktop-shell/src-tauri/target",
          "pnpm.cmd exec tauri build --no-bundle --ci -- --locked",
        ],
        toolVersions: {
          node: "v24.17.0",
          pnpm: "11.7.0",
          cargo: "cargo 1.96.0 (example 2026-01-01)",
          rustc: "rustc 1.96.0 (example 2026-01-01)",
        },
      },
    })}`;
    expect(parseSourceMetadata(serialized, appSha256)).toMatchObject({ branch: "agent/m2-r02-r03" });
    expect(() => parseSourceMetadata(serialized, "00".repeat(32))).toThrow("release hash");
  });

  it("fails closed before staging unless a clean HEAD is built at the canonical target", async () => {
    const wrapper = await readFile(
      join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"),
      "utf8",
    );
    const cleanBefore = wrapper.indexOf("Assert-CleanWorktree \"before build\"");
    const emptyOutput = wrapper.indexOf(
      "Get-ChildItem -LiteralPath $outputPath -Force -ErrorAction Stop",
    );
    const install = wrapper.indexOf('-Arguments @("install", "--frozen-lockfile")');
    const cargoClean = wrapper.indexOf('-Arguments @("clean", "--manifest-path"');
    const tauriBuild = wrapper.indexOf(
      '-Arguments @("exec", "tauri", "build", "--no-bundle", "--ci", "--", "--locked")',
    );
    const cleanAfter = wrapper.indexOf("Assert-CleanWorktree \"after build\"");
    const stageApplication = wrapper.indexOf(
      'Copy-Item -LiteralPath $applicationPath -Destination (Join-Path $stage "app\\scadmill.exe")',
    );
    const retainedConfig = wrapper.indexOf(
      'Copy-Item -LiteralPath $configPath -Destination (Join-Path $outputPath "sandbox-config.wsb")',
    );
    const launchClean = wrapper.indexOf('Assert-CleanWorktree "before Sandbox launch"');
    const launchTree = wrapper.indexOf('"launch source tree"');
    const sandboxLaunch = wrapper.indexOf('Start-Process -FilePath "WindowsSandbox.exe"');

    expect(wrapper).not.toContain("[string] $Application");
    expect(wrapper).toContain('git -C $repo status --porcelain=v1 --untracked-files=all');
    expect(wrapper).toContain(
      '$canonicalApplication = "src/desktop-shell/src-tauri/target/release/scadmill.exe"',
    );
    expect(wrapper).toContain(
      '-Arguments @("clean", "--manifest-path", $desktopManifest, "--target-dir", $desktopTarget) -WorkingDirectory $repo -LogPath $desktopCleanLog',
    );
    expect(wrapper).not.toContain('"--package", "scadmill-desktop"');
    for (const marker of [
      cleanBefore,
      emptyOutput,
      install,
      cargoClean,
      tauriBuild,
      cleanAfter,
      stageApplication,
      retainedConfig,
      launchClean,
      launchTree,
      sandboxLaunch,
    ]) expect(marker).toBeGreaterThanOrEqual(0);
    expect([
      cleanBefore,
      emptyOutput,
      install,
      cargoClean,
      tauriBuild,
      cleanAfter,
      stageApplication,
    ])
      .toEqual([...[
        cleanBefore,
        emptyOutput,
        install,
        cargoClean,
        tauriBuild,
        cleanAfter,
        stageApplication,
      ]].sort((left, right) => left - right));
    expect(stageApplication).toBeGreaterThan(cleanAfter);
    expect(wrapper).not.toContain('-Arguments @("build", "--release", "--locked"');
    expect([retainedConfig, launchClean, launchTree, sandboxLaunch]).toEqual([
      ...[retainedConfig, launchClean, launchTree, sandboxLaunch].sort((left, right) => left - right),
    ]);
  });

  it("fails closed when packaged process inspection cannot complete", async () => {
    const [runner, wrapper] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8"),
      readFile(
        join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"),
        "utf8",
      ),
    ]);
    const hostInspections = [...wrapper.matchAll(/Get-CimInstance Win32_Process[^\r\n]*/gu)]
      .map(([line]) => line);

    expect(hostInspections).toHaveLength(2);
    for (const inspection of hostInspections) {
      expect(inspection).toContain("-ErrorAction Stop");
      expect(inspection).not.toContain("SilentlyContinue");
    }
    expect(
      hostInspections.some((inspection) =>
        inspection.includes("Name = 'WindowsSandboxRemoteSession.exe'"),
      ),
    ).toBe(true);
    expect(
      hostInspections.some((inspection) =>
        inspection.includes('ProcessId = $([int]$Identity.ProcessId)'),
      ),
    ).toBe(true);
    expect(runner).toContain("Get-Process -ErrorAction Stop | Where-Object");
    expect(runner).not.toContain("Get-CimInstance Win32_Process");
    expect(runner).not.toContain("Get-Process -ErrorAction SilentlyContinue");
    expect(runner).toContain(
      'const result = await run("powershell.exe", ["-NoProfile", "-Command", command]);',
    );
    expect(runner).not.toContain("exactAppProcesses(args.app).catch(() => [])");
  });

  it("rejects process rows whose identity properties cannot be read", async () => {
    const [runner, wrapper] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8"),
      readFile(
        join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"),
        "utf8",
      ),
    ]);

    const guestQuery = runner.indexOf("$candidates = @(Get-Process -ErrorAction Stop");
    const guestAmbiguityCheck = runner.indexOf(
      "@($candidates | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.Path) -or $null -eq $_.StartTime }).Count -ne 0",
    );
    const guestExactPathFilter = runner.indexOf(
      "$candidates | Where-Object { $_.Path -eq '",
    );
    expect(guestQuery).toBeGreaterThanOrEqual(0);
    expect(guestAmbiguityCheck).toBeGreaterThan(guestQuery);
    expect(guestExactPathFilter).toBeGreaterThan(guestAmbiguityCheck);
    expect(runner).toContain(
      "throw 'Cannot prove process identity because Path or StartTime is missing.'",
    );
    expect(runner).toContain("@{n='startedAt';e={$_.StartTime.ToUniversalTime().ToString('o')}}");
    expect(runner).toContain("startedAt === processToKill.startedAt");
    expect(runner).toContain("startedAt === lastVerifiedAppProcess.startedAt");

    const hostHelper = wrapper.indexOf("function Get-ExactSandboxSessions");
    const hostQuery = wrapper.indexOf(
      "Get-CimInstance Win32_Process -ErrorAction Stop -Filter \"Name = 'WindowsSandboxRemoteSession.exe'\"",
      hostHelper,
    );
    const hostAmbiguityCheck = wrapper.indexOf(
      "[string]::IsNullOrWhiteSpace([string]$_.CommandLine)",
      hostQuery,
    );
    const hostCommandLineSplit = wrapper.indexOf(
      "[ScadMill.NativeCommandLine]::Split([string]$_.CommandLine)",
      hostAmbiguityCheck,
    );
    const hostExactConfigFilter = wrapper.indexOf(
      "[string]::Equals($_, $ConfigPath, [StringComparison]::OrdinalIgnoreCase)",
      hostCommandLineSplit,
    );
    expect(hostHelper).toBeGreaterThanOrEqual(0);
    expect(hostQuery).toBeGreaterThan(hostHelper);
    expect(hostAmbiguityCheck).toBeGreaterThan(hostQuery);
    expect(hostCommandLineSplit).toBeGreaterThan(hostAmbiguityCheck);
    expect(hostExactConfigFilter).toBeGreaterThan(hostCommandLineSplit);
    expect(wrapper).toContain(
      'throw "Cannot prove Windows Sandbox session identity because a CommandLine is missing."',
    );
    expect(wrapper).toContain("function Wait-ExactSandboxSession");
    expect(wrapper).toContain("function Get-CapturedSandboxSession");
    expect(wrapper).toContain(
      "$sessionIdentity = Wait-ExactSandboxSession -ConfigPath $configPath",
    );
    expect(wrapper).toContain("Get-CapturedSandboxSession -Identity $sessionIdentity");
    expect(wrapper.match(/Get-ExactSandboxSessions -ConfigPath \$ConfigPath/gu)).toHaveLength(1);
    const capturedHelper = wrapper.slice(
      wrapper.indexOf("function Get-CapturedSandboxSession"),
      wrapper.indexOf("if ($TimeoutSeconds -lt 60)"),
    );
    expect(capturedHelper.match(/return @\(\)/gu)).toHaveLength(2);
    expect(capturedHelper).not.toContain("identity changed before cleanup");
    expect(wrapper).not.toContain('-like "*$configPath*"');
    expect(wrapper).not.toContain(".CommandLine.IndexOf($ConfigPath");
  });

  it("requires an exact isolated-Sandbox harness manifest", () => {
    const sha256 = "ab".repeat(32);
    const manifest = {
      schemaVersion: 1,
      files: {
        config: { path: "scadmill-packaged-evidence.wsb", sha256 },
        credentialProbe: { path: "scripts/credential-probe.ps1", sha256 },
        helper: { path: "scripts/lib/packaged-desktop-evidence.mjs", sha256 },
        runner: { path: "scripts/run-packaged-desktop-evidence.mjs", sha256 },
        sandboxBootstrap: { path: "scripts/run-packaged-desktop-sandbox.ps1", sha256 },
        sourceMetadata: { path: "scripts/source-metadata.json", sha256 },
      },
      policy: {
        networking: "Disable",
        clipboardRedirection: "Disable",
        audioInput: "Disable",
        videoInput: "Disable",
        printerRedirection: "Disable",
        inputMappingsReadOnly: true,
        outputMappingReadOnly: false,
      },
    };
    expect(validateHarnessManifest(manifest)).toEqual(manifest);
    expect(() => validateHarnessManifest({
      ...manifest,
      policy: { ...manifest.policy, networking: "Enable" },
    })).toThrow("isolation policy");
  });

  it("checks the retained Sandbox config instead of trusting policy labels", () => {
    const config = `<Configuration>
      <Networking>Disable</Networking><AudioInput>Disable</AudioInput>
      <VideoInput>Disable</VideoInput><PrinterRedirection>Disable</PrinterRedirection>
      <ClipboardRedirection>Disable</ClipboardRedirection>
      <MappedFolders>
        <MappedFolder><SandboxFolder>C:\\ScadMillEvidence</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
        <MappedFolder><SandboxFolder>C:\\ScadMillEngine</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
        <MappedFolder><SandboxFolder>C:\\ScadMillWebView</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
        <MappedFolder><SandboxFolder>C:\\ScadMillEvidenceOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
      </MappedFolders>
      <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\ScadMillEvidence\\scripts\\run-packaged-desktop-sandbox.ps1</Command></LogonCommand>
    </Configuration>`;
    expect(validateSandboxConfig(config)).toMatchObject({ networking: "Disable" });
    expect(() => validateSandboxConfig(config.replace(
      "<Networking>Disable</Networking>",
      "<Networking>Enable</Networking>",
    ))).toThrow("Networking");
    expect(() => validateSandboxConfig(config.replace(
      "<Networking>Disable</Networking>",
      "<!-- <Networking>Disable</Networking> --><Networking>Enable</Networking>",
    ))).toThrow("comments");
  });

  it("treats a signal-terminated driver as exited without fabricating an exit code", () => {
    expect(processHasExited(null, null)).toBe(false);
    expect(processHasExited(0, null)).toBe(true);
    expect(processHasExited(null, "SIGTERM")).toBe(true);
  });
});
