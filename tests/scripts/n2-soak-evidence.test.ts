import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  N2_LITERAL_CONFIGURATION,
  advanceN2Continuity,
  aggregateN2ProcessMemory,
  appendN2JsonLine,
  isLiteralN2ReleaseEvidence,
  summarizeN2Memory,
  validateN2SoakConfiguration,
  validateN2SoakSummary,
} from "../../scripts/lib/n2-soak-evidence.mjs";
import { verifyN2SoakArtifacts } from "../../scripts/lib/n2-soak-verifier.mjs";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

interface TestProcessRow {
  pid: number;
  path: string;
  startedAt: string;
  privateBytes: number;
  workingSetBytes: number;
}

interface TestMemoryRecord {
  kind: "memory-sample";
  sampledAt: string;
  elapsedSeconds: number;
  privateBytes: number;
  workingSetBytes: number;
  applicationProcessCount: number;
  webViewProcessCount: number;
  application: TestProcessRow[];
  webView: TestProcessRow[];
}

interface TestCycleRecord {
  kind: "cycle";
  sequence: number;
  startedAt: string;
  completedAt: string;
  elapsedSeconds: number;
  durationMilliseconds: number;
  sourceSha256: string;
  expectedBoundsText: string;
  consoleRun: { count: number; label: string };
  engineProcessesAfterRender: number;
}

interface TestCrashRecord {
  kind: "expected-engine-crash";
  elapsedSeconds: number;
  sourceSha256: string;
  engine: { pid: number; path: string; startedAt: string; executableSha256: string };
  visibleAlerts: string[];
  guiIdentityPreserved: boolean;
  engineCleared: boolean;
}

type TestEvidenceRecord = TestMemoryRecord | TestCycleRecord | TestCrashRecord;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function processRow(pid: number, path: string, privateBytes: number, workingSetBytes: number) {
  return { pid, path, startedAt: `2026-07-19T0${pid}:00:00.000Z`, privateBytes, workingSetBytes };
}

