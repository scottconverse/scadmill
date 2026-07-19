export interface M4AiMockPlan {
  readonly proposalSource: string;
  readonly agentSource: string;
  readonly cappedRounds: 2;
  readonly secret?: string;
}

export interface M4AiMockIdentity {
  readonly endpoint: string;
  readonly model: string;
  readonly secret: string;
}

export interface M4RawAiTranscriptRecord {
  readonly ordinal: number;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly requestBody: string;
  readonly responseBody: string;
  readonly roles: readonly ("system" | "user" | "assistant" | "tool")[];
  readonly toolNames: readonly string[];
  readonly responseToolName: string | null;
  readonly context: {
    readonly source: boolean;
    readonly diagnostics: boolean;
    readonly parameters: boolean;
    readonly screenshot: boolean;
  };
}

export interface M4SanitizedAiTranscriptRecord {
  readonly ordinal: number;
  readonly method: "POST";
  readonly path: string;
  readonly model: string;
  readonly roles: readonly ("system" | "user" | "assistant" | "tool")[];
  readonly toolNames: readonly string[];
  readonly responseToolName: string | null;
  readonly context: M4RawAiTranscriptRecord["context"];
  readonly bodySha256: string;
  readonly responseSha256: string;
  readonly authorizationPresent: true;
  readonly authorizationSha256: string;
}

export interface M4McpDefaultDenyEvidence {
  readonly error: { readonly code: -32001; readonly message: "MCP mutation denied by the current permission gate." };
  readonly writeOccurred: false;
}

export interface M4McpAllowSessionEvidence {
  readonly protocolVersion: "2025-11-25";
  readonly toolNames: readonly string[];
  readonly preview: { readonly kind: "3d"; readonly triangles: 12 };
  readonly diagnostics: { readonly quality: "preview"; readonly count: number };
  readonly pendingReview: { readonly status: "pending_review" };
  readonly mutationApproved: true;
}

export interface M4RestartEvidence {
  readonly beforePid: number;
  readonly afterPid: number;
  readonly freshWebViewProcesses: true;
}

export interface M4PackagedAutomation {
  readSource(): Promise<string>;
  replaceSource(source: string): Promise<void>;
  waitForSource(source: string): Promise<unknown>;
  clickAria(label: string): Promise<void>;
  clickButton(label: string): Promise<void>;
  setControl(label: string, value: string): Promise<void>;
  setChecked(label: string, checked: boolean): Promise<void>;
  waitForText(text: string): Promise<unknown>;
  execute(script: string, args?: readonly unknown[]): Promise<unknown>;
  executeAsync(script: string, args?: readonly unknown[]): Promise<unknown>;
  captureScreenshot(name: string): Promise<Uint8Array>;
  startAiMock(plan: M4AiMockPlan): Promise<M4AiMockIdentity>;
  stopAiMock(): Promise<readonly M4RawAiTranscriptRecord[]>;
  probeMcpDefaultDeny(): Promise<M4McpDefaultDenyEvidence>;
  runMcpAllowSessionJourney(): Promise<M4McpAllowSessionEvidence>;
  restartApplication(expectedSource: string): Promise<M4RestartEvidence>;
}

export interface M4PackagedWalkthroughOptions {
  readonly automation: M4PackagedAutomation;
  readonly initialSource: string;
  readonly proposalSource: string;
  readonly agentSource: string;
  readonly projectPath: string;
  readonly cachePaintLimitMs?: number;
}

