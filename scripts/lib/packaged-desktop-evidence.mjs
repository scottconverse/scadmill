import { open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function webViewAutomationArgument() {
  return "--edge-webview-switches=--remote-debugging-port=0";
}

export function processHasExited(exitCode, signalCode) {
  return exitCode !== null || signalCode !== null;
}

export function validatePackagedWorkspaceLayoutObservation(payload, expectedDockWidth) {
  if (!Number.isInteger(expectedDockWidth) || expectedDockWidth < 180 || expectedDockWidth > 480) {
    throw new Error("Expected packaged dock width must be an integer from 180 through 480.");
  }
  if (
    !record(payload)
    || Object.keys(payload).sort().join(",") !== "dockWidth,storageEntries"
    || payload.dockWidth !== expectedDockWidth
    || !Array.isArray(payload.storageEntries)
    || payload.storageEntries.length !== 1
  ) throw new Error("Packaged workspace layout observation has the wrong shape or width.");
  const entry = payload.storageEntries[0];
  if (
    !record(entry)
    || Object.keys(entry).sort().join(",") !== "key,value"
    || typeof entry.key !== "string"
    || typeof entry.value !== "string"
  ) {
    throw new Error("Packaged workspace layout storage entry is invalid.");
  }
  const match = /^scadmill\.desktop-workspace-layout\.v1:(desktop-project:[0-9a-f]{64})$/u.exec(entry.key);
  if (!match) throw new Error("Packaged workspace layout key is not an opaque project identity.");
  let serializedLayout;
  try {
    serializedLayout = JSON.parse(entry.value);
  } catch {
    throw new Error("Packaged workspace layout value is not JSON.");
  }
  const layoutKeys = [
    "activeRail",
    "consoleHeight",
    "consoleOpen",
    "dockOpen",
    "dockWidth",
    "editorOpen",
    "narrowView",
    "parameterHeight",
    "parameterOpen",
    "version",
    "viewerOpen",
    "viewerWidth",
  ];
  if (
    !record(serializedLayout)
    || Object.keys(serializedLayout).sort().join(",") !== layoutKeys.join(",")
    || serializedLayout.version !== 1
    || !["files", "search", "history", "ai", "libraries"].includes(serializedLayout.activeRail)
    || !["dockOpen", "editorOpen", "viewerOpen", "parameterOpen", "consoleOpen"]
      .every((key) => typeof serializedLayout[key] === "boolean")
    || !Number.isInteger(serializedLayout.dockWidth)
    || serializedLayout.dockWidth < 180
    || serializedLayout.dockWidth > 480
    || !Number.isInteger(serializedLayout.viewerWidth)
    || serializedLayout.viewerWidth < 320
    || serializedLayout.viewerWidth > 720
    || !Number.isInteger(serializedLayout.parameterHeight)
    || serializedLayout.parameterHeight < 120
    || serializedLayout.parameterHeight > 480
    || !Number.isInteger(serializedLayout.consoleHeight)
    || serializedLayout.consoleHeight < 100
    || serializedLayout.consoleHeight > 400
    || (serializedLayout.narrowView !== "code" && serializedLayout.narrowView !== "model")
  ) {
    throw new Error("Packaged workspace layout value has the wrong shape.");
  }
  if (serializedLayout.dockWidth !== expectedDockWidth) {
    throw new Error("Packaged workspace layout value has the wrong dock width.");
  }
  return {
    dockWidth: payload.dockWidth,
    serializedLayout: entry.value,
    storageKey: entry.key,
    workspaceIdentity: match[1],
  };
}

export function validatePackagedWorkspaceLayoutRestart(before, after) {
  const validateProcessObservation = (value, phase) => {
    if (
      !record(value)
      || Object.keys(value).sort().join(",") !== "applicationPid,layout,webViewPids"
      || !Number.isSafeInteger(value.applicationPid)
      || value.applicationPid <= 0
      || !Array.isArray(value.webViewPids)
      || value.webViewPids.length === 0
      || value.webViewPids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)
      || new Set(value.webViewPids).size !== value.webViewPids.length
      || !record(value.layout)
      || Object.keys(value.layout).sort().join(",")
        !== "dockWidth,serializedLayout,storageKey,workspaceIdentity"
    ) {
      throw new Error(`Packaged workspace layout ${phase} process observation is invalid.`);
    }
    const layout = validatePackagedWorkspaceLayoutObservation({
      dockWidth: value.layout.dockWidth,
      storageEntries: [{ key: value.layout.storageKey, value: value.layout.serializedLayout }],
    }, value.layout.dockWidth);
    if (layout.workspaceIdentity !== value.layout.workspaceIdentity) {
      throw new Error(`Packaged workspace layout ${phase} identity does not match its storage key.`);
    }
    return { ...value, layout };
  };
  const checkedBefore = validateProcessObservation(before, "before-restart");
  const checkedAfter = validateProcessObservation(after, "after-restart");
  if (checkedBefore.applicationPid === checkedAfter.applicationPid) {
    throw new Error("Packaged workspace layout restart did not create a fresh application process.");
  }
  const priorWebViewPids = new Set(checkedBefore.webViewPids);
  if (checkedAfter.webViewPids.some((pid) => priorWebViewPids.has(pid))) {
    throw new Error("Packaged workspace layout restart did not create fresh WebView processes.");
  }
  if (
    checkedBefore.layout.dockWidth !== checkedAfter.layout.dockWidth
    || checkedBefore.layout.storageKey !== checkedAfter.layout.storageKey
    || checkedBefore.layout.workspaceIdentity !== checkedAfter.layout.workspaceIdentity
    || checkedBefore.layout.serializedLayout !== checkedAfter.layout.serializedLayout
  ) {
    throw new Error("Packaged workspace layout was not restored exactly after process restart.");
  }
  return {
    exactLayoutRestored: true,
    freshApplicationProcess: true,
    freshWebViewProcesses: true,
  };
}

