export interface StlEvidence {
  triangleCount: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
}

export interface CredentialProbe {
  target: string;
  found: boolean;
  lastError: number;
}

export interface McpEndpointManifest {
  version: 1;
  address: "127.0.0.1";
  port: number;
  token: string;
  pid: number;
  process_start_id: string;
}

export interface SanitizedMcpEndpointManifest {
  version: 1;
  address: "127.0.0.1";
  port: number;
  pid: number;
  processIdentityBound: true;
}

export interface McpListenerObservation {
  address: "127.0.0.1";
  port: number;
  pid: number;
}

export function mcpEndpointManifestPath(
  executablePath: string,
  temporaryDirectory: string,
): string;

export function validateMcpEndpointManifest(
  payload: unknown,
  expectedGuiPid: number,
): McpEndpointManifest;
export function validateMcpListenerObservation(
  payload: unknown,
  expectedEnabled: boolean,
  expectedEndpoint?: unknown,
): McpListenerObservation[];
export function parseWindowsNetstatTcpListeners(output: unknown): McpListenerObservation[];
export function sanitizeMcpEndpointManifest(
  manifest: unknown,
): SanitizedMcpEndpointManifest;
export function sanitizeMcpTranscript(payload: unknown, token: string): unknown;

export function parseBinaryStl(bytes: Uint8Array): StlEvidence;
export function webViewAutomationArgument(): "--edge-webview-switches=--remote-debugging-port=0";
export function processHasExited(exitCode: number | null, signalCode: NodeJS.Signals | null): boolean;
export interface PackagedWorkspaceLayoutObservation {
  dockWidth: number;
  storageKey: string;
  workspaceIdentity: string;
  serializedLayout: string;
}
export function validatePackagedWorkspaceLayoutObservation(
  payload: unknown,
  expectedDockWidth: number,
): PackagedWorkspaceLayoutObservation;
export interface PackagedWorkspaceLayoutProcessObservation {
  applicationPid: number;
  webViewPids: readonly number[];
  layout: PackagedWorkspaceLayoutObservation;
}
export interface PackagedWorkspaceLayoutRestartEvidence {
  freshApplicationProcess: true;
  freshWebViewProcesses: true;
  exactLayoutRestored: true;
}
export function validatePackagedWorkspaceLayoutRestart(
  before: PackagedWorkspaceLayoutProcessObservation,
  after: PackagedWorkspaceLayoutProcessObservation,
): PackagedWorkspaceLayoutRestartEvidence;
export interface SourceMetadata {
  schemaVersion: 1;
  sourceCommit: string;
  sourceTree: string;
  branch: string;
  canonicalApplication: "src/desktop-shell/src-tauri/target/release/scadmill.exe";
  applicationSha256: string;
  worktree: {
    cleanBeforeBuild: true;
    cleanAfterBuild: true;
  };
  lockfiles: {
    pnpm: { path: "pnpm-lock.yaml"; sha256: string };
    nativeCargo: { path: "src/native-engine/Cargo.lock"; sha256: string };
    desktopCargo: { path: "src/desktop-shell/src-tauri/Cargo.lock"; sha256: string };
  };
  build: {
    startedAt: string;
    completedAt: string;
    commands: readonly [
      "pnpm.cmd install --frozen-lockfile",
      "cargo.exe clean --manifest-path src/desktop-shell/src-tauri/Cargo.toml --target-dir src/desktop-shell/src-tauri/target",
      "pnpm.cmd exec tauri build --no-bundle --ci -- --locked",
    ];
    toolVersions: {
      node: string;
      pnpm: string;
      cargo: string;
      rustc: string;
    };
  };
}
export function validateSourceMetadata(payload: unknown, expectedApplicationSha256: string): SourceMetadata;
export function parseSourceMetadata(serialized: string, expectedApplicationSha256: string): SourceMetadata;
export interface HarnessManifest {
  schemaVersion: 1;
  files: Record<"config" | "credentialProbe" | "helper" | "m4PackagedWalkthrough" | "n2SoakConfiguration" | "n2SoakEvidence" | "n2SoakRunner" | "n2SoakVerifier" | "runner" | "sandboxBootstrap" | "sourceMetadata", {
    path: string;
    sha256: string;
  }>;
  policy: {
    networking: "Disable";
    clipboardRedirection: "Disable";
    audioInput: "Disable";
    videoInput: "Disable";
    printerRedirection: "Disable";
    inputMappingsReadOnly: true;
    outputMappingReadOnly: false;
  };
}
export function validateHarnessManifest(payload: unknown): HarnessManifest;
export function validateSandboxConfig(serialized: string): HarnessManifest["policy"];
export function unwrapWebDriverValue(payload: unknown): unknown;
export function validateCredentialProbe(
  payload: unknown,
  expectedTarget: string,
  expectedFound: boolean,
): CredentialProbe;
export function scanFileForBytes(path: string, needle: Uint8Array, chunkSize?: number): Promise<boolean>;
export interface DevToolsPortMirror {
  copied: true;
  source: string;
  destination: string;
  byteLength: number;
}
export function mirrorWebViewDevToolsPort(
  userDataFolder: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<DevToolsPortMirror>;