export interface M4PackagedWalkthroughEvidence {
  readonly schemaVersion: 1;
  readonly status: "passed";
  readonly order: readonly [
    "c10-unconfigured",
    "c10-proposal",
    "c10-agent",
    "c10-agent-cap",
    "c11-default-deny",
    "c11-allow-session",
    "cache",
    "delta",
    "animation",
    "thumbnail",
    "restart",
    "source-restored",
  ];
  readonly ai: {
    readonly unconfiguredRequestCount: 0;
    readonly unconfiguredNetworkAttempts: 0;
    readonly requestCount: 7;
    readonly proposalAccepted: true;
    readonly agentStatus: "completed";
    readonly capStatus: "capped";
    readonly capToolRounds: 2;
    readonly selectedResponseToolSequence: readonly [
      null,
      "render_preview",
      "get_diagnostics",
      "write_file",
      null,
      "render_preview",
      "render_preview",
    ];
    readonly contextPatterns: readonly M4RawAiTranscriptRecord["context"][];
    readonly semanticTranscript: {
      readonly contextSourceSha256: string;
      readonly contextScreenshotSha256: string;
      readonly contextScreenshotWidth: number;
      readonly contextScreenshotHeight: number;
      readonly renderTriangles: number;
      readonly diagnosticCount: number;
      readonly agentRenderConsoleRunsAdded: 1;
    };
    readonly transcript: {
      readonly records: readonly M4SanitizedAiTranscriptRecord[];
      readonly sha256: string;
    };
  };
  readonly mcp: { readonly defaultDenyCode: -32001; readonly mutationApproved: true };
  readonly cache: {
    readonly baselineConsoleRunsAdded: 1;
    readonly elapsedMs: number;
    readonly consoleRunsAdded: 0;
    readonly coldElapsedMs: number;
    readonly restoredAfterRestart: true;
  };
  readonly delta: { readonly unchanged: true; readonly volumeDeltaMm3: 200; readonly boundsDeltaMm: readonly [2, 0, 0] };
  readonly animation: {
    readonly frame: 51;
    readonly time: 0.5;
    readonly fps: 24;
    readonly scrubConsoleRunsAdded: 1;
    readonly playConsoleRunsAdded: number;
    readonly serialized: true;
  };
  readonly thumbnails: {
    readonly documentPath: string;
    readonly renderIdentity: string;
    readonly pngSha256: string;
    readonly byteLength: number;
    readonly width: 240;
    readonly height: 160;
    readonly persistedAcrossRestart: true;
  };
  readonly restart: M4RestartEvidence;
  readonly screenshots: readonly { readonly name: string; readonly sha256: string; readonly byteLength: number }[];
  readonly source: {
    readonly initialSha256: string;
    readonly restoredSha256: string;
    readonly restoredExactly: true;
  };
}

export const M4_SELECTORS: Readonly<Record<string, string>>;
export const M4_DOM_SCRIPTS: Readonly<Record<string, string>>;

export function inspectM4Png(
  bytes: Uint8Array,
  label?: string,
  maximumBytes?: number,
  limits?: {
    readonly maximumWidth: number;
    readonly maximumHeight: number;
    readonly maximumDecodedBytes: number;
    readonly exactWidth?: number;
    readonly exactHeight?: number;
  },
): { readonly byteLength: number; readonly width: number; readonly height: number; readonly sha256: string };

export function validateM4ZeroNetworkAttempts(value: unknown): { readonly attemptCount: 0 };

export function validateM4RawTranscriptSemantics(
  records: readonly M4RawAiTranscriptRecord[],
  input: {
    readonly contextFixtureSource: string;
    readonly agentSource: string;
    readonly agentConsoleRunsBefore: number;
    readonly agentConsoleRunsAfter: number;
  },
): M4PackagedWalkthroughEvidence["ai"]["semanticTranscript"];

export function startScriptedM4LocalProviderMock(
  plan: M4AiMockPlan & { readonly secret: string },
): Promise<M4AiMockIdentity & {
  close(): Promise<readonly M4RawAiTranscriptRecord[]>;
}>;

export function sanitizeAiTranscript(
  records: readonly M4RawAiTranscriptRecord[],
  secret: string,
): { readonly records: readonly M4SanitizedAiTranscriptRecord[]; readonly sha256: string };

export function runM4PackagedWalkthrough(
  options: M4PackagedWalkthroughOptions,
): Promise<M4PackagedWalkthroughEvidence>;
