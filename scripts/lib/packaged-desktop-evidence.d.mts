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

export function parseBinaryStl(bytes: Uint8Array): StlEvidence;
export function webViewAutomationArgument(): "--edge-webview-switches=--remote-debugging-port=0";
export function processHasExited(exitCode: number | null, signalCode: NodeJS.Signals | null): boolean;
export interface SourceMetadata {
  baseCommit: string;
  branch: string;
  applicationSha256: string;
}
export function validateSourceMetadata(payload: unknown, expectedApplicationSha256: string): SourceMetadata;
export function parseSourceMetadata(serialized: string, expectedApplicationSha256: string): SourceMetadata;
export interface HarnessManifest {
  schemaVersion: 1;
  files: Record<"config" | "credentialProbe" | "helper" | "runner" | "sandboxBootstrap" | "sourceMetadata", {
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