function acceleratedConfiguration() {
  return {
    schemaVersion: 1,
    mode: "accelerated",
    releaseEvidenceEligible: false,
    evidenceLabel: "ACCELERATED-NON-RELEASE",
    durationSeconds: 120,
    cadenceMilliseconds: 1_000,
    warmupSeconds: 20,
    baselineStartSeconds: 20,
    baselineEndSeconds: 40,
    crashAtSeconds: 60,
    minimumSuccessfulCycles: 90,
    memorySampleIntervalSeconds: 2,
    rollingWindowSamples: 5,
    finalWindowSamples: 5,
    thresholdRatio: 1.5,
  } as const;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function retainedAcceleratedFixture(root: string) {
  const configuration = acceleratedConfiguration();
  const memoryRows: TestMemoryRecord[] = Array.from({ length: 51 }, (_, index) => ({
    kind: "memory-sample",
    sampledAt: new Date((20 + index * 2) * 1_000).toISOString(),
    elapsedSeconds: 20 + index * 2,
    privateBytes: 300,
    workingSetBytes: 230,
    applicationProcessCount: 1,
    webViewProcessCount: 1,
    application: [processRow(1, "C:\\app\\scadmill.exe", 100, 80)],
    webView: [processRow(2, "C:\\webview\\msedgewebview2.exe", 200, 150)],
  }));
  const cycles: TestCycleRecord[] = Array.from({ length: 120 }, (_, index) => {
    const sequence = index + 1;
    const size = 10 + (sequence % 10);
    const startedAtMs = index * 1_000;
    const completedAtMs = startedAtMs + 100;
    return {
      kind: "cycle",
      sequence,
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      elapsedSeconds: completedAtMs / 1_000,
      durationMilliseconds: 100,
      sourceSha256: sha256(`cube([${size}, 10, 10]); // n2-soak-${sequence}`),
      expectedBoundsText: `${size} × 10 × 10 mm`,
      consoleRun: { count: sequence + (sequence > 60 ? 1 : 0), label: "Untitled preview exit 0" },
      engineProcessesAfterRender: 0,
    };
  });
  const crash: TestCrashRecord = {
    kind: "expected-engine-crash",
    elapsedSeconds: 60,
    sourceSha256: sha256("$fn=400; minkowski() { sphere(10); cube([20,20,20], center=true); } // N2-ENGINE-CRASH"),
    engine: {
      pid: 30,
      path: "C:\\engine\\openscad.exe",
      startedAt: new Date(60_000).toISOString(),
      executableSha256: "de".repeat(32),
    },
    visibleAlerts: ["Render failed after the engine exited."],
    guiIdentityPreserved: true,
    engineCleared: true,
  };
  const records: TestEvidenceRecord[] = [...cycles, crash, ...memoryRows]
    .sort((left, right) => left.elapsedSeconds - right.elapsedSeconds);
  const serialized = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const memory = summarizeN2Memory(memoryRows.map(({ elapsedSeconds, privateBytes, workingSetBytes }) => ({
    elapsedSeconds,
    privateBytes,
    workingSetBytes,
  })), configuration);
  const summary = {
    schemaVersion: 1,
    status: "passed",
    configuration,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(120_000).toISOString(),
    durationSeconds: 120,
    cycles: { attempted: 121, successful: 120, expectedCrashFailures: 1, unexpectedFailures: 0 },
    continuity: {
      firstStartedAt: cycles[0].startedAt,
      lastCompletedAt: cycles.at(-1)?.completedAt,
      maximumStartGapMs: 1_000,
      overlappingRequests: 0,
    },
    memory,
    crashProbe: { attempted: true, engineKilled: true, guiIdentityPreserved: true, engineCleared: true, recoveryCyclePassed: true },
    orphans: {
      passed: true,
      engineProcesses: [] as Record<string, unknown>[],
      guiIdentityPreserved: true,
      guiIdentity: {
        pid: memoryRows[0].application[0].pid,
        path: memoryRows[0].application[0].path,
        startedAt: memoryRows[0].application[0].startedAt,
      },
    },
    samples: {
      path: "n2-soak-samples.jsonl",
      recordCount: records.length,
      memorySampleCount: memoryRows.length,
      byteLength: Buffer.byteLength(serialized),
      sha256: sha256(serialized),
    },
  };
  const configPath = join(root, "n2-soak-config.json");
  const summaryPath = join(root, "n2-soak-summary.json");
  const samplePath = join(root, "n2-soak-samples.jsonl");
  const configText = `${JSON.stringify(configuration)}\n`;
  const summaryText = `${JSON.stringify(summary)}\n`;
  await Promise.all([
    writeFile(configPath, configText),
    writeFile(summaryPath, summaryText),
    writeFile(samplePath, serialized),
  ]);
  const events: Record<string, unknown>[] = [{
    name: "artifacts-verified",
    app: { path: "C:\\app\\scadmill.exe", sha256: "aa".repeat(32) },
    source: { applicationSha256: "aa".repeat(32) },
    engine: { path: crash.engine.path, sha256: crash.engine.executableSha256 },
    webView: { path: "C:\\webview", executableSha256: "bb".repeat(32) },
  }, {
    name: "n2-accelerated-non-release-soak-passed",
    releaseEvidenceEligible: false,
    evidenceLabel: configuration.evidenceLabel,
    durationSeconds: summary.durationSeconds,
    successfulCycles: summary.cycles.successful,
    finalMemoryRatio: summary.memory.finalRatio,
    summarySha256: sha256(summaryText),
    samplesSha256: summary.samples.sha256,
  }];
  return { configuration, records, summary, configPath, summaryPath, samplePath, configText, summaryText, serialized, events };
}

async function rebindRetainedRecords(fixture: Awaited<ReturnType<typeof retainedAcceleratedFixture>>) {
  fixture.serialized = `${fixture.records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  fixture.summary.samples.byteLength = Buffer.byteLength(fixture.serialized);
  fixture.summary.samples.recordCount = fixture.records.length;
  fixture.summary.samples.memorySampleCount = fixture.records.filter(({ kind }) => kind === "memory-sample").length;
  fixture.summary.samples.sha256 = sha256(fixture.serialized);
  fixture.summaryText = `${JSON.stringify(fixture.summary)}\n`;
  const soakEvent = fixture.events.find(({ name }) => name === "n2-accelerated-non-release-soak-passed");
  if (!soakEvent) throw new Error("Synthetic soak event is missing.");
  soakEvent.summarySha256 = sha256(fixture.summaryText);
  soakEvent.samplesSha256 = fixture.summary.samples.sha256;
  soakEvent.successfulCycles = fixture.summary.cycles.successful;
  await Promise.all([
    writeFile(fixture.summaryPath, fixture.summaryText),
    writeFile(fixture.samplePath, fixture.serialized),
  ]);
}

describe("N-2 soak evidence", () => {
  it("recognizes only the immutable literal eight-hour configuration as release evidence", () => {
    expect(validateN2SoakConfiguration(N2_LITERAL_CONFIGURATION)).toEqual(N2_LITERAL_CONFIGURATION);
    expect(isLiteralN2ReleaseEvidence(N2_LITERAL_CONFIGURATION)).toBe(true);
    expect(isLiteralN2ReleaseEvidence(acceleratedConfiguration())).toBe(false);
    expect(() => validateN2SoakConfiguration({
      ...N2_LITERAL_CONFIGURATION,
      durationSeconds: 60,
    })).toThrow("literal eight-hour");
    expect(() => validateN2SoakConfiguration({
      ...acceleratedConfiguration(),
      releaseEvidenceEligible: true,
    })).toThrow("non-release");
    expect(() => validateN2SoakConfiguration({
      ...acceleratedConfiguration(),
      durationSeconds: 3_600,
      cadenceMilliseconds: 10,
    })).toThrow("Console capacity");
  });

  it("aggregates exact candidate process memory and rejects identity ambiguity", () => {
    const gui = processRow(1, "C:\\ScadMillRun\\app\\scadmill.exe", 100, 80);
    const webView = processRow(2, "C:\\ScadMillRun\\webview\\msedgewebview2.exe", 200, 150);
    expect(aggregateN2ProcessMemory({
      applicationProcesses: [gui],
      webViewProcesses: [webView],
      expectedGuiIdentity: { pid: gui.pid, path: gui.path, startedAt: gui.startedAt },
    })).toEqual({
      privateBytes: 300,
      workingSetBytes: 230,
      applicationProcessCount: 1,
      webViewProcessCount: 1,
      application: [gui],
      webView: [webView],
    });
    expect(() => aggregateN2ProcessMemory({
      applicationProcesses: [gui, processRow(3, gui.path, 10, 10)],
      webViewProcesses: [webView],
      expectedGuiIdentity: { pid: gui.pid, path: gui.path, startedAt: gui.startedAt },
    })).toThrow("exactly one GUI");
    expect(() => aggregateN2ProcessMemory({
      applicationProcesses: [gui],
      webViewProcesses: [{ ...webView, pid: gui.pid }],
      expectedGuiIdentity: { pid: gui.pid, path: gui.path, startedAt: gui.startedAt },
    })).toThrow("unique");
  });

  it("uses a fixed baseline and fails sustained growth beyond 1.5 times baseline", () => {
    const config = acceleratedConfiguration();
    const samples = [20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116]
      .map((elapsedSeconds, index) => ({
        elapsedSeconds,
        privateBytes: index < 6 ? 100 : index < 15 ? 140 : 160,
        workingSetBytes: 80,
      }));
    expect(summarizeN2Memory(samples, config)).toMatchObject({
      sampleCount: 25,
      firstElapsedSeconds: 20,
      lastElapsedSeconds: 116,
      maximumGapSeconds: 4,
      baselineSampleCount: 6,
      baselineFirstElapsedSeconds: 20,
      baselineLastElapsedSeconds: 40,
      baselineBytes: 100,
      thresholdBytes: 150,
      memoryGrowthPassed: false,
      finalMedianBytes: 160,
    });
    expect(summarizeN2Memory(samples.map((sample) => ({
      ...sample,
      privateBytes: Math.min(sample.privateBytes, 149),
    })), config)).toMatchObject({
      baselineBytes: 100,
      thresholdBytes: 150,
      memoryGrowthPassed: true,
      finalMedianBytes: 149,
    });
    const oneSpike = samples.map((sample, index) => ({
      ...sample,
      privateBytes: index === 12 ? 151 : 100,
    }));
    expect(summarizeN2Memory(oneSpike, config)).toMatchObject({
      rawMaxBytes: 151,
      thresholdBytes: 150,
      memoryGrowthPassed: false,
    });
  });

  it("revalidates retained N-2 artifacts and rejects deletion, truncation, or replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-n2-retained-"));
    roots.push(root);
    const fixture = await retainedAcceleratedFixture(root);
    const input = {
      configurationPath: fixture.configPath,
      summaryPath: fixture.summaryPath,
      samplePath: fixture.samplePath,
      expectedConfigurationSha256: sha256(fixture.configText),
      events: fixture.events,
    };
    const verification = await verifyN2SoakArtifacts(input);
    expect(verification).toMatchObject({
      schemaVersion: 1,
      status: "passed",
      mode: "accelerated",
      recordCount: 172,
      memorySampleCount: 51,
    });
    await expect(verifyN2SoakArtifacts({ ...input, requireFinalEvent: true })).rejects.toThrow("final N-2");
    fixture.events.push({ name: "n2-final-artifacts-verified", ...verification });
    await expect(verifyN2SoakArtifacts({ ...input, requireFinalEvent: true })).resolves.toEqual(verification);
    const evidencePath = join(root, "evidence.json");
    const manifestPath = join(root, "harness-manifest.json");
    await Promise.all([
      writeFile(evidencePath, JSON.stringify({ status: "passed", events: fixture.events })),
      writeFile(manifestPath, JSON.stringify({
        files: { n2SoakConfiguration: { sha256: sha256(fixture.configText) } },
      })),
    ]);
    const { stdout } = await execFileAsync(process.execPath, [
      join(process.cwd(), "scripts", "lib", "n2-soak-verifier.mjs"),
      "--configuration", fixture.configPath,
      "--summary", fixture.summaryPath,
      "--samples", fixture.samplePath,
      "--evidence", evidencePath,
      "--manifest", manifestPath,
    ]);
    expect(JSON.parse(stdout)).toEqual(verification);

    await rm(fixture.summaryPath);
    await expect(verifyN2SoakArtifacts(input)).rejects.toThrow("summary");
    await writeFile(fixture.summaryPath, fixture.summaryText);
    await writeFile(fixture.samplePath, `${fixture.serialized.split("\n").slice(0, -2).join("\n")}\n`);
    await expect(verifyN2SoakArtifacts(input)).rejects.toThrow(/JSONL|hash/u);
    await writeFile(fixture.samplePath, fixture.serialized);
    await writeFile(fixture.configPath, `${JSON.stringify({ schemaVersion: 1, mode: "disabled", releaseEvidenceEligible: false, evidenceLabel: "DISABLED" })}\n`);
    await expect(verifyN2SoakArtifacts(input)).rejects.toThrow("configuration");
  });

  it("requires exactly one disabled event and rejects stray disabled artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-n2-disabled-"));
    roots.push(root);
    const configuration = { schemaVersion: 1, mode: "disabled", releaseEvidenceEligible: false, evidenceLabel: "DISABLED" } as const;
    const configurationPath = join(root, "n2-soak-config.json");
    const summaryPath = join(root, "n2-soak-summary.json");
    const samplePath = join(root, "n2-soak-samples.jsonl");
    const text = `${JSON.stringify(configuration)}\n`;
    await writeFile(configurationPath, text);
    const input = {
      configurationPath,
      summaryPath,
      samplePath,
      expectedConfigurationSha256: sha256(text),
      events: [{ name: "n2-soak-disabled", releaseEvidenceEligible: false }],
    };
    await expect(verifyN2SoakArtifacts(input)).resolves.toMatchObject({ mode: "disabled", recordCount: 0 });
    await expect(verifyN2SoakArtifacts({
      ...input,
      events: [
        { name: "n2-soak-disabled", releaseEvidenceEligible: false },
        { name: "n2-soak-disabled", releaseEvidenceEligible: false },
      ],
    })).rejects.toThrow("exactly one");
    await expect(verifyN2SoakArtifacts({
      ...input,
      events: [{ name: "n2-soak-disabled", releaseEvidenceEligible: true }],
    })).rejects.toThrow("disabled event");
    await expect(verifyN2SoakArtifacts({
      ...input,
      events: [{ name: "n2-soak-disabled", releaseEvidenceEligible: false, evidenceLabel: "DISABLED" }],
    })).rejects.toThrow("disabled event");
    await expect(verifyN2SoakArtifacts({
      ...input,
      events: [
        { name: "n2-soak-disabled", releaseEvidenceEligible: false },
        { name: "n2-accelerated-non-release-soak-passed" },
      ],
    })).rejects.toThrow("exactly one");
    await writeFile(summaryPath, "{}\n");
    await expect(verifyN2SoakArtifacts(input)).rejects.toThrow("must not retain");
  });

  it("rejects late cycle start, early cycle finish, and accelerated memory truncation", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-n2-boundaries-"));
    roots.push(root);
    let fixture = await retainedAcceleratedFixture(root);
    const verify = () => verifyN2SoakArtifacts({
      configurationPath: fixture.configPath,
      summaryPath: fixture.summaryPath,
      samplePath: fixture.samplePath,
      expectedConfigurationSha256: sha256(fixture.configText),
      events: fixture.events,
    });
    const shiftedCycles = fixture.records.filter((record) => record.kind === "cycle");
    for (const cycle of shiftedCycles) {
      if (!("startedAt" in cycle) || !("completedAt" in cycle) || !("elapsedSeconds" in cycle)) continue;
      cycle.startedAt = new Date(Date.parse(cycle.startedAt) + 2_000).toISOString();
      cycle.completedAt = new Date(Date.parse(cycle.completedAt) + 2_000).toISOString();
      cycle.elapsedSeconds += 2;
      cycle.consoleRun.count = cycle.sequence + (cycle.sequence > 58 ? 1 : 0);
    }
    fixture.records.sort((left, right) => left.elapsedSeconds - right.elapsedSeconds);
    fixture.summary.continuity.firstStartedAt = shiftedCycles[0].startedAt;
    fixture.summary.continuity.lastCompletedAt = shiftedCycles.at(-1)?.completedAt;
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("cycle boundary");

    fixture = await retainedAcceleratedFixture(root);
    fixture.records = fixture.records.filter((record) => record.kind !== "cycle" || record.sequence <= 100);
    const retainedCycles = fixture.records.filter((record) => record.kind === "cycle");
    fixture.summary.cycles = { attempted: 101, successful: 100, expectedCrashFailures: 1, unexpectedFailures: 0 };
    fixture.summary.continuity.lastCompletedAt = retainedCycles.at(-1)?.completedAt;
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("cycle boundary");

    fixture = await retainedAcceleratedFixture(root);
    fixture.records = fixture.records.filter((record) => record.kind !== "memory-sample" || record.elapsedSeconds <= 116);
    const memory = fixture.records.filter((record) => record.kind === "memory-sample")
      .map(({ elapsedSeconds, privateBytes, workingSetBytes }) => ({ elapsedSeconds, privateBytes, workingSetBytes }));
    fixture.summary.memory = summarizeN2Memory(memory, fixture.configuration);
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("memory coverage");

    fixture = await retainedAcceleratedFixture(root);
    fixture.records = fixture.records.filter((record) => (
      record.kind !== "memory-sample" || record.elapsedSeconds <= 60 || record.elapsedSeconds >= 68
    ));
    const gappedMemory = fixture.records.filter((record) => record.kind === "memory-sample")
      .map(({ elapsedSeconds, privateBytes, workingSetBytes }) => ({ elapsedSeconds, privateBytes, workingSetBytes }));
    fixture.summary.memory = summarizeN2Memory(gappedMemory, fixture.configuration);
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("memory coverage");
  });

  it("binds memory processes to artifacts and reconciles exact final orphans", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-n2-identities-"));
    roots.push(root);
    let fixture = await retainedAcceleratedFixture(root);
    const verify = () => verifyN2SoakArtifacts({
      configurationPath: fixture.configPath,
      summaryPath: fixture.summaryPath,
      samplePath: fixture.samplePath,
      expectedConfigurationSha256: sha256(fixture.configText),
      events: fixture.events,
    });
    let memoryRows = fixture.records.filter((record) => record.kind === "memory-sample");
    memoryRows[1].application[0].path = "C:\\replacement\\scadmill.exe";
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow(/GUI.*identity/u);

    fixture = await retainedAcceleratedFixture(root);
    memoryRows = fixture.records.filter((record) => record.kind === "memory-sample");
    memoryRows[1].application[0].pid = 99;
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow(/GUI.*identity/u);

    fixture = await retainedAcceleratedFixture(root);
    memoryRows = fixture.records.filter((record) => record.kind === "memory-sample");
    memoryRows[1].webView[0].path = "C:\\replacement\\msedgewebview2.exe";
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("WebView executable");

    fixture = await retainedAcceleratedFixture(root);
    fixture.summary.orphans.engineProcesses = [{ pid: 30 }];
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("orphan proof");

    fixture = await retainedAcceleratedFixture(root);
    fixture.summary.orphans.guiIdentity.pid = 99;
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("orphan proof");
  });

  it("rejects rebound JSONL with fake cycle, continuity, or crash proof", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-n2-structural-"));
    roots.push(root);
    let fixture = await retainedAcceleratedFixture(root);
    const verify = () => verifyN2SoakArtifacts({
      configurationPath: fixture.configPath,
      summaryPath: fixture.summaryPath,
      samplePath: fixture.samplePath,
      expectedConfigurationSha256: sha256(fixture.configText),
      events: fixture.events,
    });
    const firstCycle = fixture.records.find((record) => record.kind === "cycle");
    if (!firstCycle || !("consoleRun" in firstCycle)) throw new Error("Synthetic cycle is missing.");
    firstCycle.consoleRun.label = "Untitled preview running";
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("cycle proof");

    fixture = await retainedAcceleratedFixture(root);
    const secondCycle = fixture.records.filter((record) => record.kind === "cycle")[1];
    if (!("startedAt" in secondCycle) || !("completedAt" in secondCycle) || !("elapsedSeconds" in secondCycle)) {
      throw new Error("Synthetic second cycle is missing.");
    }
    secondCycle.startedAt = new Date(1_500).toISOString();
    secondCycle.completedAt = new Date(1_600).toISOString();
    secondCycle.elapsedSeconds = 1.6;
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("continuity");

    fixture = await retainedAcceleratedFixture(root);
    const firstTwoCycles = fixture.records.filter((record) => record.kind === "cycle").slice(0, 2);
    if (!("consoleRun" in firstTwoCycles[1])) throw new Error("Synthetic second Console run is missing.");
    firstTwoCycles[1].consoleRun.count += 1;
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("cycle proof");

    fixture = await retainedAcceleratedFixture(root);
    const sourceCycle = fixture.records.find((record) => record.kind === "cycle");
    if (!sourceCycle || !("sourceSha256" in sourceCycle)) throw new Error("Synthetic source cycle is missing.");
    sourceCycle.sourceSha256 = "ff".repeat(32);
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("cycle proof");

    fixture = await retainedAcceleratedFixture(root);
    const crash = fixture.records.find((record) => record.kind === "expected-engine-crash");
    if (!crash || !("engine" in crash)) throw new Error("Synthetic crash is missing.");
    crash.engine.path = "C:\\replacement\\openscad.exe";
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("crash proof");

    fixture = await retainedAcceleratedFixture(root);
    const memoryIndex = fixture.records.findIndex((record) => record.kind === "memory-sample");
    const [memoryOutOfOrder] = fixture.records.splice(memoryIndex, 1);
    fixture.records.unshift(memoryOutOfOrder);
    await rebindRetainedRecords(fixture);
    await expect(verify()).rejects.toThrow("timeline");
  });

  it("tracks sequential continuity without retaining cycle payloads", () => {
    let state = advanceN2Continuity(undefined, { sequence: 1, startedAtMs: 1_000, completedAtMs: 1_400, passed: true });
    state = advanceN2Continuity(state, { sequence: 2, startedAtMs: 2_000, completedAtMs: 2_500, passed: true });
    expect(state).toEqual({
      attempted: 2,
      successful: 2,
      unexpectedFailures: 0,
      firstStartedAtMs: 1_000,
      lastCompletedAtMs: 2_500,
      maximumStartGapMs: 1_000,
      previousStartedAtMs: 2_000,
    });
    expect(() => advanceN2Continuity(state, {
      sequence: 4,
      startedAtMs: 3_000,
      completedAtMs: 3_500,
      passed: true,
    })).toThrow("sequential");
  });

  it("appends bounded JSONL and fails closed before exceeding its file budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-n2-"));
    roots.push(root);
    const path = join(root, "samples.jsonl");
    await appendN2JsonLine(path, { sequence: 1, sourceSha256: "ab".repeat(32) }, {
      maximumLineBytes: 256,
      maximumFileBytes: 300,
    });
    expect((await readFile(path, "utf8")).trim()).toBe(JSON.stringify({
      sequence: 1,
      sourceSha256: "ab".repeat(32),
    }));
    await expect(appendN2JsonLine(path, { payload: "x".repeat(256) }, {
      maximumLineBytes: 128,
      maximumFileBytes: 300,
    })).rejects.toThrow("line budget");
    await expect(appendN2JsonLine(path, { payload: "y".repeat(150) }, {
      maximumLineBytes: 256,
      maximumFileBytes: 180,
    })).rejects.toThrow("file budget");
  });

  it("rejects accelerated or short summaries as literal N-2 release evidence", () => {
    const literal = {
      schemaVersion: 1,
      status: "passed",
      configuration: N2_LITERAL_CONFIGURATION,
      durationSeconds: 28_800,
      cycles: { attempted: 960, successful: 959, expectedCrashFailures: 1, unexpectedFailures: 0 },
      continuity: { maximumStartGapMs: 60_000, overlappingRequests: 0 },
      memory: {
        memoryGrowthPassed: true,
        sampleCount: 461,
        firstElapsedSeconds: 1_200,
        lastElapsedSeconds: 28_800,
        maximumGapSeconds: 60,
        baselineSampleCount: 11,
        baselineFirstElapsedSeconds: 1_200,
        baselineLastElapsedSeconds: 1_800,
        baselineBytes: 100,
        thresholdBytes: 150,
        finalMedianBytes: 120,
      },
      crashProbe: { attempted: true, engineKilled: true, guiIdentityPreserved: true, engineCleared: true, recoveryCyclePassed: true },
      orphans: { passed: true },
      samples: { recordCount: 1_421, memorySampleCount: 461, sha256: "ab".repeat(32) },
    };
    expect(validateN2SoakSummary(literal, { requireReleaseEvidence: true })).toEqual(literal);
    expect(() => validateN2SoakSummary({
      ...literal,
      configuration: acceleratedConfiguration(),
      durationSeconds: 120,
    }, { requireReleaseEvidence: true })).toThrow("literal N-2 release evidence");
    expect(() => validateN2SoakSummary({
      ...literal,
      durationSeconds: 28_799,
    }, { requireReleaseEvidence: true })).toThrow("eight continuous hours");
    expect(() => validateN2SoakSummary({
      ...literal,
      memory: {
        ...literal.memory,
        sampleCount: 12,
        lastElapsedSeconds: 1_860,
      },
      samples: { ...literal.samples, recordCount: 972, memorySampleCount: 12 },
    }, { requireReleaseEvidence: true })).toThrow("memory coverage");
    expect(() => validateN2SoakSummary({
      ...literal,
      memory: { ...literal.memory, maximumGapSeconds: 120 },
    }, { requireReleaseEvidence: true })).toThrow("memory coverage");
    expect(() => validateN2SoakSummary({
      ...literal,
      configuration: acceleratedConfiguration(),
      durationSeconds: 119,
    })).toThrow("declared duration");
    expect(() => validateN2SoakSummary({
      ...literal,
      configuration: acceleratedConfiguration(),
      durationSeconds: Number.NaN,
    })).toThrow("declared duration");
  });
});
