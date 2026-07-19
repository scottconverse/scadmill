export interface N2SoakConfiguration {
  schemaVersion: 1;
  mode: "literal" | "accelerated";
  releaseEvidenceEligible: boolean;
  evidenceLabel: string;
  durationSeconds: number;
  cadenceMilliseconds: number;
  warmupSeconds: number;
  baselineStartSeconds: number;
  baselineEndSeconds: number;
  crashAtSeconds: number;
  minimumSuccessfulCycles: number;
  memorySampleIntervalSeconds: number;
  rollingWindowSamples: number;
  finalWindowSamples: number;
  thresholdRatio: 1.5;
}

export interface N2DisabledConfiguration {
  schemaVersion: 1;
  mode: "disabled";
  releaseEvidenceEligible: false;
  evidenceLabel: "DISABLED";
}

export interface N2ProcessMemoryRow {
  pid: number;
  path: string;
  startedAt: string;
  privateBytes: number;
  workingSetBytes: number;
}

export interface N2ContinuityState {
  attempted: number;
  successful: number;
  unexpectedFailures: number;
  firstStartedAtMs: number;
  lastCompletedAtMs: number;
  maximumStartGapMs: number;
  previousStartedAtMs: number;
}

export const N2_LITERAL_CONFIGURATION: Readonly<N2SoakConfiguration>;
export const N2_DISABLED_CONFIGURATION: Readonly<N2DisabledConfiguration>;
export function validateN2SoakConfiguration(payload: unknown): N2SoakConfiguration | N2DisabledConfiguration;
export function isLiteralN2ReleaseEvidence(payload: unknown): boolean;
export function summarizeN2Memory(
  samples: readonly { elapsedSeconds: number; privateBytes: number; workingSetBytes: number }[],
  configuration: N2SoakConfiguration,
): {
  metric: "aggregate-private-bytes";
  sampleCount: number;
  firstElapsedSeconds: number;
  lastElapsedSeconds: number;
  maximumGapSeconds: number;
  baselineSampleCount: number;
  baselineFirstElapsedSeconds: number;
  baselineLastElapsedSeconds: number;
  baselineBytes: number;
  thresholdBytes: number;
  finalMedianBytes: number;
  rollingMedianMaxBytes: number;
  rawMaxBytes: number;
  finalRatio: number;
  memoryGrowthPassed: boolean;
};
export function aggregateN2ProcessMemory(input: {
  applicationProcesses: readonly N2ProcessMemoryRow[];
  webViewProcesses: readonly N2ProcessMemoryRow[];
  expectedGuiIdentity: Pick<N2ProcessMemoryRow, "pid" | "path" | "startedAt">;
}): {
  privateBytes: number;
  workingSetBytes: number;
  applicationProcessCount: number;
  webViewProcessCount: number;
  application: N2ProcessMemoryRow[];
  webView: N2ProcessMemoryRow[];
};
export function advanceN2Continuity(
  state: N2ContinuityState | undefined,
  cycle: { sequence: number; startedAtMs: number; completedAtMs: number; passed: boolean },
): N2ContinuityState;
export function appendN2JsonLine(
  path: string,
  payload: unknown,
  options?: { maximumLineBytes?: number; maximumFileBytes?: number },
): Promise<{ lineBytes: number; fileBytes: number }>;
export function validateN2SoakSummary(
  payload: unknown,
  options?: { requireReleaseEvidence?: boolean },
): unknown;
