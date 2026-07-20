import { createHash } from "node:crypto";
import { open, readFile, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";

export const SET_PACKAGED_CONTROL_VALUE_SCRIPT = `
  const wanted = arguments[0];
  const visible = (element) => element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden'
    && getComputedStyle(element).display !== 'none';
  const formControl = (element) => element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement;
  const candidates = new Set(
    [...document.querySelectorAll('[aria-label="' + CSS.escape(wanted) + '"]')],
  );
  for (const label of document.querySelectorAll('label')) {
    if (!visible(label) || label.textContent.trim() !== wanted) continue;
    if (formControl(label.control)) candidates.add(label.control);
    for (const descendant of label.querySelectorAll('input, select, textarea')) {
      candidates.add(descendant);
    }
  }
  const eligible = [...candidates].filter((candidate) =>
    formControl(candidate) && visible(candidate) && !candidate.matches(':disabled'));
  if (eligible.length !== 1) return null;
  const control = eligible[0];
  const prototype = control instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) return null;
  setter.call(control, arguments[1]);
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
  return control.value;
`;

export const READ_PACKAGED_CONTROL_VALUE_SCRIPT = `
  const wanted = arguments[0];
  const visible = (element) => element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden'
    && getComputedStyle(element).display !== 'none';
  const formControl = (element) => element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement;
  const candidates = new Set(
    [...document.querySelectorAll('[aria-label="' + CSS.escape(wanted) + '"]')],
  );
  for (const label of document.querySelectorAll('label')) {
    if (!visible(label) || label.textContent.trim() !== wanted) continue;
    if (formControl(label.control)) candidates.add(label.control);
    for (const descendant of label.querySelectorAll('input, select, textarea')) {
      candidates.add(descendant);
    }
  }
  const eligible = [...candidates].filter((candidate) =>
    formControl(candidate) && visible(candidate) && !candidate.matches(':disabled'));
  return eligible.length === 1 ? eligible[0].value : null;
`;

export const FIND_PACKAGED_TEXTAREA_CONTROL_SCRIPT = `
  const wanted = arguments[0];
  const visible = (element) => element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden'
    && getComputedStyle(element).display !== 'none';
  const candidates = new Set(
    [...document.querySelectorAll('[aria-label="' + CSS.escape(wanted) + '"]')],
  );
  for (const label of document.querySelectorAll('label')) {
    if (!visible(label) || label.textContent.trim() !== wanted) continue;
    if (label.control instanceof HTMLTextAreaElement) candidates.add(label.control);
    for (const descendant of label.querySelectorAll('textarea')) candidates.add(descendant);
  }
  const eligible = [...candidates].filter((candidate) => candidate instanceof HTMLTextAreaElement
    && visible(candidate) && !candidate.disabled);
  if (eligible.length === 0) return { kind: 'absent' };
  if (eligible.length > 1) return { kind: 'ambiguous', count: eligible.length };
  return eligible[0];
`;

const WEBDRIVER_CONTROL_KEY = "\uE009";

export function textReplacementKeyActions(value) {
  if (typeof value !== "string") throw new Error("WebDriver text replacement requires text.");
  const actions = [
    { type: "keyDown", value: WEBDRIVER_CONTROL_KEY },
    { type: "keyDown", value: "a" },
    { type: "keyUp", value: "a" },
    { type: "keyUp", value: WEBDRIVER_CONTROL_KEY },
  ];
  for (const character of value) {
    actions.push({ type: "keyDown", value: character }, { type: "keyUp", value: character });
  }
  return [{ type: "key", id: "scadmill-text-entry", actions }];
}

function controlWaitOptions(options) {
  if (options !== undefined && !record(options)) throw new Error("Packaged control wait options are invalid.");
  const {
    timeoutMs = 10_000,
    intervalMs = 50,
    delayImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = options ?? {};
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0
    || !Number.isSafeInteger(intervalMs) || intervalMs <= 0 || intervalMs > timeoutMs
    || typeof delayImpl !== "function") throw new Error("Packaged control wait options are invalid.");
  return { timeoutMs, intervalMs, delayImpl };
}

export async function waitForVisibleEnabledControlValue(
  client,
  label,
  value,
  options,
) {
  if (!client || typeof client.execute !== "function" || typeof label !== "string" || label.length === 0) {
    throw new Error("Packaged control verification requires a client and non-empty label.");
  }
  const { timeoutMs, intervalMs, delayImpl } = controlWaitOptions(options);
  const expected = String(value);
  const deadline = Date.now() + timeoutMs;
  let consecutiveCommittedReads = 0;
  do {
    await delayImpl(intervalMs);
    if (await client.execute(READ_PACKAGED_CONTROL_VALUE_SCRIPT, [label]) === expected) {
      consecutiveCommittedReads += 1;
      if (consecutiveCommittedReads >= 2) return;
    } else {
      consecutiveCommittedReads = 0;
    }
  } while (Date.now() < deadline);
  throw new Error(`Control ${JSON.stringify(label)} did not retain the requested value after its UI commit.`);
}

export async function setVisibleEnabledControl(
  client,
  label,
  value,
  options,
) {
  if (!client || typeof client.execute !== "function" || typeof label !== "string" || label.length === 0) {
    throw new Error("Packaged control automation requires a client and non-empty label.");
  }
  const validatedOptions = controlWaitOptions(options);
  const expected = String(value);
  const selected = await client.execute(SET_PACKAGED_CONTROL_VALUE_SCRIPT, [label, expected]);
  if (selected !== expected) throw new Error(`Could not set ${JSON.stringify(label)} to the requested value.`);
  await waitForVisibleEnabledControlValue(client, label, expected, validatedOptions);
}

export async function setVisibleEnabledTextArea(client, label, value, options) {
  if (!client || typeof client.execute !== "function" || typeof client.clickElement !== "function"
    || typeof client.performActions !== "function" || typeof client.releaseActions !== "function"
    || typeof label !== "string" || label.length === 0) {
    throw new Error("Packaged textarea automation requires a WebDriver client and non-empty label.");
  }
  const validatedOptions = controlWaitOptions(options);
  const reference = await client.execute(FIND_PACKAGED_TEXTAREA_CONTROL_SCRIPT, [label]);
  if (reference?.kind === "absent") return false;
  if (reference?.kind === "ambiguous") {
    throw new Error(`Packaged textarea ${JSON.stringify(label)} is ambiguous.`);
  }
  const elementId = reference?.["element-6066-11e4-a52e-4f735466cecf"];
  if (typeof elementId !== "string" || elementId.length === 0) {
    throw new Error(`WebDriver did not return an element reference for ${JSON.stringify(label)}.`);
  }
  const expected = String(value);
  await client.clickElement(elementId);
  let actionFailure;
  try {
    await client.performActions(textReplacementKeyActions(expected));
  } catch (error) {
    actionFailure = error;
  }
  let releaseFailure;
  try {
    await client.releaseActions();
  } catch (error) {
    releaseFailure = error;
  }
  if (actionFailure && releaseFailure) {
    throw new AggregateError(
      [actionFailure, releaseFailure],
      "WebDriver keyboard actions and release both failed.",
    );
  }
  if (actionFailure) throw actionFailure;
  if (releaseFailure) throw releaseFailure;
  await waitForVisibleEnabledControlValue(client, label, expected, validatedOptions);
  return true;
}

export const CLICK_PACKAGED_BUTTON_SCRIPT = `
  const wanted = arguments[0];
  const visible = (element) => element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden'
    && getComputedStyle(element).display !== 'none';
  const matches = [...document.querySelectorAll('button')]
    .filter((candidate) => candidate.textContent.trim() === wanted
      && !candidate.disabled && visible(candidate));
  if (matches.length !== 1) return false;
  matches[0].click();
  return true;
`;

export async function clickVisibleEnabledButton(
  client,
  text,
  { timeoutMs = 10_000, intervalMs = 50, delayImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {},
) {
  if (!client || typeof client.execute !== "function" || typeof text !== "string" || text.length === 0) {
    throw new Error("Packaged button automation requires a client and non-empty label.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0
    || !Number.isSafeInteger(intervalMs) || intervalMs <= 0 || intervalMs > timeoutMs
    || typeof delayImpl !== "function") throw new Error("Packaged button wait options are invalid.");
  const deadline = Date.now() + timeoutMs;
  do {
    if (await client.execute(CLICK_PACKAGED_BUTTON_SCRIPT, [text]) === true) return;
    await delayImpl(intervalMs);
  } while (Date.now() < deadline);
  throw new Error(`Could not click enabled button ${JSON.stringify(text)}.`);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validMcpEndpointIdentity(value) {
  return record(value)
    && Object.keys(value).sort().join(",") === "address,pid,port"
    && value.address === "127.0.0.1"
    && Number.isInteger(value.port)
    && value.port >= 1
    && value.port <= 65_535
    && Number.isSafeInteger(value.pid)
    && value.pid > 0;
}

function fullyQualifiedWindowsPath(value) {
  if (typeof value !== "string" || !win32.isAbsolute(value)) return false;
  const root = win32.parse(value).root.replaceAll("/", "\\");
  return /^[A-Za-z]:\\$/u.test(root) || /^\\\\[^\\]+\\[^\\]+\\$/u.test(root);
}

export function mcpEndpointManifestPath(executablePath, temporaryDirectory) {
  if (
    !fullyQualifiedWindowsPath(executablePath)
    || !fullyQualifiedWindowsPath(temporaryDirectory)
  ) throw new Error("MCP endpoint identity requires absolute executable and temporary paths.");
  const identity = executablePath.replaceAll("/", "\\").toLowerCase();
  const suffix = createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 24);
  return win32.join(temporaryDirectory, `scadmill-mcp-${suffix}.json`);
}

export function validateMcpEndpointManifest(payload, expectedGuiPid) {
  if (
    !Number.isSafeInteger(expectedGuiPid)
    || expectedGuiPid <= 0
    || !record(payload)
    || Object.keys(payload).sort().join(",") !== "address,pid,port,process_start_id,token,version"
    || payload.version !== 1
    || !validMcpEndpointIdentity({
      address: payload.address,
      port: payload.port,
      pid: payload.pid,
    })
    || payload.pid !== expectedGuiPid
    || typeof payload.process_start_id !== "string"
    || !/^[0-9a-f]{16}$/u.test(payload.process_start_id)
    || payload.process_start_id === "0000000000000000"
    || typeof payload.token !== "string"
    || !/^[0-9a-f]{64}$/u.test(payload.token)
  ) throw new Error("MCP endpoint manifest is invalid or does not belong to the GUI process.");
  return payload;
}

export function validateMcpListenerObservation(payload, expectedEnabled, expectedEndpoint) {
  if (!Array.isArray(payload) || typeof expectedEnabled !== "boolean") {
    throw new Error("MCP listener observation has the wrong shape.");
  }
  if (!expectedEnabled) {
    if (payload.length !== 0) {
      throw new Error("MCP listener observation must be empty while MCP is off.");
    }
    return payload;
  }
  let expectedIdentity = expectedEndpoint;
  if (!validMcpEndpointIdentity(expectedIdentity)) {
    try {
      const manifest = validateMcpEndpointManifest(expectedEndpoint, expectedEndpoint?.pid);
      expectedIdentity = { address: manifest.address, port: manifest.port, pid: manifest.pid };
    } catch {
      expectedIdentity = null;
    }
  }
  if (
    !validMcpEndpointIdentity(expectedIdentity)
    || payload.length !== 1
    || !validMcpEndpointIdentity(payload[0])
    || payload[0].address !== expectedIdentity.address
    || payload[0].port !== expectedIdentity.port
    || payload[0].pid !== expectedIdentity.pid
  ) throw new Error("MCP listener observation does not exactly match the enabled endpoint.");
  return payload;
}

export function parseWindowsNetstatTcpListeners(output) {
  if (typeof output !== "string" || !/\bProto\s+Local Address\s+Foreign Address\s+State\s+PID\b/u.test(output)) {
    throw new Error("Windows netstat output is missing its TCP process table header.");
  }
  const listeners = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/u.exec(line);
    if (!match) continue;
    const port = Number(match[2]);
    const pid = Number(match[3]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535 || !Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error("Windows netstat output contains an invalid TCP listener identity.");
    }
    listeners.push({ address: match[1], port, pid });
  }
  return listeners;
}

export function sanitizeMcpEndpointManifest(manifest) {
  const checked = validateMcpEndpointManifest(manifest, manifest?.pid);
  return {
    version: checked.version,
    address: checked.address,
    port: checked.port,
    pid: checked.pid,
    processIdentityBound: true,
  };
}

function sanitizeMcpTranscriptValue(value, token, ancestors) {
  if (typeof value === "string") return value.replaceAll(token, "[REDACTED]");
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value !== "object") {
    throw new Error("MCP transcript must contain only JSON-compatible evidence.");
  }
  if (ancestors.has(value)) throw new Error("MCP transcript must not be cyclic.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeMcpTranscriptValue(entry, token, ancestors));
    }
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key.toLowerCase() === "token") continue;
      sanitized[key.replaceAll(token, "[REDACTED]")] = sanitizeMcpTranscriptValue(
        entry,
        token,
        ancestors,
      );
    }
    return sanitized;
  } finally {
    ancestors.delete(value);
  }
}

