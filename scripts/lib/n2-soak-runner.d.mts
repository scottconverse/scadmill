import type {
  N2DisabledConfiguration,
  N2ProcessMemoryRow,
  N2SoakConfiguration,
} from "./n2-soak-evidence.mjs";

interface N2Automation {
  now(): number;
  delay(milliseconds: number): Promise<void>;
  replaceEditorSource(source: string): Promise<void>;
  readEditorSource(): Promise<string | null>;
  ensureConsoleVisible(): Promise<unknown>;
  consoleRunSnapshot(): Promise<{ count: number }>;
  startPreview(): Promise<unknown>;
  waitForRenderSuccess(boundsText: string, priorRun: { count: number }): Promise<unknown>;
  waitForRenderFailure(priorRun: { count: number }): Promise<unknown[]>;
  visibleAlerts(): Promise<unknown[]>;
  exactExecutableProcesses(path: string): Promise<N2ProcessMemoryRow[]>;
  fileSha256(path: string): Promise<string>;
  killProcess(pid: number): void;
  waitFor(
    probe: () => unknown | Promise<unknown>,
    label?: string,
    timeoutMs?: number,
    intervalMs?: number,
  ): Promise<unknown>;
}

export interface N2SoakSummary {
  schemaVersion: 1;
  status: "passed";
  configuration: N2SoakConfiguration;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  cycles: {
    attempted: number;
    successful: number;
    expectedCrashFailures: 1;
    unexpectedFailures: number;
  };
  continuity: {
    firstStartedAt: string;
    lastCompletedAt: string;
    maximumStartGapMs: number;
    overlappingRequests: 0;
  };
  memory: {
    memoryGrowthPassed: boolean;
    finalRatio: number;
    sampleCount: number;
    firstElapsedSeconds: number;
    lastElapsedSeconds: number;
    maximumGapSeconds: number;
    baselineSampleCount: number;
    baselineFirstElapsedSeconds: number;
    baselineLastElapsedSeconds: number;
  };
  crashProbe: {
    attempted: true;
    engineKilled: true;
    guiIdentityPreserved: true;
    engineCleared: true;
    recoveryCyclePassed: boolean;
  };
  orphans: {
    passed: boolean;
    engineProcesses: N2ProcessMemoryRow[];
    guiIdentityPreserved: boolean;
    guiIdentity: Pick<N2ProcessMemoryRow, "pid" | "path" | "startedAt">;
  };
  samples: { recordCount: number; memorySampleCount: number; sha256: string };
}

export function runN2Soak(input: {
  configuration: N2SoakConfiguration | N2DisabledConfiguration;
  output: string;
  paths: { application: string; engine: string; webView: string };
  hashes: { application: string; engine: string; webView: string };
  guiIdentity: Pick<N2ProcessMemoryRow, "pid" | "path" | "startedAt">;
  restoreSource: string;
  restoreBoundsText: string;
  automation: N2Automation;
}): Promise<N2SoakSummary | null>;