export function validateSourceMetadata(payload, expectedApplicationSha256) {
  if (
    !record(payload)
    || Object.keys(payload).sort().join(",") !== "applicationSha256,baseCommit,branch"
    || !/^[A-Fa-f0-9]{40}$/u.test(payload.baseCommit)
    || typeof payload.branch !== "string"
    || payload.branch.length === 0
    || payload.branch.length > 256
    || [...payload.branch].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
    || !/^[A-Fa-f0-9]{64}$/u.test(payload.applicationSha256)
  ) {
    throw new Error("Source metadata must contain one commit, branch, and application hash.");
  }
  if (payload.applicationSha256.toUpperCase() !== expectedApplicationSha256.toUpperCase()) {
    throw new Error("Source metadata release hash does not match the staged application.");
  }
  return payload;
}

export function parseSourceMetadata(serialized, expectedApplicationSha256) {
  if (typeof serialized !== "string") throw new Error("Source metadata must be JSON text.");
  return validateSourceMetadata(JSON.parse(serialized.replace(/^\uFEFF/u, "")), expectedApplicationSha256);
}

const HARNESS_FILES = {
  config: "scadmill-packaged-evidence.wsb",
  credentialProbe: "scripts/credential-probe.ps1",
  helper: "scripts/lib/packaged-desktop-evidence.mjs",
  runner: "scripts/run-packaged-desktop-evidence.mjs",
  sandboxBootstrap: "scripts/run-packaged-desktop-sandbox.ps1",
  sourceMetadata: "scripts/source-metadata.json",
};

const HARNESS_POLICY = {
  networking: "Disable",
  clipboardRedirection: "Disable",
  audioInput: "Disable",
  videoInput: "Disable",
  printerRedirection: "Disable",
  inputMappingsReadOnly: true,
  outputMappingReadOnly: false,
};