export function sanitizeMcpTranscript(payload, token) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/u.test(token)) {
    throw new Error("MCP transcript token must be 64 lowercase hexadecimal characters.");
  }
  return sanitizeMcpTranscriptValue(payload, token, new Set());
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

const SOURCE_BUILD_COMMANDS = [
  "pnpm.cmd install --frozen-lockfile",
  "cargo.exe clean --manifest-path src/desktop-shell/src-tauri/Cargo.toml --target-dir src/desktop-shell/src-tauri/target",
  "pnpm.cmd exec tauri build --no-bundle --ci -- --locked",
];

const SOURCE_LOCKFILES = {
  pnpm: "pnpm-lock.yaml",
  nativeCargo: "src/native-engine/Cargo.lock",
  desktopCargo: "src/desktop-shell/src-tauri/Cargo.lock",
};

function hasExactKeys(value, keys) {
  return record(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function sha(value, length) {
  return typeof value === "string" && new RegExp(`^[A-Fa-f0-9]{${length}}$`, "u").test(value);
}

function safeText(value, maximumLength = 512) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    });
}

function validateSourceLockfiles(lockfiles) {
  if (!hasExactKeys(lockfiles, Object.keys(SOURCE_LOCKFILES))) return false;
  return Object.entries(SOURCE_LOCKFILES).every(([name, path]) => {
    const lockfile = lockfiles[name];
    return hasExactKeys(lockfile, ["path", "sha256"])
      && lockfile.path === path
      && sha(lockfile.sha256, 64);
  });
}

