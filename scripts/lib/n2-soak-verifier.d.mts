export interface N2ArtifactVerification {
  schemaVersion: 1;
  status: "passed";
  mode: "disabled" | "literal" | "accelerated";
  configurationSha256: string;
  summarySha256: string | null;
  samplesSha256: string | null;
  recordCount: number;
  memorySampleCount: number;
}

export function verifyN2SoakArtifacts(input: {
  configurationPath: string;
  summaryPath: string;
  samplePath: string;
  expectedConfigurationSha256: string;
  events: readonly Record<string, unknown>[];
  requireFinalEvent?: boolean;
}): Promise<N2ArtifactVerification>;
