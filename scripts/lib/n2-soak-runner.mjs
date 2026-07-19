import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";

import {
  advanceN2Continuity,
  aggregateN2ProcessMemory,
  appendN2JsonLine,
  isLiteralN2ReleaseEvidence,
  summarizeN2Memory,
  validateN2SoakConfiguration,
  validateN2SoakSummary,
} from "./n2-soak-evidence.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceForCycle(sequence) {
  const size = 10 + (sequence % 10);
  return {
    size,
    source: `cube([${size}, 10, 10]); // n2-soak-${sequence}`,
    boundsText: `${size} × 10 × 10 mm`,
  };
}

function sameProcessIdentity(left, right) {
  return left?.pid === right?.pid
    && normalize(left?.path ?? "") === normalize(right?.path ?? "")
    && left?.startedAt === right?.startedAt;
}

async function requirePhaseMemory(input) {
  const { automation, paths, guiIdentity } = input;
  const [applicationProcesses, webViewProcesses] = await Promise.all([
    automation.exactExecutableProcesses(paths.application),
    automation.exactExecutableProcesses(paths.webView),
  ]);
  return aggregateN2ProcessMemory({ applicationProcesses, webViewProcesses, expectedGuiIdentity: guiIdentity });
}

async function requireEngineGone(input) {
  await input.automation.waitFor(
    async () => (await input.automation.exactExecutableProcesses(input.paths.engine)).length === 0,
    "N-2 engine process exit",
    15_000,
    50,
  );
}

async function runExpectedEngineCrash(input, samplePath, elapsedSeconds) {
  const { automation, paths, hashes, guiIdentity } = input;
  const source = "$fn=400; minkowski() { sphere(10); cube([20,20,20], center=true); } // N2-ENGINE-CRASH";
  await automation.replaceEditorSource(source);
  assert.equal(await automation.readEditorSource(), source, "N-2 crash source did not reach the editor exactly.");
  const priorRun = await automation.consoleRunSnapshot();
  await automation.startPreview();
  const engine = await automation.waitFor(async () => {
    const processes = await automation.exactExecutableProcesses(paths.engine);
    return processes.length === 1 ? processes[0] : false;
  }, "one exact N-2 engine crash target", 30_000, 10);
  assert.equal(
    (await automation.fileSha256(engine.path)).toUpperCase(),
    hashes.engine.toUpperCase(),
    "N-2 engine crash target hash mismatch.",
  );
  automation.killProcess(engine.pid);
  await requireEngineGone(input);
  const alerts = await automation.waitForRenderFailure(priorRun);
  assert.ok(Array.isArray(alerts) && alerts.length > 0, "N-2 engine crash did not surface a visible failure.");
  const memory = await requirePhaseMemory(input);
  assert.ok(sameProcessIdentity(memory.application[0], guiIdentity), "N-2 engine crash replaced the GUI process.");
  const evidence = {
    kind: "expected-engine-crash",
    elapsedSeconds,
    sourceSha256: sha256(source),
    engine: {
      pid: engine.pid,
      path: engine.path,
      startedAt: engine.startedAt,
      executableSha256: hashes.engine.toUpperCase(),
    },
    visibleAlerts: alerts,
    guiIdentityPreserved: true,
    engineCleared: true,
  };
  await appendN2JsonLine(samplePath, evidence);
  return {
    attempted: true,
    engineKilled: true,
    guiIdentityPreserved: true,
    engineCleared: true,
    recoveryCyclePassed: false,
  };
}

async function runNormalCycle(input, sequence, soakStartMs, samplePath) {
  const { automation } = input;
  const cycleStartedAtMs = automation.now();
  const model = sourceForCycle(sequence);
  await automation.replaceEditorSource(model.source);
  assert.equal(await automation.readEditorSource(), model.source, "N-2 source did not reach the editor exactly.");
  const priorRun = await automation.consoleRunSnapshot();
  await automation.startPreview();
  const completedRun = await automation.waitForRenderSuccess(model.boundsText, priorRun);
  await requireEngineGone(input);
  assert.deepEqual(await automation.visibleAlerts(), [], "N-2 cycle left a visible error.");
  const cycleCompletedAtMs = automation.now();
  const record = {
    kind: "cycle",
    sequence,
    startedAt: new Date(cycleStartedAtMs).toISOString(),
    completedAt: new Date(cycleCompletedAtMs).toISOString(),
    elapsedSeconds: (cycleCompletedAtMs - soakStartMs) / 1_000,
    durationMilliseconds: cycleCompletedAtMs - cycleStartedAtMs,
    sourceSha256: sha256(model.source),
    expectedBoundsText: model.boundsText,
    consoleRun: completedRun,
    engineProcessesAfterRender: 0,
  };
  await appendN2JsonLine(samplePath, record);
  return { cycleStartedAtMs, cycleCompletedAtMs };
}

async function restoreStableSource(input) {
  const { automation, restoreSource, restoreBoundsText } = input;
  await automation.replaceEditorSource(restoreSource);
  assert.equal(await automation.readEditorSource(), restoreSource, "N-2 did not restore the pre-soak source.");
  const priorRun = await automation.consoleRunSnapshot();
  await automation.startPreview();
  await automation.waitForRenderSuccess(restoreBoundsText, priorRun);
  await requireEngineGone(input);
  assert.deepEqual(await automation.visibleAlerts(), [], "N-2 source restoration left a visible error.");
}