function validateSourceBuild(build) {
  if (!hasExactKeys(build, ["startedAt", "completedAt", "commands", "toolVersions"])) return false;
  const started = Date.parse(build.startedAt);
  const completed = Date.parse(build.completedAt);
  const exactDates = Number.isFinite(started)
    && Number.isFinite(completed)
    && new Date(started).toISOString() === build.startedAt
    && new Date(completed).toISOString() === build.completedAt
    && completed >= started;
  const exactCommands = Array.isArray(build.commands)
    && build.commands.length === SOURCE_BUILD_COMMANDS.length
    && build.commands.every((command, index) => command === SOURCE_BUILD_COMMANDS[index]);
  const versions = build.toolVersions;
  const exactVersions = hasExactKeys(versions, ["node", "pnpm", "cargo", "rustc"])
    && Object.values(versions).every((version) => safeText(version));
  return exactDates && exactCommands && exactVersions;
}

export function validateSourceMetadata(payload, expectedApplicationSha256) {
  if (
    !hasExactKeys(payload, [
      "schemaVersion",
      "sourceCommit",
      "sourceTree",
      "branch",
      "canonicalApplication",
      "applicationSha256",
      "worktree",
      "lockfiles",
      "build",
    ])
    || payload.schemaVersion !== 1
    || !sha(payload.sourceCommit, 40)
    || !sha(payload.sourceTree, 40)
    || !safeText(payload.branch, 256)
    || payload.canonicalApplication !== "src/desktop-shell/src-tauri/target/release/scadmill.exe"
    || !sha(payload.applicationSha256, 64)
  ) {
    throw new Error("Source metadata must identify one canonical application and source tree.");
  }
  if (payload.applicationSha256.toUpperCase() !== expectedApplicationSha256.toUpperCase()) {
    throw new Error("Source metadata release hash does not match the staged application.");
  }
  if (
    !hasExactKeys(payload.worktree, ["cleanBeforeBuild", "cleanAfterBuild"])
    || payload.worktree.cleanBeforeBuild !== true
    || payload.worktree.cleanAfterBuild !== true
  ) throw new Error("Source metadata must attest a clean worktree before and after the build.");
  if (!validateSourceLockfiles(payload.lockfiles) || !validateSourceBuild(payload.build)) {
    throw new Error("Source metadata must retain exact locked build provenance.");
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
  m4PackagedWalkthrough: "scripts/lib/m4-packaged-walkthrough.mjs",
  m4PackagedVerifier: "scripts/lib/m4-packaged-verifier.mjs",
  n2SoakConfiguration: "scripts/n2-soak-config.json",
  n2SoakEvidence: "scripts/lib/n2-soak-evidence.mjs",
  n2SoakRunner: "scripts/lib/n2-soak-runner.mjs",
  n2SoakVerifier: "scripts/lib/n2-soak-verifier.mjs",
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
  { timeoutMs = 60_000, intervalMs = 10, readFileImpl = readFile } = {},
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
    let bytes;
    try {
      bytes = await readFileImpl(source);
    } catch (error) {
      if (error?.code === "ENOENT") latest = "source not created";
      else if (error?.code === "EBUSY") latest = "source temporarily locked";
      else throw error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
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
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out mirroring WebView2 DevToolsActivePort (${latest}).`);
}
