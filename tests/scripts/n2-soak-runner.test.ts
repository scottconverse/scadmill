import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runN2Soak } from "../../scripts/lib/n2-soak-runner.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("N-2 packaged soak runner", () => {
  it("runs sequential cache-miss edits, kills one verified engine, recovers, and restores the source", async () => {
    const output = await mkdtemp(join(tmpdir(), "scadmill-n2-runner-"));
    roots.push(output);
    let now = 0;
    let source = "cube([10, 10, 10]);";
    let engineActive = false;
    let failureVisible = false;
    let concurrentRenders = 0;
    let maximumConcurrentRenders = 0;
    let consoleRunCount = 2;
    let restoredSourceRendered = false;
    let previewStarts = 0;
    let fullStarts = 0;
    const gui = {
      pid: 10,
      path: "C:\\ScadMillRun\\app\\scadmill.exe",
      startedAt: "2026-07-19T04:00:00.000Z",
      privateBytes: 100,
      workingSetBytes: 80,
    };
    const webView = {
      pid: 20,
      path: "C:\\ScadMillRun\\webview\\msedgewebview2.exe",
      startedAt: "2026-07-19T04:00:01.000Z",
      privateBytes: 200,
      workingSetBytes: 150,
    };
    const engine = {
      pid: 30,
      path: "C:\\ScadMillRun\\engine\\openscad.exe",
      startedAt: "2026-07-19T04:00:02.000Z",
      privateBytes: 50,
      workingSetBytes: 40,
    };
    const configuration = {
      schemaVersion: 1,
      mode: "accelerated",
      releaseEvidenceEligible: false,
      evidenceLabel: "ACCELERATED-NON-RELEASE",
      durationSeconds: 8,
      cadenceMilliseconds: 1_000,
      warmupSeconds: 1,
      baselineStartSeconds: 1,
      baselineEndSeconds: 2,
      crashAtSeconds: 4,
      minimumSuccessfulCycles: 5,
      memorySampleIntervalSeconds: 1,
      rollingWindowSamples: 2,
      finalWindowSamples: 2,
      thresholdRatio: 1.5,
    } as const;

    const summary = await runN2Soak({
      configuration,
      output,
      paths: { application: gui.path, engine: engine.path, webView: webView.path },
      hashes: { application: "aa".repeat(32), engine: "bb".repeat(32), webView: "cc".repeat(32) },
      guiIdentity: { pid: gui.pid, path: gui.path, startedAt: gui.startedAt },
      restoreSource: "cube([10, 10, 10]);",
      restoreBoundsText: "10 × 10 × 10 mm",
      automation: {
        now: () => now,
        delay: async (milliseconds: number) => { now += milliseconds; },
        replaceEditorSource: async (next: string) => { source = next; },
        readEditorSource: async () => source,
        ensureConsoleVisible: async () => undefined,
        consoleRunSnapshot: async () => ({ count: consoleRunCount }),
        startPreview: async () => {
          previewStarts += 1;
          concurrentRenders += 1;
          maximumConcurrentRenders = Math.max(maximumConcurrentRenders, concurrentRenders);
          consoleRunCount += 1;
        },
        startCrashRender: async () => {
          fullStarts += 1;
          concurrentRenders += 1;
          maximumConcurrentRenders = Math.max(maximumConcurrentRenders, concurrentRenders);
          consoleRunCount += 1;
          expect(source).toContain("$fn=400; minkowski() { sphere(10); cube([20,20,20], center=true); }");
          expect(source).toContain("N2-ENGINE-CRASH");
          engineActive = true;
        },
        waitForRenderSuccess: async (bounds: string, prior: { count: number }) => {
          expect(consoleRunCount).toBe(prior.count + 1);
          if (source === "cube([10, 10, 10]);") {
            expect(bounds).toBe("10 × 10 × 10 mm");
            restoredSourceRendered = true;
          }
          failureVisible = false;
          concurrentRenders -= 1;
          return { count: consoleRunCount, label: "Untitled preview exit 0" };
        },
        waitForRenderFailure: async (prior: { count: number }) => {
          expect(consoleRunCount).toBe(prior.count + 1);
          failureVisible = true;
          concurrentRenders -= 1;
          return {
            consoleRun: { count: consoleRunCount, label: "Untitled · full · 0.1 s · engine error" },
            status: { text: "Render failed for Untitled" },
            viewerBadge: {
              text: "Render failed; last successful model shown",
              ariaLabel: "Show render error in console",
            },
          };
        },
        visibleAlerts: async () => failureVisible ? ["Render failed after the engine exited."] : [],
        exactExecutableProcesses: async (path: string) => {
          if (path === gui.path) return [gui];
          if (path === webView.path) return [webView];
          if (path === engine.path) return engineActive ? [engine] : [];
          return [];
        },
        fileSha256: async (path: string) => path === engine.path ? "BB".repeat(32) : "AA".repeat(32),
        killProcess: (pid: number) => {
          expect(pid).toBe(engine.pid);
          engineActive = false;
        },
        waitFor: async (probe: () => unknown | Promise<unknown>) => {
          const result = await probe();
          if (!result) throw new Error("fake wait probe did not pass");
          return result;
        },
      },
    });
    if (!summary) throw new Error("Accelerated N-2 runner unexpectedly returned no summary.");

    expect(summary).toMatchObject({
      schemaVersion: 1,
      status: "passed",
      configuration: { mode: "accelerated", releaseEvidenceEligible: false },
      cycles: { expectedCrashFailures: 1, unexpectedFailures: 0 },
      continuity: { overlappingRequests: 0 },
      crashProbe: {
        attempted: true,
        engineKilled: true,
        guiIdentityPreserved: true,
        engineCleared: true,
        recoveryCyclePassed: true,
      },
      memory: { memoryGrowthPassed: true },
    });
    expect(summary.cycles.successful).toBeGreaterThanOrEqual(5);
    expect(consoleRunCount).toBe(2 + summary.cycles.attempted + 1);
    expect(fullStarts).toBe(1);
    expect(previewStarts).toBe(summary.cycles.successful + 1);
    expect(maximumConcurrentRenders).toBe(1);
    expect(source).toBe("cube([10, 10, 10]);");
    expect(restoredSourceRendered).toBe(true);
    const samples = (await readFile(join(output, "n2-soak-samples.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(samples.some((entry) => entry.kind === "expected-engine-crash")).toBe(true);
    expect(samples.filter((entry) => entry.kind === "cycle")).toHaveLength(summary.cycles.successful);
    const memorySamples = samples.filter((entry) => entry.kind === "memory-sample");
    expect(memorySamples).toHaveLength(summary.memory.sampleCount);
    expect(memorySamples[0]).toMatchObject({
      privateBytes: 300,
      workingSetBytes: 230,
      application: [{ pid: gui.pid, path: gui.path, privateBytes: gui.privateBytes }],
      webView: [{ pid: webView.pid, path: webView.path, privateBytes: webView.privateBytes }],
    });
    expect(summary.samples).toMatchObject({
      recordCount: samples.length,
      memorySampleCount: memorySamples.length,
    });
  });

  it("wires the disabled-by-default phase through the retained Sandbox harness", async () => {
    const [host, bootstrap, runner, verifier, helper] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"), "utf8"),
      readFile(join(process.cwd(), "scripts", "windows", "run-packaged-desktop-sandbox.ps1"), "utf8"),
      readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "lib", "n2-soak-verifier.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "lib", "packaged-desktop-evidence.mjs"), "utf8"),
    ]);

    expect(host).toContain('[ValidateSet("disabled", "literal", "accelerated")]');
    expect(host).toContain('[string] $N2SoakMode = "disabled"');
    expect(host).toContain('evidenceLabel = "N-2-LITERAL-1-HOUR"');
    expect(host).toContain("durationSeconds = 3600");
    expect(host).toContain("cadenceMilliseconds = 30000");
    expect(host).toContain("warmupSeconds = 300");
    expect(host).toContain("baselineStartSeconds = 300");
    expect(host).toContain("baselineEndSeconds = 900");
    expect(host).toContain("crashAtSeconds = 1800");
    const literalHost = host.slice(host.indexOf('"literal" {'), host.indexOf('"accelerated" {'));
    const acceleratedHost = host.slice(host.indexOf('"accelerated" {'), host.indexOf("$canonicalApplication"));
    expect(literalHost).toContain("minimumSuccessfulCycles = 113");
    expect(literalHost).toContain("memorySampleIntervalSeconds = 60");
    expect(acceleratedHost).toContain("minimumSuccessfulCycles = 8");
    expect(acceleratedHost).toContain("$baselineEnd = [Math]::Max($warmup + 1, [Math]::Floor($N2AcceleratedDurationSeconds / 3))");
    expect(acceleratedHost).toContain("memorySampleIntervalSeconds = $warmup");
    expect(host).toContain("rollingWindowSamples = 5");
    expect(host).toContain("finalWindowSamples = 10");
    expect(host).toContain("thresholdRatio = 1.5");
    expect(host).toContain("if ($TimeoutSeconds -lt 4800)");
    expect(host).toContain("TimeoutSeconds of at least 4800");
    expect(host).toContain('evidenceLabel = "ACCELERATED-NON-RELEASE"');
    expect(host).toContain("releaseEvidenceEligible = $false");
    expect(host).toContain('Copy-Item -LiteralPath (Join-Path $repo "scripts\\lib\\n2-soak-evidence.mjs")');
    expect(host).toContain('Copy-Item -LiteralPath (Join-Path $repo "scripts\\lib\\n2-soak-runner.mjs")');
    expect(host).toContain('Copy-Item -LiteralPath (Join-Path $repo "scripts\\lib\\n2-soak-verifier.mjs")');
    expect(host).toContain('"host-n2-verification.json"');
    expect(host).toContain('"--manifest", (Join-Path $outputPath "harness-manifest.json")');
    expect(bootstrap).toContain('"--soak-config", "$local\\scripts\\n2-soak-config.json"');
    expect(runner).toContain('runN2Soak({');
    expect(runner).toContain('startCrashRender: () => clickButton(client, "Full render")');
    expect(runner).toContain('verifyN2SoakArtifacts({');
    expect(runner).toContain('record("n2-final-artifacts-verified"');
    expect(runner).toContain('"n2-literal-one-hour-soak-passed"');
    expect(runner).not.toContain('"n2-literal-eight-hour-soak-passed"');
    expect(verifier).toContain('"n2-literal-one-hour-soak-passed"');
    expect(verifier).not.toContain('"n2-literal-eight-hour-soak-passed"');
    expect(runner).toContain(".diagnostic-console .console-run");
    expect(runner).toContain(".viewer-error-badge");
    expect(runner).toContain(".status-render");
    expect(runner).toContain("visible N-2 render failure proof");
    expect(runner).toContain("snapshot.count === priorRun.count + 1");
    expect(runner).toContain("one new successful N-2 Console run");
    const mcpOff = runner.indexOf('record("mcp-toggle-off-process-inspection-passed"');
    const soak = runner.indexOf("runN2Soak({");
    const settings = runner.indexOf('setControl(client, "Search settings", "Editor")');
    const finalVerification = runner.lastIndexOf('verifyN2SoakArtifacts({');
    const guestPass = runner.indexOf('evidence.status = "passed"');
    expect(mcpOff).toBeGreaterThanOrEqual(0);
    expect(soak).toBeGreaterThan(mcpOff);
    expect(settings).toBeGreaterThan(soak);
    expect(finalVerification).toBeGreaterThan(settings);
    expect(guestPass).toBeGreaterThan(finalVerification);
    expect(runner).toContain("privateBytes");
    expect(runner).toContain("workingSetBytes");
    expect(helper).toContain('n2SoakEvidence: "scripts/lib/n2-soak-evidence.mjs"');
    expect(helper).toContain('n2SoakRunner: "scripts/lib/n2-soak-runner.mjs"');
    expect(helper).toContain('n2SoakVerifier: "scripts/lib/n2-soak-verifier.mjs"');
    expect(helper).toContain('n2SoakConfiguration: "scripts/n2-soak-config.json"');
  });
});