export function validateHarnessManifest(payload) {
  if (
    !record(payload)
    || Object.keys(payload).sort().join(",") !== "files,policy,schemaVersion"
    || payload.schemaVersion !== 1
    || !record(payload.files)
    || Object.keys(payload.files).sort().join(",") !== Object.keys(HARNESS_FILES).sort().join(",")
    || !record(payload.policy)
    || Object.keys(payload.policy).sort().join(",") !== Object.keys(HARNESS_POLICY).sort().join(",")
  ) throw new Error("Harness manifest has the wrong shape.");
  for (const [role, expectedPath] of Object.entries(HARNESS_FILES)) {
    const entry = payload.files[role];
    if (
      !record(entry)
      || Object.keys(entry).sort().join(",") !== "path,sha256"
      || entry.path !== expectedPath
      || typeof entry.sha256 !== "string"
      || !/^[A-Fa-f0-9]{64}$/u.test(entry.sha256)
    ) throw new Error(`Harness manifest file ${role} is invalid.`);
  }
  for (const [name, expected] of Object.entries(HARNESS_POLICY)) {
    if (payload.policy[name] !== expected) throw new Error(`Harness isolation policy ${name} is invalid.`);
  }
  return payload;
}

export function validateSandboxConfig(serialized) {
  if (typeof serialized !== "string" || serialized.length === 0) {
    throw new Error("Sandbox config must be non-empty XML text.");
  }
  if (serialized.includes("<!--") || serialized.includes("-->")) {
    throw new Error("Sandbox config comments are not allowed in retained evidence.");
  }
  for (const tag of ["Networking", "ClipboardRedirection", "AudioInput", "VideoInput", "PrinterRedirection"]) {
    const matches = [...serialized.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "gu"))];
    if (matches.length !== 1 || matches[0][1] !== "Disable") {
      throw new Error(`Sandbox config ${tag} must be Disable.`);
    }
  }
  const expectedMappings = new Map([
    ["C:\\ScadMillEvidence", "true"],
    ["C:\\ScadMillEngine", "true"],
    ["C:\\ScadMillWebView", "true"],
    ["C:\\ScadMillEvidenceOutput", "false"],
  ]);
  const mappedFolders = [...serialized.matchAll(/<MappedFolder>([\s\S]*?)<\/MappedFolder>/gu)];
  if (mappedFolders.length !== expectedMappings.size) {
    throw new Error("Sandbox config must contain exactly four named mappings.");
  }
  for (const [, body] of mappedFolders) {
    const folders = [...body.matchAll(/<SandboxFolder>([^<]+)<\/SandboxFolder>/gu)];
    const readOnly = [...body.matchAll(/<ReadOnly>(true|false)<\/ReadOnly>/gu)];
    if (folders.length !== 1 || readOnly.length !== 1 || expectedMappings.get(folders[0][1]) !== readOnly[0][1]) {
      throw new Error("Sandbox config mapping ownership or read-only policy is invalid.");
    }
    expectedMappings.delete(folders[0][1]);
  }
  if (expectedMappings.size !== 0) throw new Error("Sandbox config is missing a required named mapping.");
  const logon = [...serialized.matchAll(/<LogonCommand><Command>([^<]+)<\/Command><\/LogonCommand>/gu)];
  if (
    logon.length !== 1
    || logon[0][1] !== "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\ScadMillEvidence\\scripts\\run-packaged-desktop-sandbox.ps1"
  ) throw new Error("Sandbox config must run the reviewed bootstrap script exactly once.");
  return { ...HARNESS_POLICY };
}