export async function runN2Soak(input) {
  const configuration = validateN2SoakConfiguration(input?.configuration);
  if (configuration.mode === "disabled") return null;
  const { automation, output } = input;
  const samplePath = join(output, "n2-soak-samples.jsonl");
  const summaryPath = join(output, "n2-soak-summary.json");
  const soakStartMs = automation.now();
  const soakEndMs = soakStartMs + configuration.durationSeconds * 1_000;
  let nextScheduledStartMs = soakStartMs;
  let nextMemorySampleMs = soakStartMs + configuration.warmupSeconds * 1_000;
  let continuity;
  let crashProbe = null;
  let recoveryPending = false;
  const memorySamples = [];
  await automation.ensureConsoleVisible();

  while (automation.now() < soakEndMs) {
    const elapsedSeconds = (automation.now() - soakStartMs) / 1_000;
    if (!crashProbe && elapsedSeconds >= configuration.crashAtSeconds) {
      crashProbe = await runExpectedEngineCrash(input, samplePath, elapsedSeconds);
      recoveryPending = true;
    }
    const sequence = (continuity?.attempted ?? 0) + 1;
    const result = await runNormalCycle(input, sequence, soakStartMs, samplePath);
    continuity = advanceN2Continuity(continuity, {
      sequence,
      startedAtMs: result.cycleStartedAtMs,
      completedAtMs: result.cycleCompletedAtMs,
      passed: true,
    });
    if (recoveryPending) {
      crashProbe.recoveryCyclePassed = true;
      recoveryPending = false;
    }
    if (automation.now() >= nextMemorySampleMs) {
      const memory = await requirePhaseMemory(input);
      const sampledAtMs = automation.now();
      const elapsedSeconds = (sampledAtMs - soakStartMs) / 1_000;
      memorySamples.push({
        elapsedSeconds,
        privateBytes: memory.privateBytes,
        workingSetBytes: memory.workingSetBytes,
      });
      await appendN2JsonLine(samplePath, {
        kind: "memory-sample",
        sampledAt: new Date(sampledAtMs).toISOString(),
        elapsedSeconds,
        privateBytes: memory.privateBytes,
        workingSetBytes: memory.workingSetBytes,
        applicationProcessCount: memory.applicationProcessCount,
        webViewProcessCount: memory.webViewProcessCount,
        application: memory.application,
        webView: memory.webView,
      });
      nextMemorySampleMs += configuration.memorySampleIntervalSeconds * 1_000;
    }
    nextScheduledStartMs += configuration.cadenceMilliseconds;
    if (automation.now() < nextScheduledStartMs) {
      await automation.delay(nextScheduledStartMs - automation.now());
    }
  }

  assert.ok(crashProbe?.recoveryCyclePassed, "N-2 expected engine crash/recovery was not completed.");
  const soakCompletedMs = automation.now();
  await restoreStableSource(input);
  const memory = summarizeN2Memory(memorySamples, configuration);
  const sampleBytes = await readFile(samplePath);
  const sampleRecords = sampleBytes.toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  const memorySampleRecordCount = sampleRecords.filter(({ kind }) => kind === "memory-sample").length;
  assert.equal(memorySampleRecordCount, memory.sampleCount, "N-2 retained memory-sample count mismatch.");
  assert.equal(
    sampleRecords.length,
    continuity.attempted + 1 + memorySampleRecordCount,
    "N-2 retained JSONL record count mismatch.",
  );
  const phaseMemory = await requirePhaseMemory(input);
  const engineProcesses = await automation.exactExecutableProcesses(input.paths.engine);
  const summary = {
    schemaVersion: 1,
    status: "passed",
    configuration,
    startedAt: new Date(soakStartMs).toISOString(),
    completedAt: new Date(soakCompletedMs).toISOString(),
    durationSeconds: (soakCompletedMs - soakStartMs) / 1_000,
    cycles: {
      attempted: continuity.attempted + 1,
      successful: continuity.successful,
      expectedCrashFailures: 1,
      unexpectedFailures: continuity.unexpectedFailures,
    },
    continuity: {
      firstStartedAt: new Date(continuity.firstStartedAtMs).toISOString(),
      lastCompletedAt: new Date(continuity.lastCompletedAtMs).toISOString(),
      maximumStartGapMs: continuity.maximumStartGapMs,
      overlappingRequests: 0,
    },
    memory,
    crashProbe,
    orphans: {
      passed: engineProcesses.length === 0 && sameProcessIdentity(phaseMemory.application[0], input.guiIdentity),
      engineProcesses,
      guiIdentityPreserved: true,
      guiIdentity: {
        pid: phaseMemory.application[0].pid,
        path: phaseMemory.application[0].path,
        startedAt: phaseMemory.application[0].startedAt,
      },
    },
    samples: {
      path: "n2-soak-samples.jsonl",
      recordCount: sampleRecords.length,
      memorySampleCount: memorySampleRecordCount,
      byteLength: sampleBytes.byteLength,
      sha256: sha256(sampleBytes),
    },
  };
  validateN2SoakSummary(summary, { requireReleaseEvidence: isLiteralN2ReleaseEvidence(configuration) });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}
