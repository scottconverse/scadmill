export interface M4PackagedVerificationResult {
  readonly schemaVersion: 1;
  readonly status: "passed";
  readonly walkthroughSha256: string;
  readonly screenshotCount: 8;
  readonly screenshotsSha256: string;
}

export function verifyM4PackagedArtifacts(input: {
  readonly walkthroughPath: string;
  readonly screenshotDirectory: string;
  readonly events: readonly Record<string, unknown>[];
  readonly requireFinalEvent?: boolean;
}): Promise<M4PackagedVerificationResult>;