export function parseBinaryStl(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 84) {
    throw new Error("Binary STL length is shorter than its 84-byte header.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(80, true);
  const expectedLength = 84 + triangleCount * 50;
  if (!Number.isSafeInteger(expectedLength) || bytes.byteLength !== expectedLength) {
    throw new Error(`Binary STL length ${bytes.byteLength} does not match ${expectedLength}.`);
  }
  if (triangleCount === 0) throw new Error("Binary STL contains no triangles.");
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = 84 + triangle * 50;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const coordinate = view.getFloat32(offset + 12 + vertex * 12 + axis * 4, true);
        if (!Number.isFinite(coordinate)) {
          throw new Error("Binary STL coordinates must be finite.");
        }
        min[axis] = Math.min(min[axis], coordinate);
        max[axis] = Math.max(max[axis], coordinate);
      }
    }
  }
  return {
    triangleCount,
    bounds: {
      min,
      max,
      size: max.map((value, axis) => value - min[axis]),
    },
  };
}

export function unwrapWebDriverValue(payload) {
  if (!record(payload) || !("value" in payload)) {
    throw new Error("WebDriver returned an invalid response envelope.");
  }
  if (record(payload.value) && typeof payload.value.error === "string") {
    const message = typeof payload.value.message === "string" ? payload.value.message : "remote error";
    throw new Error(`${payload.value.error}: ${message}`);
  }
  return payload.value;
}

export function validateCredentialProbe(payload, expectedTarget, expectedFound) {
  if (
    !record(payload)
    || Object.keys(payload).sort().join(",") !== "found,lastError,target"
    || payload.target !== expectedTarget
  ) throw new Error("Credential probe returned the wrong target or shape.");
  if (payload.found !== expectedFound || typeof payload.lastError !== "number") {
    throw new Error("Credential probe returned the wrong found state.");
  }
  const expectedError = expectedFound ? 0 : 1168;
  if (payload.lastError !== expectedError) {
    throw new Error(`Credential probe returned Win32 error ${payload.lastError}, expected ${expectedError}.`);
  }
  return payload;
}

export async function scanFileForBytes(path, needle, chunkSize = 64 * 1024) {
  if (!(needle instanceof Uint8Array) || needle.byteLength === 0) {
    throw new Error("Sentinel bytes must be non-empty.");
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("Scan chunk size must be a positive integer.");
  }
  const handle = await open(path, "r");
  try {
    const target = Buffer.from(needle.buffer, needle.byteOffset, needle.byteLength);
    const buffer = Buffer.allocUnsafe(chunkSize);
    let carry = Buffer.alloc(0);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) return false;
      position += bytesRead;
      const haystack = Buffer.concat([carry, buffer.subarray(0, bytesRead)]);
      if (haystack.indexOf(target) >= 0) return true;
      carry = haystack.subarray(Math.max(0, haystack.byteLength - target.byteLength + 1));
    }
  } finally {
    await handle.close();
  }
}

export async function mirrorWebViewDevToolsPort(
  userDataFolder,
  { timeoutMs = 60_000, intervalMs = 10 } = {},
) {
  if (typeof userDataFolder !== "string" || userDataFolder.length === 0) {
    throw new Error("WebView2 user-data folder must be a non-empty path.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("DevTools port mirror timeout must be a positive integer.");
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("DevTools port mirror interval must be a positive integer.");
  }
  const source = join(userDataFolder, "EBWebView", "DevToolsActivePort");
  const destination = join(userDataFolder, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  let latest = "source not created";
  while (Date.now() < deadline) {
    try {
      const bytes = await readFile(source);
      const [port, browserPath] = bytes.toString("utf8").trimEnd().split(/\r?\n/u);
      const numericPort = Number(port);
      if (
        Number.isSafeInteger(numericPort)
        && numericPort > 0
        && numericPort <= 65_535
        && browserPath?.startsWith("/devtools/browser/")
      ) {
        await writeFile(destination, bytes);
        return { copied: true, source, destination, byteLength: bytes.byteLength };
      }
      latest = "source was incomplete";
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      latest = "source not created";
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out mirroring WebView2 DevToolsActivePort (${latest}).`);
}
