import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { basename, dirname, join, normalize, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { verifyM4PackagedArtifacts } from "./lib/m4-packaged-verifier.mjs";
import {
  M4_DOM_SCRIPTS,
  runM4PackagedWalkthrough,
  startScriptedM4LocalProviderMock,
} from "./lib/m4-packaged-walkthrough.mjs";
import { runN2Soak } from "./lib/n2-soak-runner.mjs";
import { verifyN2SoakArtifacts } from "./lib/n2-soak-verifier.mjs";
import {
  clickVisibleEnabledButton,
  mcpEndpointManifestPath,
  mirrorWebViewDevToolsPort,
  PACKAGED_WORKBENCH_EDITOR_SELECTOR,
  parseBinaryStl,
  parseSourceMetadata,
  parseWindowsNetstatTcpListeners,
  processHasExited,
  sanitizeMcpEndpointManifest,
  sanitizeMcpTranscript,
  scanFileForBytes,
  setVisibleEnabledControl,
  setVisibleEnabledTextArea,
  unwrapWebDriverValue,
  validateCredentialProbe,
  validateHarnessManifest,
  validateMcpEndpointManifest,
  validateMcpListenerObservation,
  validatePackagedWorkspaceLayoutObservation,
  validatePackagedWorkspaceLayoutRestart,
  validateSandboxConfig,
  webViewAutomationArgument,
} from "./lib/packaged-desktop-evidence.mjs";

const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";
const NULL_KEY = "\uE000";
const CONTROL_KEY = "\uE009";
const END_KEY = "\uE010";
const ARROW_RIGHT_KEY = "\uE014";
const EXPECTED_ENGINE_SHA256 = "DE9A0C732C23C3FEB0B49CF938777AA0AEE3E206DB9E98571672CACC4816C524";
const EXPECTED_ENGINE_VERSION = "2026.06.12";
const EXPECTED_WEBVIEW_SHA256 = "CA3D481F5E049CA550989D49C87D2AF9A3D0C1BED97CB080D15339899B0E241F";
const EXPECTED_VCRUNTIME_SHA256 = "D5E4D9A3E835FA679450145D6A7D94E36573A509317111904D9B3712C30D9066";
const EXPECTED_VCRUNTIME_COMPANION_SHA256 = "1F2D41C4AA5DB0BC33EBF7B66D72943A817D7CE6CBE880502A9403823633093F";
const EXPECTED_TAURI_DRIVER_SHA256 = "37EAF254088A75612A08235B7E5FCA11A900ABAF8B2475AA02B0A137A85ED2E9";
const EXPECTED_EDGE_DRIVER_SHA256 = "735A749DF7538EEB15ACB116B2B5307A8C0B01C8F606167F84C6702911847719";
const CREDENTIAL_TARGET = "ai-api-key.dev.scadmill.app";
const ERROR_NOT_FOUND = 1168;
const DRIVER_URL = "http://127.0.0.1:4444";

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error(`Invalid argument near ${name ?? "end"}.`);
    parsed[name.slice(2)] = resolve(value);
  }
  for (const required of ["app", "engine", "tauri-driver", "native-driver", "webview", "credential-probe", "keyboard-input", "source-metadata", "harness-manifest", "soak-config", "output"]) {
    if (!parsed[required]) throw new Error(`Missing --${required}.`);
  }
  return parsed;
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

async function fileSha256(path) {
  return fingerprint(await readFile(path));
}

async function readPersistedThumbnail(client, projectPath, boundary) {
  const snapshot = await client.execute(M4_DOM_SCRIPTS.thumbnailSnapshot);
  assert.ok(snapshot && Array.isArray(snapshot.storageEntries)
    && snapshot.storageEntries.length === 1, `M4 persisted thumbnail envelope is unavailable ${boundary}.`);
  const envelope = JSON.parse(snapshot.storageEntries[0].value);
  assert.ok(envelope?.version === 1 && Array.isArray(envelope.records), `M4 persisted thumbnail envelope is invalid ${boundary}.`);
  const records = envelope.records.filter((record) => record?.documentPath === projectPath);
  assert.equal(records.length, 1, `M4 persisted thumbnail record is not unique ${boundary}.`);
  assert.ok(typeof records[0].pngBase64 === "string" && records[0].pngBase64.length > 0, `M4 persisted thumbnail bytes are unavailable ${boundary}.`);
  assert.match(records[0].renderIdentity, /^sha256:[a-f0-9]{64}$/u, `M4 persisted thumbnail geometry identity is invalid ${boundary}.`);
  return {
    sha256: fingerprint(Buffer.from(records[0].pngBase64, "base64")).toLowerCase(),
    renderIdentity: records[0].renderIdentity,
  };
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitFor(probe, label, timeoutMs = 30_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    try {
      latest = await probe();
      if (latest) return latest;
    } catch (error) {
      latest = error;
    }
    await delay(intervalMs);
  }
  const detail = latest instanceof Error ? ` Last error: ${latest.message}` : "";
  throw new Error(`Timed out waiting for ${label}.${detail}`);
}

async function run(file, args, { timeoutMs = 30_000, allowFailure = false } = {}) {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(file, args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => {
      child.kill();
      rejectRun(new Error(`${basename(file)} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      };
      if (!allowFailure && code !== 0) {
        rejectRun(new Error(`${basename(file)} exited ${code}: ${result.stderr || result.stdout}`));
      } else {
        resolveRun(result);
      }
    });
  });
}

class McpStdioClient {
  constructor(application) {
    this.child = spawn(application, ["--mcp-stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.nextId = 1;
    this.messages = [];
    this.waiters = [];
    this.stderr = [];
    this.transcript = [];
    this.child.stderr.on("data", (chunk) => this.stderr.push(chunk));
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        message = { invalidJson: line };
      }
      this.transcript.push({ direction: "from-server", message });
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(message);
      else this.messages.push(message);
    });
  }

  send(message) {
    const line = `${JSON.stringify(message)}\n`;
    this.transcript.push({ direction: "to-server", message });
    this.child.stdin.write(line);
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  async request(method, params, timeoutMs = 60_000) {
    const response = await this.requestRaw(method, params, timeoutMs);
    assert.equal(response?.error, undefined, `${method} returned ${JSON.stringify(response?.error)}.`);
    return response.result;
  }

  async requestRaw(method, params, timeoutMs = 60_000) {
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    const response = await this.nextMessage(timeoutMs);
    assert.equal(response?.jsonrpc, "2.0", `${method} returned the wrong JSON-RPC version.`);
    assert.equal(response?.id, id, `${method} returned the wrong request id.`);
    return response;
  }

  nextMessage(timeoutMs) {
    if (this.messages.length > 0) return Promise.resolve(this.messages.shift());
    return new Promise((resolveMessage, rejectMessage) => {
      const waiter = {
        resolve: (message) => {
          clearTimeout(timeout);
          resolveMessage(message);
        },
      };
      const timeout = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        rejectMessage(new Error(`Timed out waiting for an MCP response after ${timeoutMs} ms.`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async waitForExit(timeoutMs = 15_000) {
    if (processHasExited(this.child.exitCode, this.child.signalCode)) return this.child.exitCode;
    return await new Promise((resolveExit, rejectExit) => {
      const timeout = setTimeout(() => {
        rejectExit(new Error(`MCP relay did not exit after ${timeoutMs} ms.`));
      }, timeoutMs);
      this.child.once("exit", (code) => {
        clearTimeout(timeout);
        resolveExit(code);
      });
    });
  }

  stop() {
    this.lines.close();
    if (!processHasExited(this.child.exitCode, this.child.signalCode)) this.child.kill();
  }

  stderrText() {
    return Buffer.concat(this.stderr).toString("utf8").trim();
  }
}

function structuredMcpToolResult(result, label) {
  assert.ok(result && typeof result === "object", `${label} returned no MCP tool result.`);
  assert.equal(result.isError, false, `${label} returned an MCP tool error.`);
  assert.ok(Array.isArray(result.content) && result.content.length === 1, `${label} returned the wrong MCP content shape.`);
  assert.equal(result.content[0]?.type, "text", `${label} did not return text content.`);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent, `${label} text and structured content differ.`);
  return result.structuredContent;
}

class WebDriverClient {
  constructor(baseUrl, keyboardInputPath) {
    this.baseUrl = baseUrl;
    this.keyboardInputPath = keyboardInputPath;
    this.applicationProcessId = null;
    this.sessionId = null;
    this.lastPortMirror = null;
    this.debuggerAddress = null;
  }

  bindApplicationProcess(processId) {
    if (!Number.isSafeInteger(processId) || processId <= 0) {
      throw new Error("Windows text input requires a verified application process.");
    }
    this.applicationProcessId = processId;
  }

  async request(method, path, body) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(method === "POST" && (path === "/session" || path.endsWith("/execute/async")) ? 90_000 : 30_000),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`WebDriver ${method} ${path} failed: ${detail}`);
    }
    const source = await response.text();
    let payload;
    try {
      payload = source ? JSON.parse(source) : { value: null };
    } catch {
      throw new Error(`WebDriver returned non-JSON HTTP ${response.status}: ${source}`);
    }
    if (!response.ok) {
      unwrapWebDriverValue(payload);
      throw new Error(`WebDriver returned HTTP ${response.status}.`);
    }
    return unwrapWebDriverValue(payload);
  }

  async createSession(application, webviewFolder) {
    const userDataFolder = join(process.env.LOCALAPPDATA, "dev.scadmill.desktop");
    const nestedPort = join(userDataFolder, "EBWebView", "DevToolsActivePort");
    const parentPort = join(userDataFolder, "DevToolsActivePort");
    await Promise.all([rm(nestedPort, { force: true }), rm(parentPort, { force: true })]);
    const portMirror = mirrorWebViewDevToolsPort(userDataFolder, { timeoutMs: 85_000, intervalMs: 10 });
    let value;
    try {
      value = await this.request("POST", "/session", {
        capabilities: {
          alwaysMatch: {
            browserName: "wry",
            "tauri:options": {
              application,
              args: [webViewAutomationArgument()],
              webviewOptions: { browserExecutableFolder: webviewFolder, userDataFolder },
            },
          },
        },
      });
    } catch (error) {
      const mirrorFailure = await portMirror.catch((mirrorError) => mirrorError);
      if (mirrorFailure instanceof Error) {
        throw new AggregateError([error, mirrorFailure], "WebDriver session and DevTools port mirror failed.");
      }
      throw error;
    }
    this.lastPortMirror = await portMirror;
    if (!value || typeof value !== "object" || typeof value.sessionId !== "string") {
      throw new Error("WebDriver did not return a session id.");
    }
    this.sessionId = value.sessionId;
    this.debuggerAddress = value.capabilities?.["ms:edgeOptions"]?.debuggerAddress ?? null;
    return value.capabilities ?? {};
  }

  sessionPath(suffix) {
    if (!this.sessionId) throw new Error("No active WebDriver session.");
    return `/session/${encodeURIComponent(this.sessionId)}${suffix}`;
  }

  execute(script, args = []) {
    return this.request("POST", this.sessionPath("/execute/sync"), { script, args });
  }

  executeAsync(script, args = []) {
    return this.request("POST", this.sessionPath("/execute/async"), { script, args });
  }

  async find(css) {
    const value = await this.request("POST", this.sessionPath("/element"), {
      using: "css selector",
      value: css,
    });
    const id = value?.[ELEMENT_KEY];
    if (typeof id !== "string") throw new Error(`WebDriver did not return an element for ${css}.`);
    return id;
  }

  clickElement(elementId) {
    return this.request("POST", this.sessionPath(`/element/${encodeURIComponent(elementId)}/click`), {});
  }

  sendKeys(elementId, text) {
    return this.request("POST", this.sessionPath(`/element/${encodeURIComponent(elementId)}/value`), {
      text,
      value: Array.from(text),
    });
  }

  async insertFocusedText(text, _expectedPageUrl) {
    if (!Number.isSafeInteger(this.applicationProcessId) || this.applicationProcessId <= 0) {
      throw new Error("Windows text input requires a verified application process.");
    }
    const encoded = Buffer.from(text, "utf8").toString("base64");
    let result;
    try {
      result = await run("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", this.keyboardInputPath,
        "-ProcessId", String(this.applicationProcessId),
        "-TextBase64", encoded,
      ], { timeoutMs: 10_000 });
    } catch {
      throw new Error("Windows text input failed.");
    }
    let evidence;
    try { evidence = JSON.parse(result.stdout); } catch { /* fail closed below */ }
    const minimumSent = 4 + text.length * 2;
    const maximumSent = 4 + text.length * 4;
    if (!evidence || Object.keys(evidence).sort().join(",") !== "activated,sent"
      || evidence.activated !== true || !Number.isSafeInteger(evidence.sent)
      || evidence.sent < minimumSent || evidence.sent > maximumSent
      || evidence.sent % 2 !== 0) {
      throw new Error("Windows text input returned invalid evidence.");
    }
  }

  async screenshot(path) {
    await writeFile(path, await this.screenshotBytes());
  }

  async screenshotBytes() {
    const encoded = await this.request("GET", this.sessionPath("/screenshot"));
    if (typeof encoded !== "string") throw new Error("WebDriver screenshot was not base64 text.");
    return Buffer.from(encoded, "base64");
  }

  async deleteSession() {
    if (!this.sessionId) {
      this.debuggerAddress = null;
      return;
    }
    const active = this.sessionId;
    this.sessionId = null;
    this.debuggerAddress = null;
    await this.request("DELETE", `/session/${encodeURIComponent(active)}`).catch(() => undefined);
  }
}

async function startDriver(tauriDriver, nativeDriver, output, ordinal) {
  const stdoutPath = join(output, `tauri-driver-${ordinal}.stdout.txt`);
  const stderrPath = join(output, `tauri-driver-${ordinal}.stderr.txt`);
  const stdout = [];
  const stderr = [];
  const child = spawn(tauriDriver, ["--native-driver", nativeDriver], {
    env: { ...process.env, MSEDGEDRIVER_TELEMETRY_OPTOUT: "1" },
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.once("exit", async () => {
    await Promise.all([
      writeFile(stdoutPath, Buffer.concat(stdout)),
      writeFile(stderrPath, Buffer.concat(stderr)),
    ]).catch(() => undefined);
  });
  await waitFor(async () => {
    if (processHasExited(child.exitCode, child.signalCode)) {
      throw new Error(`tauri-driver exited ${child.exitCode ?? child.signalCode}: ${Buffer.concat(stderr).toString("utf8")}`);
    }
    try {
      const response = await fetch(`${DRIVER_URL}/status`, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    } catch {
      return false;
    }
  }, "tauri-driver readiness", 30_000, 100);
  return {
    child,
    async stop() {
      if (!processHasExited(child.exitCode, child.signalCode)) {
        child.kill();
        try {
          await waitFor(() => processHasExited(child.exitCode, child.signalCode), "tauri-driver shutdown", 2_000, 50);
        } catch {
          const exact = (await exactExecutableProcesses(tauriDriver)).find(({ pid }) => pid === child.pid);
          if (exact) {
            assert.equal(await fileSha256(exact.path), EXPECTED_TAURI_DRIVER_SHA256, "tauri-driver fallback target hash mismatch.");
            await run("taskkill.exe", ["/PID", String(exact.pid), "/T", "/F"], { allowFailure: true });
          }
          await waitFor(async () => {
            const remains = (await exactExecutableProcesses(tauriDriver)).some(({ pid }) => pid === child.pid);
            return !remains;
          }, "exact tauri-driver process-tree shutdown", 8_000, 50);
        }
      }
      await Promise.all([
        writeFile(stdoutPath, Buffer.concat(stdout)),
        writeFile(stderrPath, Buffer.concat(stderr)),
      ]);
    },
  };
}

async function bodyText(client) {
  const text = await client.execute("return document.body ? document.body.innerText : ''; ");
  return typeof text === "string" ? text : "";
}

async function waitForBody(client, expected, timeoutMs = 30_000) {
  return waitFor(async () => (await bodyText(client)).includes(expected), `visible text ${JSON.stringify(expected)}`, timeoutMs);
}

async function clickButton(client, text) {
  await clickVisibleEnabledButton(client, text);
}

async function clickAria(client, label) {
  const clicked = await client.execute(`
    const visible = (element) => element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden'
      && getComputedStyle(element).display !== 'none';
    const element = [...document.querySelectorAll('[aria-label="' + CSS.escape(arguments[0]) + '"]')]
      .find((candidate) => candidate instanceof HTMLElement && visible(candidate));
    if (!(element instanceof HTMLElement) || element.matches(':disabled')) return false;
    element.click();
    return true;
  `, [label]);
  if (clicked !== true) throw new Error(`Could not click element labelled ${JSON.stringify(label)}.`);
}

async function activateRail(client, title) {
  const found = await client.execute(`
    const visible = (element) => element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden'
      && getComputedStyle(element).display !== 'none';
    const button = [...document.querySelectorAll('.activity-rail button[title]')]
      .find((candidate) => candidate.getAttribute('title') === arguments[0]
        && candidate instanceof HTMLButtonElement && visible(candidate));
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    if (button.getAttribute('aria-pressed') !== 'true') button.click();
    return true;
  `, [title]);
  if (found !== true) throw new Error(`Could not activate activity rail ${JSON.stringify(title)}.`);
  await waitFor(async () => (await client.execute(`
    const button = [...document.querySelectorAll('.activity-rail button[title]')]
      .find((candidate) => candidate.getAttribute('title') === arguments[0]);
    const dock = document.querySelector('.workspace-dock');
    const heading = dock?.querySelector('.layout-panel-heading span');
    return button?.getAttribute('aria-pressed') === 'true'
      && Boolean(dock && dock.getClientRects().length > 0)
      && heading?.textContent?.trim() === arguments[0];
  `, [title])) === true, `visible activity rail ${JSON.stringify(title)}`, 10_000, 50);
}

async function welcomeState(client) {
  return await client.execute(`
    const layer = document.querySelector('.welcome-modal-layer');
    let preference = null;
    try { preference = JSON.parse(localStorage.getItem('scadmill.welcome.v1')); } catch { /* invalid */ }
    return { visible: Boolean(layer && layer.getClientRects().length > 0), preference };
  `);
}

async function assertWelcomeStaysDisabled(client) {
  assert.deepEqual(await welcomeState(client), {
    visible: false,
    preference: { version: 1, showOnLaunch: false },
  });
}

async function dismissWelcome(client) {
  const initial = await welcomeState(client);
  assert.equal(initial.visible, true, "The fresh-profile Welcome dialog was not visible.");
  assert.equal(initial.preference, null, "The fresh profile already contained a Welcome preference.");
  const startupToggle = await client.find('[aria-label="Show welcome screen on startup"]');
  assert.equal(await client.execute(`
    return document.querySelector('[aria-label="Show welcome screen on startup"]')?.checked ?? null;
  `), true, "The fresh-profile Welcome startup toggle was not enabled.");
  await client.clickElement(startupToggle);
  await waitFor(async () => {
    const state = await client.execute(`
      const toggle = document.querySelector('[aria-label="Show welcome screen on startup"]');
      return {
        checked: toggle?.checked ?? null,
        serialized: localStorage.getItem('scadmill.welcome.v1'),
      };
    `);
    return state?.checked === false
      && state.serialized === '{"version":1,"showOnLaunch":false}';
  }, "persisted disabled Welcome startup preference", 10_000, 50);
  const closeWelcome = await client.find('[aria-label="Close welcome"]');
  await client.clickElement(closeWelcome);
  await waitFor(
    async () => (await client.execute("return document.querySelector('.welcome-modal-layer') === null;")) === true,
    "closed fresh-profile Welcome dialog",
    10_000,
    50,
  );
  await assertWelcomeStaysDisabled(client);
}

async function setControl(client, label, value) {
  client.bindApplicationProcess(lastVerifiedAppProcess?.pid);
  if (await setVisibleEnabledTextArea(client, label, value)) return;
  await setVisibleEnabledControl(client, label, value);
}

async function setChecked(client, label, checked) {
  assert.equal(typeof checked, "boolean", "Checkbox automation requires a boolean state.");
  const selected = await client.execute(`
    const wanted = arguments[0];
    const visible = (element) => element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden'
      && getComputedStyle(element).display !== 'none';
    const candidates = new Set(
      [...document.querySelectorAll('[aria-label="' + CSS.escape(wanted) + '"]')],
    );
    for (const label of document.querySelectorAll('label')) {
      if (!visible(label) || label.textContent.trim() !== wanted) continue;
      if (label.control instanceof HTMLInputElement) candidates.add(label.control);
      for (const descendant of label.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
        candidates.add(descendant);
      }
    }
    const eligible = [...candidates].filter((candidate) => candidate instanceof HTMLInputElement
      && ['checkbox', 'radio'].includes(candidate.type)
      && !candidate.disabled && visible(candidate));
    if (eligible.length !== 1 || (eligible[0].type === 'radio' && arguments[1] !== true)) return null;
    const control = eligible[0];
    if (control.checked !== arguments[1]) control.click();
    return control.checked;
  `, [label, checked]);
  if (selected !== checked) throw new Error(`Could not set ${JSON.stringify(label)} to ${checked}.`);
  await waitFor(async () => (await client.execute(`
    const wanted = arguments[0];
    const visible = (element) => element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden'
      && getComputedStyle(element).display !== 'none';
    const candidates = new Set(
      [...document.querySelectorAll('[aria-label="' + CSS.escape(wanted) + '"]')],
    );
    for (const label of document.querySelectorAll('label')) {
      if (!visible(label) || label.textContent.trim() !== wanted) continue;
      if (label.control instanceof HTMLInputElement) candidates.add(label.control);
      for (const descendant of label.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
        candidates.add(descendant);
      }
    }
    const eligible = [...candidates].filter((candidate) => candidate instanceof HTMLInputElement
      && ['checkbox', 'radio'].includes(candidate.type)
      && !candidate.disabled && visible(candidate));
    return eligible.length === 1 ? eligible[0].checked : null;
  `, [label])) === checked, `checkbox ${JSON.stringify(label)} state`, 10_000, 50);
}

async function clearDiagnosticConsole(client) {
  const visible = async () => (await client.execute(`
    const console = document.querySelector('.diagnostic-console');
    return Boolean(console && console.getClientRects().length > 0);
  `)) === true;
  if (!(await visible())) {
    const opened = await client.execute(`
      const button = document.querySelector('.status-diagnostics');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    `);
    assert.equal(opened, true, "M4 could not open the diagnostic console.");
    await waitFor(visible, "visible M4 diagnostic console", 10_000, 50);
  }
  const cleared = await client.execute(`
    const console = document.querySelector('.diagnostic-console');
    const button = [...(console?.querySelectorAll('button') ?? [])]
      .find((candidate) => candidate.textContent.trim() === 'Clear' && !candidate.disabled);
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  `);
  assert.equal(cleared, true, "M4 could not clear the diagnostic console.");
  await waitFor(
    async () => (await client.execute("return document.querySelectorAll('.console-run').length;")) === 0,
    "empty M4 diagnostic console phase baseline",
    10_000,
    50,
  );
}

async function inputValue(client, label) {
  const value = await client.execute(`
    const control = document.querySelector('[aria-label="' + CSS.escape(arguments[0]) + '"]');
    return control && 'value' in control ? control.value : null;
  `, [label]);
  return typeof value === "string" ? value : null;
}

async function splitterAriaValue(client, label) {
  const value = await client.execute(`
    const element = [...document.querySelectorAll('hr[aria-label]')]
      .find((candidate) => candidate.getAttribute('aria-label') === arguments[0]
        && candidate.getClientRects().length > 0);
    return element?.getAttribute('aria-valuenow') ?? null;
  `, [label]);
  const parsed = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : null;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function captureProjectLayoutObservation(client, expectedDockWidth) {
  const payload = await client.execute(`
    const prefix = 'scadmill.desktop-workspace-layout.v1:desktop-project:';
    const storageEntries = Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((key) => ({ key, value: localStorage.getItem(key) }));
    const splitter = [...document.querySelectorAll('hr[aria-label]')]
      .find((candidate) => candidate.getAttribute('aria-label') === 'Resize files panel'
        && candidate.getClientRects().length > 0);
    const value = splitter?.getAttribute('aria-valuenow') ?? null;
    return { dockWidth: /^[0-9]+$/.test(value ?? '') ? Number(value) : null, storageEntries };
  `);
  return validatePackagedWorkspaceLayoutObservation(payload, expectedDockWidth);
}

async function editorSource(client) {
  const source = await client.execute(`
    const content = document.querySelector(arguments[0]);
    const view = content?.cmView?.view;
    return view?.state?.doc?.toString() ?? content?.innerText ?? null;
  `, [PACKAGED_WORKBENCH_EDITOR_SELECTOR]);
  return typeof source === "string" ? source.replaceAll("\r\n", "\n") : null;
}

async function replaceEditorSource(client, source) {
  const editor = await client.find(PACKAGED_WORKBENCH_EDITOR_SELECTOR);
  await client.clickElement(editor);
  await client.sendKeys(editor, `${CONTROL_KEY}a${NULL_KEY}${source}`);
  await waitFor(async () => (await editorSource(client)) === source, "exact editor source", 10_000, 50);
}

async function appendEditorSource(client, suffix) {
  const editor = await client.find(PACKAGED_WORKBENCH_EDITOR_SELECTOR);
  await client.clickElement(editor);
  await client.sendKeys(editor, `${CONTROL_KEY}${END_KEY}${NULL_KEY}${suffix}`);
}

async function probeCredential(probePath, expectedFound) {
  const result = await run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", probePath,
    "-Target", CREDENTIAL_TARGET,
  ]);
  const parsed = JSON.parse(result.stdout);
  return validateCredentialProbe(parsed, CREDENTIAL_TARGET, expectedFound);
}

async function installedWebViewVersion() {
  const result = await run("reg.exe", [
    "query",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "/v", "pv",
  ], { allowFailure: true });
  const match = /\bpv\s+REG_SZ\s+([0-9]+(?:\.[0-9]+){3})/u.exec(`${result.stdout}\n${result.stderr}`);
  return { exitCode: result.code, version: match?.[1] ?? null };
}

async function exactAppProcesses(appPath) {
  return exactExecutableProcesses(appPath);
}

async function exactExecutableProcesses(executablePath) {
  const processName = basename(executablePath).replace(/\.exe$/iu, "").replaceAll("'", "''");
  const escaped = executablePath.replaceAll("'", "''");
  const command = [
    `$candidates = @(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -eq '${processName}' });`,
    "if (@($candidates | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.Path) -or $null -eq $_.StartTime }).Count -ne 0) { throw 'Cannot prove process identity because Path or StartTime is missing.' };",
    `@($candidates | Where-Object { $_.Path -eq '${escaped}' } | Select-Object @{n='pid';e={[int]$_.Id}},@{n='path';e={$_.Path}},@{n='startedAt';e={$_.StartTime.ToUniversalTime().ToString('o')}},@{n='privateBytes';e={[long]$_.PrivateMemorySize64}},@{n='workingSetBytes';e={[long]$_.WorkingSet64}}) | ConvertTo-Json -Compress`,
  ].join(" ");
  const result = await run("powershell.exe", ["-NoProfile", "-Command", command]);
  if (!result.stdout) return [];
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function tcpListenersForProcess(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, "Listener inspection requires a positive process id.");
  const result = await run("netstat.exe", ["-ano", "-p", "tcp"]);
  return parseWindowsNetstatTcpListeners(result.stdout).filter((listener) => listener.pid === pid);
}

function tcpEndpointReachable(endpoint, timeoutMs = 1_000) {
  return new Promise((resolveReachable) => {
    const socket = createConnection({ host: endpoint.address, port: endpoint.port });
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveReachable(reachable);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function mcpEndpointsForProcess(application, pid) {
  const temporary = process.env.TEMP;
  assert.ok(temporary, "TEMP is required for MCP endpoint inspection.");
  const expectedPath = normalize(mcpEndpointManifestPath(application, temporary));
  const entries = await readdir(temporary, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^scadmill-mcp-[0-9a-f]{24}\.json$/u.test(entry.name)) continue;
    const path = normalize(join(temporary, entry.name));
    assert.equal(
      path.toLowerCase(),
      expectedPath.toLowerCase(),
      `Unexpected ScadMill MCP manifest remained in the isolated Sandbox: ${entry.name}.`,
    );
    let payload;
    try {
      payload = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new Error(`ScadMill MCP manifest ${entry.name} is unreadable or invalid.`, {
        cause: error,
      });
    }
    // This harness runs in a fresh, isolated Sandbox with one staged ScadMill
    // executable. Any matching manifest belongs to this candidate lifecycle;
    // never ignore a crash-retained token merely because its embedded PID is stale.
    matches.push({ path, endpoint: validateMcpEndpointManifest(payload, pid) });
  }
  return matches;
}

async function mcpDiffSources(client) {
  const sources = await client.execute(`
    const read = (label) => {
      const content = document.querySelector('.cm-content[aria-label="' + CSS.escape(label) + '"]');
      const view = content?.cmView?.view;
      return view?.state?.doc?.toString() ?? content?.innerText ?? null;
    };
    return { local: read('Your version'), proposed: read('Disk version') };
  `);
  assert.equal(typeof sources?.local, "string", "MCP review did not expose the local source.");
  assert.equal(typeof sources?.proposed, "string", "MCP review did not expose the proposed source.");
  return {
    local: sources.local.replaceAll("\r\n", "\n"),
    proposed: sources.proposed.replaceAll("\r\n", "\n"),
  };
}

async function requireSingleAppProcess(appPath, expectedSha256) {
  const processes = await waitFor(async () => {
    const found = await exactAppProcesses(appPath);
    return found.length === 1 ? found : false;
  }, "one exact ScadMill process", 15_000, 100);
  assert.equal(await fileSha256(processes[0].path), expectedSha256);
  return processes[0];
}

async function requireExactExecutableProcesses(executablePath, expectedSha256, label) {
  const processes = await waitFor(async () => {
    const found = await exactExecutableProcesses(executablePath);
    return found.length > 0 ? found : false;
  }, label, 15_000, 100);
  for (const process of processes) {
    assert.equal(await fileSha256(process.path), expectedSha256, `${label} executable hash mismatch.`);
  }
  return processes.sort((left, right) => left.pid - right.pid);
}

async function waitForNoAppProcess(appPath) {
  await waitFor(async () => (await exactAppProcesses(appPath)).length === 0, "ScadMill process exit", 15_000, 100);
}

async function waitForNoExactExecutableProcess(executablePath, label) {
  await waitFor(
    async () => (await exactExecutableProcesses(executablePath)).length === 0,
    label,
    15_000,
    100,
  );
}

async function findFiles(root, wantedName) {
  const found = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.toLowerCase() === wantedName.toLowerCase()) found.push(path);
    }
  }
  await walk(root);
  return found;
}

async function latestStl(downloads) {
  const entries = await readdir(downloads, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".stl")) continue;
    const path = join(downloads, entry.name);
    candidates.push({ path, modified: (await stat(path)).mtimeMs });
  }
  candidates.sort((left, right) => right.modified - left.modified);
  if (candidates.length === 0) throw new Error("The packaged app produced no STL in Downloads.");
  return candidates[0].path;
}

async function scanUserFiles(roots, needle, startedAt) {
  const matches = [];
  const unreadable = [];
  let filesScanned = 0;
  let bytesScanned = 0;
  let filesWrittenDuringJourney = 0;
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      unreadable.push({ path: directory, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const metadata = await stat(path);
        filesScanned += 1;
        bytesScanned += metadata.size;
        if (metadata.mtimeMs >= startedAt - 1_000 || metadata.birthtimeMs >= startedAt - 1_000) {
          filesWrittenDuringJourney += 1;
        }
        if (await scanFileForBytes(path, needle)) matches.push(path);
      } catch (error) {
        unreadable.push({ path, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  for (const root of roots) await walk(root);
  return { roots, filesScanned, bytesScanned, filesWrittenDuringJourney, matches, unreadable };
}

async function setExportFormat(client, value) {
  const selected = await client.execute(`
    const control = document.querySelector('.project-export-dialog select');
    if (!(control instanceof HTMLSelectElement)) return null;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter.call(control, arguments[0]);
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return control.value;
  `, [value]);
  if (selected !== value) throw new Error(`Could not select export format ${value}.`);
}

async function visibleAlerts(client) {
  const alerts = await client.execute(`
    return [...document.querySelectorAll('[role="alert"]')]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.textContent.trim());
  `);
  return Array.isArray(alerts) ? alerts : [];
}

async function visibleRenderFailure(client) {
  const observation = await client.execute(`
    const status = document.querySelector('.status-render');
    const badge = document.querySelector('.viewer-error-badge');
    if (!(status instanceof HTMLElement && status.getClientRects().length > 0)
      || !(badge instanceof HTMLButtonElement && badge.getClientRects().length > 0)) return null;
    return {
      status: { text: status.textContent.trim() },
      viewerBadge: {
        text: badge.textContent.trim(),
        ariaLabel: badge.getAttribute('aria-label') ?? '',
      },
    };
  `);
  return observation;
}

async function openDesktopProject(client, projectDirectory, expectedSource) {
  const projectLocatorVisible = async () => (await client.execute(`
    const form = document.querySelector('.project-locator-form');
    return Boolean(form && form.getClientRects().length > 0);
  `)) === true;
  if (!(await projectLocatorVisible())) await clickAria(client, "Files");
  await waitFor(projectLocatorVisible, "visible project-folder control", 15_000, 100);
  await setControl(client, "Project folder path", projectDirectory);
  await waitFor(async () => (await client.execute(`
    const button = document.querySelector('.project-locator-form button[type="submit"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  `)) === true, "enabled project-locator submit", 15_000, 100);
  const projectSubmitted = await client.execute(`
    const form = document.querySelector('.project-locator-form');
    const button = form?.querySelector('button[type="submit"]');
    if (!(form instanceof HTMLFormElement)
      || !(button instanceof HTMLButtonElement && !button.disabled)) return false;
    form.requestSubmit(button);
    return true;
  `);
  assert.equal(projectSubmitted, true, "The enabled project-locator form could not be submitted.");
  const projectOpenOutcome = await waitFor(async () => {
    if ((await bodyText(client)).includes("Confirm project replacement")) return { kind: "dialog" };
    const alerts = await visibleAlerts(client);
    return alerts.length > 0 ? { kind: "error", alerts } : false;
  }, "project replacement dialog or visible project error", 15_000, 100);
  assert.deepEqual(
    projectOpenOutcome,
    { kind: "dialog" },
    `Project fixture failed to open: ${JSON.stringify(projectOpenOutcome)}`,
  );
  await clickButton(client, "Confirm project replacement");
  await waitFor(
    async () => (await editorSource(client)) === expectedSource,
    "project source after open",
    30_000,
    100,
  );
}

const args = parseArguments(process.argv.slice(2));
await mkdir(args.output, { recursive: true });
const startedAt = Date.now();
const events = [];
const evidence = {
  schemaVersion: 1,
  startedAt: new Date(startedAt).toISOString(),
  status: "running",
  events,
};
let driver = null;
let client = null;
let mcpClient = null;
let m4McpClient = null;
let m4ProviderMock = null;
let lastVerifiedAppProcess = null;

async function persist() {
  await writeFile(join(args.output, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}

async function record(name, details = {}) {
  const event = { name, observedAt: new Date().toISOString(), ...details };
  events.push(event);
  console.log(JSON.stringify(event));
  await persist();
}

try {
  const engineSha256 = await fileSha256(args.engine);
  assert.equal(engineSha256, EXPECTED_ENGINE_SHA256, "Pinned OpenSCAD executable hash mismatch.");
  const engineInfo = await run(args.engine, ["--info"], { timeoutMs: 30_000 });
  const engineOutput = `${engineInfo.stdout}\n${engineInfo.stderr}`;
  assert.match(engineOutput, /OpenSCAD Version:\s*2026\.06\.12 \(git 0a66508c\)/u);
  const appSha256 = await fileSha256(args.app);
  const sourceMetadata = parseSourceMetadata(await readFile(args["source-metadata"], "utf8"), appSha256);
  const harnessManifestBytes = await readFile(args["harness-manifest"]);
  const harnessManifest = validateHarnessManifest(JSON.parse(harnessManifestBytes.toString("utf8").replace(/^\uFEFF/u, "")));
  const harnessRoot = dirname(args["harness-manifest"]);
  const verifiedHarnessFiles = {};
  for (const [role, entry] of Object.entries(harnessManifest.files)) {
    const path = resolve(harnessRoot, entry.path);
    const sha256 = await fileSha256(path);
    assert.equal(sha256, entry.sha256.toUpperCase(), `Harness ${role} hash mismatch.`);
    verifiedHarnessFiles[role] = { path, sha256 };
  }
  const sandboxPolicy = validateSandboxConfig(await readFile(verifiedHarnessFiles.config.path, "utf8"));
  assert.deepEqual(sandboxPolicy, harnessManifest.policy, "Sandbox config and manifest policy differ.");
  const executingRunner = fileURLToPath(import.meta.url);
  const executedHarnessFiles = {
    runner: executingRunner,
    helper: join(dirname(executingRunner), "lib", "packaged-desktop-evidence.mjs"),
    m4PackagedWalkthrough: join(dirname(executingRunner), "lib", "m4-packaged-walkthrough.mjs"),
    m4PackagedVerifier: join(dirname(executingRunner), "lib", "m4-packaged-verifier.mjs"),
    credentialProbe: args["credential-probe"],
    sandboxBootstrap: join(dirname(executingRunner), "run-packaged-desktop-sandbox.ps1"),
    sourceMetadata: args["source-metadata"],
    n2SoakConfiguration: args["soak-config"],
    n2SoakEvidence: join(dirname(executingRunner), "lib", "n2-soak-evidence.mjs"),
    n2SoakRunner: join(dirname(executingRunner), "lib", "n2-soak-runner.mjs"),
    n2SoakVerifier: join(dirname(executingRunner), "lib", "n2-soak-verifier.mjs"),
  };
  for (const [role, path] of Object.entries(executedHarnessFiles)) {
    assert.equal(await fileSha256(path), harnessManifest.files[role].sha256.toUpperCase(), `Executed harness ${role} hash mismatch.`);
  }
  const tauriDriverSha256 = await fileSha256(args["tauri-driver"]);
  assert.equal(tauriDriverSha256, EXPECTED_TAURI_DRIVER_SHA256, "tauri-driver 2.0.6 hash mismatch.");
  const tauriDriverHelp = await run(args["tauri-driver"], ["--help"]);
  assert.match(tauriDriverHelp.stdout, /USAGE:\s+tauri-driver \[FLAGS\] \[OPTIONS\]/u);
  const visualCppRuntime = join(dirname(args["tauri-driver"]), "vcruntime140.dll");
  const visualCppRuntimeSha256 = await fileSha256(visualCppRuntime);
  assert.equal(visualCppRuntimeSha256, EXPECTED_VCRUNTIME_SHA256, "Visual C++ runtime hash mismatch.");
  const visualCppRuntimeCompanion = join(dirname(args["tauri-driver"]), "vcruntime140_1.dll");
  const visualCppRuntimeCompanionSha256 = await fileSha256(visualCppRuntimeCompanion);
  assert.equal(
    visualCppRuntimeCompanionSha256,
    EXPECTED_VCRUNTIME_COMPANION_SHA256,
    "Visual C++ runtime companion hash mismatch.",
  );
  const nodeSha256 = await fileSha256(process.execPath);
  const nodeMajor = Number(/^v(\d+)\./u.exec(process.version)?.[1]);
  assert.ok(Number.isSafeInteger(nodeMajor) && nodeMajor >= 24, `Node.js 24+ is required, found ${process.version}.`);
  const nativeDriverSha256 = await fileSha256(args["native-driver"]);
  assert.equal(nativeDriverSha256, EXPECTED_EDGE_DRIVER_SHA256, "Microsoft EdgeDriver hash mismatch.");
  const webViewExecutable = join(args.webview, "msedgewebview2.exe");
  const webViewSha256 = await fileSha256(webViewExecutable);
  assert.equal(webViewSha256, EXPECTED_WEBVIEW_SHA256, "Fixed WebView2 executable hash mismatch.");
  const nativeDriverVersion = await run(args["native-driver"], ["--version"]);
  assert.match(nativeDriverVersion.stdout, /Microsoft Edge WebDriver 150\.0\.4078\.65/u);
  await record("artifacts-verified", {
    app: { path: args.app, sha256: appSha256 },
    source: sourceMetadata,
    node: { path: process.execPath, sha256: nodeSha256, version: process.version },
    visualCppRuntime: {
      path: visualCppRuntime,
      sha256: visualCppRuntimeSha256,
      companionPath: visualCppRuntimeCompanion,
      companionSha256: visualCppRuntimeCompanionSha256,
    },
    harness: {
      manifestPath: args["harness-manifest"],
      manifestSha256: fingerprint(harnessManifestBytes),
      files: verifiedHarnessFiles,
      executedFiles: executedHarnessFiles,
      policy: harnessManifest.policy,
    },
    engine: { path: args.engine, sha256: engineSha256, version: EXPECTED_ENGINE_VERSION },
    tauriDriver: { path: args["tauri-driver"], sha256: tauriDriverSha256, version: "2.0.6" },
    nativeDriver: { path: args["native-driver"], sha256: nativeDriverSha256, version: "150.0.4078.65" },
    webView: { path: args.webview, executableSha256: webViewSha256, version: "150.0.4078.65" },
  });

  const credentialBefore = await probeCredential(args["credential-probe"], false);
  assert.equal(credentialBefore.lastError, ERROR_NOT_FOUND);
  await record("credential-absent-on-fresh-profile", credentialBefore);

  const webView = await installedWebViewVersion();
  await record("sandbox-webview-runtime-detected", webView);
  assert.equal(webView.version, null, "The fresh Sandbox unexpectedly has a registered WebView2 runtime.");
  await record("fixed-webview-runtime-selected", {
    path: args.webview,
    executableSha256: webViewSha256,
    version: "150.0.4078.65",
    userDataFolder: join(process.env.LOCALAPPDATA, "dev.scadmill.desktop"),
  });

  driver = await startDriver(args["tauri-driver"], args["native-driver"], args.output, 1);
  client = new WebDriverClient(DRIVER_URL, args["keyboard-input"]);
  const capabilities = await client.createSession(args.app, args.webview);
  await waitForBody(client, "ScadMill");
  await waitForBody(client, "Configure engine");
  lastVerifiedAppProcess = await requireSingleAppProcess(args.app, appSha256);
  await record("fresh-release-executable-started", {
    pid: lastVerifiedAppProcess.pid,
    executablePath: lastVerifiedAppProcess.path,
    startedAt: lastVerifiedAppProcess.startedAt,
    capabilities,
    devToolsPortMirror: client.lastPortMirror,
  });

  await clickButton(client, "Configure engine");
  await setControl(client, "OpenSCAD executable path", args.engine);
  await clickButton(client, "Save and retry");
  await waitForBody(client, `OpenSCAD ${EXPECTED_ENGINE_VERSION}`, 60_000);
  await waitFor(async () => (await client.execute(`
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === 'Render preview');
    return Boolean(button && !button.disabled);
  `)) === true, "enabled render controls", 30_000, 100);
  await record("exact-pinned-engine-enabled", { configuredPath: args.engine });
  await dismissWelcome(client);

  const cubeSource = "cube([10, 10, 10]);";
  await waitFor(
    async () => Boolean(await client.find(PACKAGED_WORKBENCH_EDITOR_SELECTOR).catch(() => null)),
    "focused workbench CodeMirror editor",
    30_000,
    100,
  );
  await replaceEditorSource(client, cubeSource);
  await clickButton(client, "Full render");
  await waitForBody(client, "10 × 10 × 10 mm", 60_000);
  await waitForBody(client, "Rendered Untitled (3d)", 60_000);
  await client.screenshot(join(args.output, "01-cube-render.png"));
  await record("cube-rendered", { sourceSha256: fingerprint(cubeSource), boundsMm: [10, 10, 10] });

  await clickButton(client, "Export…");
  await waitForBody(client, "Exports always render full-quality geometry.");
  await setExportFormat(client, "stl-binary");
  await clickButton(client, "Export model");
  await waitForBody(client, "Export saved", 60_000);
  const downloads = join(process.env.USERPROFILE, "Downloads");
  const exportedStl = await latestStl(downloads);
  const stlBytes = await readFile(exportedStl);
  const stlEvidence = parseBinaryStl(stlBytes);
  assert.equal(stlEvidence.triangleCount, 12);
  assert.deepEqual(stlEvidence.bounds.size, [10, 10, 10]);
  await cp(exportedStl, join(args.output, "cube-export.stl"));
  await record("binary-stl-export-verified", {
    sourcePath: exportedStl,
    sha256: fingerprint(stlBytes),
    byteLength: stlBytes.byteLength,
    ...stlEvidence,
  });

  assert.deepEqual(await mcpEndpointsForProcess(args.app, lastVerifiedAppProcess.pid), []);
  validateMcpListenerObservation(
    await tcpListenersForProcess(lastVerifiedAppProcess.pid),
    false,
  );
  await record("mcp-default-off-process-inspection-passed", {
    applicationPid: lastVerifiedAppProcess.pid,
    endpointManifestPresent: false,
    ownedListeners: [],
  });

  await clickAria(client, "Open settings");
  await setControl(client, "Search settings", "AI");
  await setControl(client, "MCP write-file permission", "allow-session");
  await clickAria(client, "Enable local MCP server (stdio)");
  const endpointRecord = await waitFor(async () => {
    const found = await mcpEndpointsForProcess(args.app, lastVerifiedAppProcess.pid);
    return found.length === 1 ? found[0] : false;
  }, "one authenticated MCP endpoint manifest", 15_000, 100);
  await record("mcp-endpoint-manifest-validated", {
    manifestPathSha256: fingerprint(endpointRecord.path),
    manifestSha256: await fileSha256(endpointRecord.path),
    endpoint: sanitizeMcpEndpointManifest(endpointRecord.endpoint),
  });
  await clickAria(client, "Close settings");

  mcpClient = new McpStdioClient(args.app);
  const twoAppProcesses = await waitFor(async () => {
    const found = await exactExecutableProcesses(args.app);
    return found.length === 2 ? found : false;
  }, "GUI and MCP relay ScadMill processes", 15_000, 100);
  for (const processRecord of twoAppProcesses) {
    assert.equal(await fileSha256(processRecord.path), appSha256, "MCP process executable hash mismatch.");
  }
  const relayProcess = twoAppProcesses.find(({ pid }) => pid !== lastVerifiedAppProcess.pid);
  assert.ok(relayProcess, "The exact MCP relay child process was not distinguishable from the GUI.");

  const initialize = await mcpClient.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "scadmill-packaged-evidence", version: "1" },
  });
  assert.equal(initialize?.protocolVersion, "2025-11-25");
  assert.equal(initialize?.serverInfo?.name, "scadmill");
  mcpClient.notify("notifications/initialized");
  assert.deepEqual(await mcpClient.request("ping"), {});

  const toolsResult = await mcpClient.request("tools/list");
  assert.equal(toolsResult?.tools?.length, 10, "MCP tools/list did not return the ten Appendix B tools.");
  assert.deepEqual(
    toolsResult.tools.map(({ name }) => name).sort(),
    ["export_model", "get_diagnostics", "get_history", "get_parameters", "list_files", "read_file", "render_preview", "set_parameters", "take_screenshot", "write_file"],
  );
  for (const tool of toolsResult.tools) {
    assert.equal(tool.inputSchema?.type, "object", `${tool.name} did not expose an object input schema.`);
  }

  const listed = structuredMcpToolResult(
    await mcpClient.request("tools/call", { name: "list_files", arguments: {} }),
    "list_files",
  );
  assert.deepEqual(listed.files.map(({ path }) => path), ["Untitled"]);
  const mcpPath = listed.files[0].path;
  const preview = structuredMcpToolResult(
    await mcpClient.request("tools/call", { name: "render_preview", arguments: { path: mcpPath } }),
    "render_preview",
  );
  assert.equal(preview.kind, "3d");
  assert.equal(preview.stats?.triangles, 12);
  const diagnostics = structuredMcpToolResult(
    await mcpClient.request("tools/call", { name: "get_diagnostics", arguments: { path: mcpPath } }),
    "get_diagnostics",
  );
  assert.equal(diagnostics.quality, "preview");
  assert.ok(Array.isArray(diagnostics.diagnostics));

  await clickAria(client, "History");
  const proposedSource = "cube([12, 10, 10]);";
  const pending = structuredMcpToolResult(
    await mcpClient.request("tools/call", {
      name: "write_file",
      arguments: { path: mcpPath, content: proposedSource },
    }),
    "write_file",
  );
  assert.equal(pending.status, "pending_review");
  assert.match(pending.commandId, /^mcp-review-/u);
  await waitForBody(client, "MCP file change: Untitled");
  await waitForBody(client, "Pending review");
  assert.deepEqual(await mcpDiffSources(client), { local: cubeSource, proposed: proposedSource });
  await client.screenshot(join(args.output, "02-mcp-pending-diff.png"));
  await writeFile(
    join(args.output, "mcp-transcript.json"),
    `${JSON.stringify(sanitizeMcpTranscript(mcpClient.transcript, endpointRecord.endpoint.token), null, 2)}\n`,
  );
  await record("mcp-appendix-b-walkthrough-passed", {
    guiPid: lastVerifiedAppProcess.pid,
    relayPid: relayProcess.pid,
    protocolVersion: initialize.protocolVersion,
    toolCount: toolsResult.tools.length,
    path: mcpPath,
    preview: { kind: preview.kind, triangles: preview.stats.triangles },
    diagnostics: { quality: diagnostics.quality, count: diagnostics.diagnostics.length },
    pendingReview: { status: pending.status, commandIdSha256: fingerprint(pending.commandId) },
    transcriptSha256: await fileSha256(join(args.output, "mcp-transcript.json")),
  });
  await clickButton(client, "Deny change");

  await clickAria(client, "Open settings");
  await setControl(client, "Search settings", "AI");
  await clickAria(client, "Enable local MCP server (stdio)");
  await clickAria(client, "Close settings");
  assert.equal(await mcpClient.waitForExit(), 0, `MCP relay exited with stderr: ${mcpClient.stderrText()}`);
  mcpClient = null;
  await waitFor(async () => (await mcpEndpointsForProcess(args.app, lastVerifiedAppProcess.pid)).length === 0, "MCP manifest removal", 15_000, 100);
  await waitFor(async () => (await exactExecutableProcesses(args.app)).length === 1, "MCP relay process shutdown", 15_000, 100);
  await waitFor(async () => !(await tcpEndpointReachable(endpointRecord.endpoint)), "MCP endpoint refusal", 15_000, 100);
  const listenersAfterDisable = await tcpListenersForProcess(lastVerifiedAppProcess.pid);
  validateMcpListenerObservation(listenersAfterDisable, false);
  await record("mcp-toggle-off-process-inspection-passed", {
    applicationPid: lastVerifiedAppProcess.pid,
    endpointManifestPresent: false,
    ownedListeners: listenersAfterDisable,
    endpointReachable: false,
    relayExited: true,
  });

  const n2SoakConfiguration = JSON.parse(await readFile(args["soak-config"], "utf8"));
  const n2SoakSummary = await runN2Soak({
    configuration: n2SoakConfiguration,
    output: args.output,
    paths: {
      application: args.app,
      engine: args.engine,
      webView: webViewExecutable,
    },
    hashes: {
      application: appSha256,
      engine: engineSha256,
      webView: webViewSha256,
    },
    guiIdentity: lastVerifiedAppProcess,
    restoreSource: cubeSource,
    restoreBoundsText: "10 × 10 × 10 mm",
    automation: {
      now: () => Date.now(),
      delay,
      replaceEditorSource: (source) => replaceEditorSource(client, source),
      readEditorSource: () => editorSource(client),
      ensureConsoleVisible: async () => {
        const opened = await client.execute(`
          const button = document.querySelector('.status-diagnostics');
          const consolePanel = document.querySelector('.diagnostic-console');
          if (!(button instanceof HTMLButtonElement)) return false;
          if (button.getAttribute('aria-pressed') !== 'true'
            || !(consolePanel instanceof HTMLElement && consolePanel.getClientRects().length > 0)) {
            button.click();
          }
          return true;
        `);
        assert.equal(opened, true, "N-2 could not find the Console status control.");
        await waitFor(async () => await client.execute(`
          const panel = document.querySelector('.diagnostic-console');
          return panel instanceof HTMLElement && panel.getClientRects().length > 0;
        `), "visible N-2 Console", 15_000, 50);
      },
      consoleRunSnapshot: () => client.execute(`
        const runs = [...document.querySelectorAll('.diagnostic-console .console-run')];
        return { count: runs.length };
      `),
      startPreview: () => clickButton(client, "Render preview"),
      startCrashRender: () => clickButton(client, "Full render"),
      waitForRenderSuccess: async (boundsText, priorRun) => {
        const completedRun = await waitFor(async () => {
          const snapshot = await client.execute(`
            const runs = [...document.querySelectorAll('.diagnostic-console .console-run')];
            return { count: runs.length, label: runs.at(-1)?.getAttribute('aria-label') ?? '' };
          `);
          if (snapshot.count > priorRun.count + 1) {
            throw new Error("N-2 observed more than one new Console run for one preview request.");
          }
          return snapshot.count === priorRun.count + 1
            && snapshot.label.includes('exit 0')
            ? snapshot
            : false;
        }, "one new successful N-2 Console run", 60_000, 50);
        await waitForBody(client, boundsText, 60_000);
        await waitForBody(client, "Rendered Untitled (3d)", 60_000);
        return completedRun;
      },
      waitForRenderFailure: (priorRun) => waitFor(async () => {
        const snapshot = await client.execute(`
          const runs = [...document.querySelectorAll('.diagnostic-console .console-run')];
          return { count: runs.length, label: runs.at(-1)?.getAttribute('aria-label') ?? '' };
        `);
        if (snapshot.count > priorRun.count + 1) {
          throw new Error("N-2 observed more than one new Console run for the crash request.");
        }
        const failure = await visibleRenderFailure(client);
        return snapshot.count === priorRun.count + 1
          && snapshot.label.startsWith('Untitled · full · ')
          && !snapshot.label.includes('running')
          && !snapshot.label.includes('exit 0')
          && failure?.status?.text === 'Render failed for Untitled'
          && failure?.viewerBadge?.text === 'Render failed; last successful model shown'
          && failure?.viewerBadge?.ariaLabel === 'Show render error in console'
          ? { consoleRun: snapshot, ...failure }
          : false;
      }, "visible N-2 render failure proof", 60_000, 50),
      visibleAlerts: () => visibleAlerts(client),
      exactExecutableProcesses,
      fileSha256,
      killProcess: (pid) => process.kill(pid),
      waitFor,
    },
  });
  if (n2SoakSummary) {
    await record(
      n2SoakSummary.configuration.releaseEvidenceEligible
        ? "n2-literal-one-hour-soak-passed"
        : "n2-accelerated-non-release-soak-passed",
      {
        releaseEvidenceEligible: n2SoakSummary.configuration.releaseEvidenceEligible,
        evidenceLabel: n2SoakSummary.configuration.evidenceLabel,
        durationSeconds: n2SoakSummary.durationSeconds,
        successfulCycles: n2SoakSummary.cycles.successful,
        finalMemoryRatio: n2SoakSummary.memory.finalRatio,
        summarySha256: await fileSha256(join(args.output, "n2-soak-summary.json")),
        samplesSha256: n2SoakSummary.samples.sha256,
      },
    );
  } else {
    await record("n2-soak-disabled", { releaseEvidenceEligible: false });
  }

  const m4InitialSource = "cube([10, 10, 10]);";
  const m4ProposalSource = "cube([12, 10, 10]);\n";
  const m4AgentSource = "cube([14, 10, 10]);\n";
  const m4McpSource = "cube([16, 10, 10]);";
  const m4ProjectDirectory = join(process.env.USERPROFILE, "Documents", "ScadMillM4Walkthrough");
  const m4ProjectFile = join(m4ProjectDirectory, "main.scad");
  const m4Secret = `SCADMILL-M4-LOCAL-${randomBytes(24).toString("hex")}`;
  const m4SecretBytes = Buffer.from(m4Secret);
  const m4SecretSha256 = fingerprint(m4SecretBytes);
  await mkdir(m4ProjectDirectory, { recursive: true });
  await writeFile(m4ProjectFile, m4InitialSource, "utf8");
  await openDesktopProject(client, m4ProjectDirectory, m4InitialSource);
  assert.equal(await readFile(m4ProjectFile, "utf8"), m4InitialSource);
  await clearDiagnosticConsole(client);
  lastVerifiedAppProcess = await requireSingleAppProcess(args.app, appSha256);
  let m4EndpointRecord = null;
  let m4McpLocalSource = null;

  const m4Evidence = await runM4PackagedWalkthrough({
    initialSource: m4InitialSource,
    proposalSource: m4ProposalSource,
    agentSource: m4AgentSource,
    projectPath: "main.scad",
    cachePaintLimitMs: 100,
    aiConversationMode: "hosted-plus-manual",
    automation: {
      readSource: () => editorSource(client),
      replaceSource: (source) => replaceEditorSource(client, source),
      waitForSource: (source) => waitFor(
        async () => (await editorSource(client)) === source,
        `exact M4 source ${fingerprint(source)}`,
        30_000,
        50,
      ),
      activateRail: (title) => activateRail(client, title),
      clickAria: (label) => clickAria(client, label),
      clickButton: (label) => clickButton(client, label),
      setControl: (label, value) => setControl(client, label, value),
      setChecked: (label, checked) => setChecked(client, label, checked),
      waitForText: (text) => waitForBody(client, text, 60_000),
      execute: (script, values = []) => client.execute(script, values),
      executeAsync: (script, values = []) => client.executeAsync(script, values),
      captureScreenshot: async (name) => {
        const bytes = await client.screenshotBytes();
        await writeFile(join(args.output, name), bytes);
        return bytes;
      },
      startAiMock: async (plan) => {
        assert.equal(m4ProviderMock, null, "M4 local-provider mock was already running.");
        m4ProviderMock = await startScriptedM4LocalProviderMock({ ...plan, secret: m4Secret });
        return {
          endpoint: m4ProviderMock.endpoint,
          model: m4ProviderMock.model,
          secret: m4ProviderMock.secret,
        };
      },
      stopAiMock: async () => {
        assert.ok(m4ProviderMock, "M4 local-provider mock was not running.");
        const transcript = await m4ProviderMock.close();
        m4ProviderMock = null;
        return transcript;
      },
      probeMcpDefaultDeny: async () => {
        await clickAria(client, "Open settings");
        await setControl(client, "Search settings", "AI");
        await setControl(client, "MCP write-file permission", "deny");
        await setChecked(client, "Enable local MCP server (stdio)", true);
        m4EndpointRecord = await waitFor(async () => {
          const found = await mcpEndpointsForProcess(args.app, lastVerifiedAppProcess.pid);
          return found.length === 1 ? found[0] : false;
        }, "M4 default-deny MCP endpoint", 15_000, 100);
        await clickAria(client, "Close settings");
        m4McpClient = new McpStdioClient(args.app);
        await waitFor(async () => (await exactExecutableProcesses(args.app)).length === 2, "M4 MCP relay process", 15_000, 100);
        const initialize = await m4McpClient.request("initialize", {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "scadmill-m4-packaged-walkthrough", version: "1" },
        });
        assert.equal(initialize?.protocolVersion, "2025-11-25");
        m4McpClient.notify("notifications/initialized");
        const sourceBefore = await editorSource(client);
        assert.equal(typeof sourceBefore, "string", "M4 MCP source precondition was unavailable.");
        m4McpLocalSource = sourceBefore;
        const denied = await m4McpClient.requestRaw("tools/call", {
          name: "write_file",
          arguments: { path: "main.scad", content: m4McpSource },
        });
        return {
          error: denied.error,
          writeOccurred: (await editorSource(client)) !== sourceBefore,
        };
      },
      runMcpAllowSessionJourney: async () => {
        assert.ok(m4McpClient && m4EndpointRecord, "M4 MCP default-deny lifecycle did not initialize.");
        await clickAria(client, "Open settings");
        await setControl(client, "Search settings", "AI");
        await setControl(client, "MCP write-file permission", "allow-session");
        await clickAria(client, "Close settings");
        const toolsResult = await m4McpClient.request("tools/list");
        const listed = structuredMcpToolResult(
          await m4McpClient.request("tools/call", { name: "list_files", arguments: {} }),
          "M4 list_files",
        );
        assert.deepEqual(listed.files.map(({ path }) => path), ["main.scad"]);
        const preview = structuredMcpToolResult(
          await m4McpClient.request("tools/call", { name: "render_preview", arguments: { path: "main.scad" } }),
          "M4 render_preview",
        );
        const diagnostics = structuredMcpToolResult(
          await m4McpClient.request("tools/call", { name: "get_diagnostics", arguments: { path: "main.scad" } }),
          "M4 get_diagnostics",
        );
        const pending = structuredMcpToolResult(
          await m4McpClient.request("tools/call", {
            name: "write_file",
            arguments: { path: "main.scad", content: m4McpSource },
          }),
          "M4 write_file",
        );
        assert.equal(pending.status, "pending_review");
        await activateRail(client, "History");
        await waitForBody(client, "Pending review");
        assert.equal(typeof m4McpLocalSource, "string", "M4 MCP source precondition was not retained.");
        assert.deepEqual(await mcpDiffSources(client), { local: m4McpLocalSource, proposed: m4McpSource });
        await clickButton(client, "Approve change");
        await waitFor(async () => (await editorSource(client)) === m4McpSource, "approved M4 MCP source", 15_000, 50);
        await clickAria(client, "Open settings");
        await setControl(client, "Search settings", "AI");
        await setChecked(client, "Enable local MCP server (stdio)", false);
        await clickAria(client, "Close settings");
        assert.equal(await m4McpClient.waitForExit(), 0, `M4 MCP relay exited with stderr: ${m4McpClient.stderrText()}`);
        m4McpClient = null;
        await waitFor(async () => (await mcpEndpointsForProcess(args.app, lastVerifiedAppProcess.pid)).length === 0, "M4 MCP manifest removal", 15_000, 100);
        await waitFor(async () => !(await tcpEndpointReachable(m4EndpointRecord.endpoint)), "M4 MCP endpoint refusal", 15_000, 100);
        m4EndpointRecord = null;
        m4McpLocalSource = null;
        return {
          protocolVersion: "2025-11-25",
          toolNames: toolsResult.tools.map(({ name }) => name),
          preview: { kind: preview.kind, triangles: preview.stats.triangles },
          diagnostics: { quality: diagnostics.quality, count: diagnostics.diagnostics.length },
          pendingReview: { status: pending.status },
          mutationApproved: true,
        };
      },
      restartApplication: async (expectedSource, expectedProjectPath) => {
        await activateRail(client, "Files");
        const savedSource = await editorSource(client);
        assert.equal(savedSource, expectedSource, "M4 restart source differs from the helper's cold-cache source.");
        assert.notEqual(await readFile(m4ProjectFile, "utf8"), expectedSource, "M4 cold-cache source reached disk before the explicit save.");
        await clickButton(client, "Save active file");
        await waitFor(async () => (await readFile(m4ProjectFile, "utf8")) === expectedSource, "saved M4 source before restart", 15_000, 50);
        const before = lastVerifiedAppProcess;
        const priorWebViews = await requireExactExecutableProcesses(webViewExecutable, webViewSha256, "M4 WebView processes before restart");
        const beforeCloseThumbnail = await readPersistedThumbnail(client, expectedProjectPath, "immediately before process exit");
        const beforeCloseRenderCache = await client.executeAsync(M4_DOM_SCRIPTS.renderCacheStorageSnapshot);
        await client.deleteSession();
        client = null;
        await waitForNoAppProcess(args.app);
        await waitForNoExactExecutableProcess(webViewExecutable, "M4 WebView process exit before restart");
        client = new WebDriverClient(DRIVER_URL, args["keyboard-input"]);
        await client.createSession(args.app, args.webview);
        await waitForBody(client, `OpenSCAD ${EXPECTED_ENGINE_VERSION}`, 60_000);
        await assertWelcomeStaysDisabled(client);
        const after = await requireSingleAppProcess(args.app, appSha256);
        const nextWebViews = await requireExactExecutableProcesses(webViewExecutable, webViewSha256, "M4 WebView processes after restart");
        const persistedThumbnail = await readPersistedThumbnail(client, expectedProjectPath, "before project reopen");
        const afterRestartRenderCache = await client.executeAsync(M4_DOM_SCRIPTS.renderCacheStorageSnapshot);
        await openDesktopProject(client, m4ProjectDirectory, expectedSource);
        const afterOpenRenderCache = await client.executeAsync(M4_DOM_SCRIPTS.renderCacheStorageSnapshot);
        await client.execute(`
          globalThis.__scadmillM4RenderCacheDiagnostic = arguments[0];
          return true;
        `, [{
          beforeClose: beforeCloseRenderCache,
          afterRestart: afterRestartRenderCache,
          afterOpen: afterOpenRenderCache,
        }]);
        assert.ok(nextWebViews.every(({ pid }) => !priorWebViews.some((prior) => prior.pid === pid)), "M4 restart retained a WebView process.");
        lastVerifiedAppProcess = after;
        return {
          beforePid: before.pid,
          afterPid: after.pid,
          freshWebViewProcesses: true,
          beforeCloseThumbnailSha256: beforeCloseThumbnail.sha256,
          beforeCloseThumbnailRenderIdentity: beforeCloseThumbnail.renderIdentity,
          persistedThumbnailSha256: persistedThumbnail.sha256,
          persistedThumbnailRenderIdentity: persistedThumbnail.renderIdentity,
        };
      },
    },
  });
  const m4EvidencePath = join(args.output, "m4-packaged-walkthrough.json");
  await writeFile(m4EvidencePath, `${JSON.stringify(m4Evidence, null, 2)}\n`);
  await record("m4-packaged-newcomer-walkthrough-passed", {
    evidencePath: m4EvidencePath,
    evidenceSha256: await fileSha256(m4EvidencePath),
    requestCount: m4Evidence.ai.requestCount,
    cachePaintMs: m4Evidence.cache.elapsedMs,
    coldCachePaintMs: m4Evidence.cache.coldElapsedMs,
    screenshotCount: m4Evidence.screenshots.length,
    secretSha256: m4SecretSha256,
  });
  await activateRail(client, "Files");
  assert.equal(await editorSource(client), m4InitialSource, "M4 helper did not restore the initial source before cleanup.");
  await clickButton(client, "Save active file");
  await waitFor(async () => (await readFile(m4ProjectFile, "utf8")) === m4InitialSource, "restored M4 source saved before cleanup", 15_000, 50);

  await clickAria(client, "Open settings");
  await setControl(client, "Search settings", "AI");
  if (m4Evidence.ai.mode === "hosted-plus-manual") {
    assert.equal(await inputValue(client, "AI API key"), "", "Packaged native-only M4 journey unexpectedly stored an AI key.");
    assert.equal(await inputValue(client, "AI provider"), "none", "Packaged native-only M4 journey changed the AI provider.");
  } else {
    await waitFor(async () => (await inputValue(client, "AI API key")) === m4Secret, "M4 AI key before clear", 15_000, 100);
    await clickButton(client, "Clear AI key");
    await waitForBody(client, "AI key cleared.");
    await setControl(client, "AI provider", "none");
  }
  await clickAria(client, "Close settings");
  const m4CredentialAbsent = await probeCredential(args["credential-probe"], false);
  assert.equal(m4CredentialAbsent.lastError, ERROR_NOT_FOUND);
  await client.deleteSession();
  client = null;
  await waitForNoAppProcess(args.app);
  await waitForNoExactExecutableProcess(webViewExecutable, "M4 WebView process exit before secret scan");
  const m4AppDataRoot = process.env.APPDATA;
  const m4LocalAppDataRoot = process.env.LOCALAPPDATA;
  assert.ok(m4AppDataRoot && m4LocalAppDataRoot);
  const m4SecretScan = await scanUserFiles(
    [m4AppDataRoot, m4LocalAppDataRoot, m4ProjectDirectory, args.output],
    m4SecretBytes,
    startedAt,
  );
  assert.deepEqual(m4SecretScan.matches, [], `M4 helper secret leaked into: ${m4SecretScan.matches.join(", ")}`);
  const m4Unreadable = m4SecretScan.unreadable.filter(({ path }) => path.toLowerCase().includes("scadmill"));
  assert.deepEqual(m4Unreadable, [], `Could not scan M4 app-managed files: ${JSON.stringify(m4Unreadable)}`);
  await record("m4-ai-sensitive-state-scanned", {
    credential: m4CredentialAbsent,
    roots: m4SecretScan.roots,
    filesScanned: m4SecretScan.filesScanned,
    bytesScanned: m4SecretScan.bytesScanned,
    matches: m4SecretScan.matches,
    unreadableAppFiles: m4Unreadable,
    secretSha256: m4SecretSha256,
  });
  const finalM4Verification = await verifyM4PackagedArtifacts({
    walkthroughPath: m4EvidencePath,
    screenshotDirectory: args.output,
    events,
  });
  await record("m4-final-artifacts-verified", finalM4Verification);
  client = new WebDriverClient(DRIVER_URL, args["keyboard-input"]);
  await client.createSession(args.app, args.webview);
  await waitForBody(client, `OpenSCAD ${EXPECTED_ENGINE_VERSION}`, 60_000);
  await assertWelcomeStaysDisabled(client);
  await waitFor(async () => (await editorSource(client)) === cubeSource, "scratch source after M4 cleanup", 30_000, 100);
  lastVerifiedAppProcess = await requireSingleAppProcess(args.app, appSha256);

  await clickAria(client, "Open settings");
  await waitForBody(client, "Search settings");
  await setControl(client, "Search settings", "Editor");
  await setControl(client, "Editor font size", "19");
  await setControl(client, "Search settings", "AI");
  const syntheticSecret = `SCADMILL-OS-CREDENTIAL-${randomBytes(24).toString("hex")}`;
  const syntheticSecretBytes = Buffer.from(syntheticSecret);
  const secretFingerprint = fingerprint(syntheticSecretBytes);
  await waitFor(async () => (await inputValue(client, "AI API key")) !== null, "AI key input", 15_000, 100);
  await setControl(client, "AI API key", syntheticSecret);
  await clickButton(client, "Save AI key");
  await waitForBody(client, "AI key saved.");
  const credentialPresent = await probeCredential(args["credential-probe"], true);
  await record("os-credential-present", { ...credentialPresent, secretSha256: secretFingerprint });
  await clickAria(client, "Close settings");

  const appDataRoot = process.env.APPDATA;
  const localAppDataRoot = process.env.LOCALAPPDATA;
  assert.ok(appDataRoot && localAppDataRoot && process.env.USERPROFILE);
  const secretScanRoots = [appDataRoot, localAppDataRoot, downloads, args.output];
  const settingsFiles = await waitFor(async () => {
    const found = await findFiles(appDataRoot, "settings-v1.json");
    return found.length === 1 ? found : false;
  }, "one desktop settings file", 15_000, 100);
  const settingsSource = await readFile(settingsFiles[0], "utf8");
  const settingsJson = JSON.parse(settingsSource);
  assert.equal(settingsJson.editor.fontSize, 19);
  assert.equal(settingsJson.engine.executablePath, args.engine);
  assert.equal(Buffer.from(settingsSource).includes(syntheticSecretBytes), false);
  await waitFor(async () => {
    const saved = await client.execute(`
      const serialized = localStorage.getItem('scadmill.scratch-autosave.v2');
      if (typeof serialized !== 'string') return null;
      try { return JSON.parse(serialized); } catch { return null; }
    `);
    const recovery = await client.execute("return localStorage.getItem('scadmill.recovery.v1');");
    return saved?.version === 2
      && saved.path === 'Untitled'
      && saved.source === cubeSource
      && recovery === null;
  }, "clean scratch autosave before normal restart", 15_000, 50);
  await record("visible-setting-and-source-persisted", {
    settingsPath: settingsFiles[0],
    editorFontSize: settingsJson.editor.fontSize,
    sourceSha256: fingerprint(cubeSource),
    secretAbsentFromSettings: true,
  });

  await client.deleteSession();
  await waitForNoAppProcess(args.app);
  client = new WebDriverClient(DRIVER_URL, args["keyboard-input"]);
  await client.createSession(args.app, args.webview);
  await waitForBody(client, `OpenSCAD ${EXPECTED_ENGINE_VERSION}`, 60_000);
  await assertWelcomeStaysDisabled(client);
  await waitFor(async () => (await editorSource(client)) === cubeSource, "source after normal restart", 30_000, 100);
  lastVerifiedAppProcess = await requireSingleAppProcess(args.app, appSha256);
  await clickAria(client, "Open settings");
  await setControl(client, "Search settings", "Editor");
  assert.equal(await inputValue(client, "Editor font size"), "19");
  await setControl(client, "Search settings", "AI");
  await waitFor(async () => (await inputValue(client, "AI API key")) === syntheticSecret, "OS credential after restart", 15_000, 100);
  await probeCredential(args["credential-probe"], true);
  await client.screenshot(join(args.output, "02-normal-restart-settings.png"));
  await record("normal-restart-round-trip-verified", {
    pid: lastVerifiedAppProcess.pid,
    sourceSha256: fingerprint(cubeSource),
    editorFontSize: 19,
    secretSha256: secretFingerprint,
    devToolsPortMirror: client.lastPortMirror,
  });
  await clickAria(client, "Close settings");

  await client.deleteSession();
  client = null;
  await waitForNoAppProcess(args.app);
  await driver.stop();
  driver = null;
  const scanWhileSet = await scanUserFiles(secretScanRoots, syntheticSecretBytes, startedAt);
  assert.deepEqual(scanWhileSet.matches, [], `Synthetic credential leaked into: ${scanWhileSet.matches.join(", ")}`);
  const unreadableWhileSet = scanWhileSet.unreadable.filter(({ path }) => path.toLowerCase().includes("scadmill"));
  assert.deepEqual(unreadableWhileSet, [], `Could not scan app-managed files: ${JSON.stringify(unreadableWhileSet)}`);
  await record("recursive-app-file-secret-scan-while-set-passed", {
    roots: scanWhileSet.roots,
    filesScanned: scanWhileSet.filesScanned,
    bytesScanned: scanWhileSet.bytesScanned,
    filesWrittenDuringJourney: scanWhileSet.filesWrittenDuringJourney,
    matches: scanWhileSet.matches,
    unreadableAppFiles: unreadableWhileSet,
    secretSha256: secretFingerprint,
  });

  const recoveryProjectDirectory = join(process.env.USERPROFILE, "Documents", "ScadMillRecoveryFixture");
  const recoveryProjectFile = join(recoveryProjectDirectory, "main.scad");
  await mkdir(recoveryProjectDirectory, { recursive: true });
  await writeFile(recoveryProjectFile, cubeSource, "utf8");
  driver = await startDriver(args["tauri-driver"], args["native-driver"], args.output, 2);
  client = new WebDriverClient(DRIVER_URL, args["keyboard-input"]);
  await client.createSession(args.app, args.webview);
  await waitForBody(client, `OpenSCAD ${EXPECTED_ENGINE_VERSION}`, 60_000);
  await assertWelcomeStaysDisabled(client);
  await openDesktopProject(client, recoveryProjectDirectory, cubeSource);
  assert.equal(await readFile(recoveryProjectFile, "utf8"), cubeSource);
  lastVerifiedAppProcess = await requireSingleAppProcess(args.app, appSha256);
  await probeCredential(args["credential-probe"], true);

  await waitFor(
    async () => (await splitterAriaValue(client, "Resize files panel")) === 260,
    "default project files-panel width",
    15_000,
    100,
  );
  for (const expectedWidth of [268, 276, 284, 292, 300]) {
    const dockSplitter = await client.find('[aria-label="Resize files panel"]');
    await client.sendKeys(dockSplitter, ARROW_RIGHT_KEY);
    await waitFor(
      async () => (await splitterAriaValue(client, "Resize files panel")) === expectedWidth,
      `production keyboard files-panel resize to ${expectedWidth}`,
      5_000,
      50,
    );
  }
  const layoutBeforeRestart = await waitFor(
    () => captureProjectLayoutObservation(client, 300),
    "one exact opaque project layout observation before restart",
    15_000,
    50,
  );
  assert.equal(
    layoutBeforeRestart.serializedLayout.toLowerCase().includes(recoveryProjectDirectory.toLowerCase()),
    false,
    "Packaged layout evidence exposed the raw project path.",
  );
  const applicationBeforeLayoutRestart = lastVerifiedAppProcess;
  const webViewsBeforeLayoutRestart = await requireExactExecutableProcesses(
    webViewExecutable,
    webViewSha256,
    "fixed WebView2 processes before layout restart",
  );
  await client.screenshot(join(args.output, "03a-project-layout-before-restart.png"));
  await record("project-layout-persisted-before-process-restart", {
    dockWidth: layoutBeforeRestart.dockWidth,
    workspaceIdentity: layoutBeforeRestart.workspaceIdentity,
    storageKey: layoutBeforeRestart.storageKey,
    serializedLayout: layoutBeforeRestart.serializedLayout,
    serializedLayoutSha256: fingerprint(layoutBeforeRestart.serializedLayout),
    applicationProcess: {
      pid: applicationBeforeLayoutRestart.pid,
      executablePath: applicationBeforeLayoutRestart.path,
      executableSha256: appSha256,
    },
    webViewProcesses: webViewsBeforeLayoutRestart.map(({ pid }) => ({ pid })),
    webViewExecutableSha256: webViewSha256,
    productionCommandPath: "Resize files panel keyboard ArrowRight",
  });

  await client.deleteSession();
  client = null;
  await waitForNoAppProcess(args.app);
  await waitForNoExactExecutableProcess(webViewExecutable, "fixed WebView2 process exit before layout restart");

  client = new WebDriverClient(DRIVER_URL, args["keyboard-input"]);
  await client.createSession(args.app, args.webview);
  await waitForBody(client, `OpenSCAD ${EXPECTED_ENGINE_VERSION}`, 60_000);
  await assertWelcomeStaysDisabled(client);
  const applicationAfterLayoutRestart = await requireSingleAppProcess(args.app, appSha256);
  const webViewsAfterLayoutRestart = await requireExactExecutableProcesses(
    webViewExecutable,
    webViewSha256,
    "fixed WebView2 processes after layout restart",
  );
  await waitFor(
    async () => (await splitterAriaValue(client, "Resize files panel")) === 260,
    "scratch files-panel width before reopening the project",
    15_000,
    100,
  );
  await openDesktopProject(client, recoveryProjectDirectory, cubeSource);
  const layoutAfterRestart = await waitFor(
    () => captureProjectLayoutObservation(client, 300),
    "exact project layout restored in a fresh application and WebView process",
    15_000,
    50,
  );
  const layoutRestartEvidence = validatePackagedWorkspaceLayoutRestart({
    applicationPid: applicationBeforeLayoutRestart.pid,
    webViewPids: webViewsBeforeLayoutRestart.map(({ pid }) => pid),
    layout: layoutBeforeRestart,
  }, {
    applicationPid: applicationAfterLayoutRestart.pid,
    webViewPids: webViewsAfterLayoutRestart.map(({ pid }) => pid),
    layout: layoutAfterRestart,
  });
  assert.equal(await readFile(recoveryProjectFile, "utf8"), cubeSource);
  await client.screenshot(join(args.output, "03b-project-layout-restored.png"));
  await record("project-layout-restored-after-process-restart", {
    dockWidth: layoutAfterRestart.dockWidth,
    workspaceIdentity: layoutAfterRestart.workspaceIdentity,
    storageKey: layoutAfterRestart.storageKey,
    serializedLayout: layoutAfterRestart.serializedLayout,
    serializedLayoutSha256: fingerprint(layoutAfterRestart.serializedLayout),
    applicationProcess: {
      priorPid: applicationBeforeLayoutRestart.pid,
      pid: applicationAfterLayoutRestart.pid,
      executablePath: applicationAfterLayoutRestart.path,
      executableSha256: appSha256,
      freshProcess: layoutRestartEvidence.freshApplicationProcess,
    },
    webViewProcesses: {
      priorPids: webViewsBeforeLayoutRestart.map(({ pid }) => pid),
      pids: webViewsAfterLayoutRestart.map(({ pid }) => pid),
      executableSha256: webViewSha256,
      freshProcesses: layoutRestartEvidence.freshWebViewProcesses,
    },
    sameOpaqueWorkspace: true,
    exactLayoutRestored: layoutRestartEvidence.exactLayoutRestored,
  });
  lastVerifiedAppProcess = applicationAfterLayoutRestart;
  await probeCredential(args["credential-probe"], true);

  const recoveryMarker = `// DIRTY-RECOVERY-${randomBytes(16).toString("hex")}`;
  const dirtySource = `${cubeSource}\n${recoveryMarker}`;
  const dirtySourceSha256 = fingerprint(dirtySource);
  const processToKill = lastVerifiedAppProcess;
  await appendEditorSource(client, `\n${recoveryMarker}`);
  await waitFor(async () => {
    const serialized = await client.execute("return localStorage.getItem('scadmill.recovery.v1');");
    if (typeof serialized !== "string") return false;
    const snapshot = JSON.parse(serialized);
    return snapshot?.buffers?.some((buffer) => buffer.source === dirtySource);
  }, "exact dirty recovery snapshot", 2_000, 10);
  const settledRecovery = await client.execute("return localStorage.getItem('scadmill.recovery.v1');");
  assert.equal(typeof settledRecovery, "string", "The exact recovery snapshot disappeared before the ordering check.");
  assert.equal(JSON.parse(settledRecovery)?.buffers?.some((buffer) => buffer.source === dirtySource), true);
  const orderingSentinelKey = `scadmill.evidence.recovery-ordering.${randomBytes(16).toString("hex")}`;
  const orderingSentinelValue = randomBytes(64).toString("base64url");
  const orderingRoundTrip = await client.execute(`
    localStorage.setItem(arguments[0], arguments[1]);
    return localStorage.getItem(arguments[0]);
  `, [orderingSentinelKey, orderingSentinelValue]);
  assert.equal(orderingRoundTrip, orderingSentinelValue, "The ordered recovery sequencing sentinel did not round-trip.");
  assert.equal(
    await client.execute("return localStorage.getItem('scadmill.recovery.v1');"),
    settledRecovery,
    "The exact project recovery snapshot was not present immediately before forced kill.",
  );
  assert.equal(
    await client.execute("return localStorage.getItem(arguments[0]);", [orderingSentinelKey]),
    orderingSentinelValue,
    "The in-renderer ordering sentinel was not readable immediately before forced kill.",
  );
  assert.equal(await readFile(recoveryProjectFile, "utf8"), cubeSource, "The unsaved project edit reached disk before kill.");
  const killTarget = (await exactExecutableProcesses(args.app)).find(({ pid, path, startedAt }) => (
    pid === processToKill.pid
    && normalize(path) === normalize(args.app)
    && startedAt === processToKill.startedAt
  ));
  assert.ok(killTarget, "The exact release process changed before the forced-kill step.");
  assert.equal(await fileSha256(killTarget.path), appSha256, "The forced-kill target hash changed.");
  process.kill(killTarget.pid);
  await waitForNoAppProcess(args.app);
  await record("dirty-release-process-force-killed", {
    pid: processToKill.pid,
    executablePath: processToKill.path,
    startedAt: processToKill.startedAt,
    executableSha256: appSha256,
    expectedRecoverySourceSha256: dirtySourceSha256,
    savedProjectSourceSha256: fingerprint(cubeSource),
    recoverySnapshotSha256: fingerprint(settledRecovery),
    inRendererOrderingCheck: {
      sentinelKeySha256: fingerprint(orderingSentinelKey),
      sentinelValueSha256: fingerprint(orderingSentinelValue),
      orderedAfterRecoverySnapshot: true,
      exactRecoveryReReadBeforeKill: true,
      sentinelReReadBeforeKill: true,
      role: "sequencing-only; relaunch and exact restored text are the durability oracle",
    },
  });

  client.sessionId = null;
  await driver.stop();
  driver = null;
  await delay(500);
  driver = await startDriver(args["tauri-driver"], args["native-driver"], args.output, 3);
  client = new WebDriverClient(DRIVER_URL, args["keyboard-input"]);
  await client.createSession(args.app, args.webview);
  await waitForBody(client, "Restore unsaved work", 30_000);
  await assertWelcomeStaysDisabled(client);
  lastVerifiedAppProcess = await requireSingleAppProcess(args.app, appSha256);
  await clickButton(client, "Restore unsaved work");
  await waitFor(async () => (await editorSource(client)) === dirtySource, "exact recovered source", 15_000, 50);
  assert.equal(await readFile(recoveryProjectFile, "utf8"), cubeSource, "Recovery unexpectedly wrote the unsaved source to disk.");
  assert.equal(await client.execute(`
    localStorage.removeItem(arguments[0]);
    return localStorage.getItem(arguments[0]) === null;
  `, [orderingSentinelKey]), true, "The evidence-only ordering sentinel was not removed after recovery.");
  await client.screenshot(join(args.output, "03-recovered-unsaved-work.png"));
  await record("dirty-recovery-restored", {
    pid: lastVerifiedAppProcess.pid,
    recoveredSourceSha256: fingerprint(await editorSource(client)),
    exactBytesRestored: true,
    devToolsPortMirror: client.lastPortMirror,
  });

  await clickAria(client, "Open settings");
  await setControl(client, "Search settings", "AI");
  await waitFor(async () => (await inputValue(client, "AI API key")) === syntheticSecret, "credential before clear", 15_000, 100);
  await clickButton(client, "Clear AI key");
  await waitForBody(client, "AI key cleared.");
  const credentialAbsent = await probeCredential(args["credential-probe"], false);
  assert.equal(credentialAbsent.lastError, ERROR_NOT_FOUND);
  await record("os-credential-cleared", credentialAbsent);
  await clickAria(client, "Close settings");
  assert.deepEqual(await visibleAlerts(client), []);

  await client.deleteSession();
  client = null;
  await waitForNoAppProcess(args.app);
  await driver.stop();
  driver = null;

  const scan = await scanUserFiles(secretScanRoots, syntheticSecretBytes, startedAt);
  assert.deepEqual(scan.matches, [], `Synthetic credential leaked into: ${scan.matches.join(", ")}`);
  const appUnreadable = scan.unreadable.filter(({ path }) => path.toLowerCase().includes("scadmill"));
  assert.deepEqual(appUnreadable, [], `Could not scan app-managed files: ${JSON.stringify(appUnreadable)}`);
  await record("recursive-app-file-secret-scan-after-clear-passed", {
    roots: scan.roots,
    filesScanned: scan.filesScanned,
    bytesScanned: scan.bytesScanned,
    filesWrittenDuringJourney: scan.filesWrittenDuringJourney,
    matches: scan.matches,
    unreadableAppFiles: appUnreadable,
    secretSha256: secretFingerprint,
  });

  const noOrphans = await waitFor(async () => {
    const processes = {
      application: await exactExecutableProcesses(args.app),
      engine: await exactExecutableProcesses(args.engine),
      tauriDriver: await exactExecutableProcesses(args["tauri-driver"]),
      edgeDriver: await exactExecutableProcesses(args["native-driver"]),
      webView: await exactExecutableProcesses(webViewExecutable),
    };
    return Object.values(processes).every((entries) => entries.length === 0) ? processes : false;
  }, "exact packaged-process cleanup", 15_000, 100);
  await record("exact-release-orphan-check-passed", {
    application: { executablePath: args.app, remainingProcesses: noOrphans.application },
    engine: { executablePath: args.engine, remainingProcesses: noOrphans.engine },
    tauriDriver: { executablePath: args["tauri-driver"], remainingProcesses: noOrphans.tauriDriver },
    edgeDriver: { executablePath: args["native-driver"], remainingProcesses: noOrphans.edgeDriver },
    webView: { executablePath: webViewExecutable, remainingProcesses: noOrphans.webView },
  });
  const finalN2Verification = await verifyN2SoakArtifacts({
    configurationPath: join(args.output, "n2-soak-config.json"),
    summaryPath: join(args.output, "n2-soak-summary.json"),
    samplePath: join(args.output, "n2-soak-samples.jsonl"),
    expectedConfigurationSha256: harnessManifest.files.n2SoakConfiguration.sha256,
    events,
  });
  await record("n2-final-artifacts-verified", finalN2Verification);
  evidence.status = "passed";
  evidence.completedAt = new Date().toISOString();
  evidence.summary = {
    checksPassed: events.length,
  };
  await persist();
  await writeFile(join(args.output, "GUEST_PASS"), "packaged desktop guest evidence passed\n");
  console.log("PACKAGED DESKTOP GUEST EVIDENCE: PASS");
} catch (error) {
  evidence.status = "failed";
  evidence.completedAt = new Date().toISOString();
  evidence.failure = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: "UnknownError", message: String(error) };
  await persist();
  console.error(error);
  process.exitCode = 1;
} finally {
  if (mcpClient) mcpClient.stop();
  if (m4McpClient) m4McpClient.stop();
  if (m4ProviderMock) await m4ProviderMock.close().catch(() => undefined);
  if (client?.sessionId) await client.deleteSession().catch(() => undefined);
  if (driver) await driver.stop().catch(() => undefined);
  if (lastVerifiedAppProcess) {
    const exact = await exactAppProcesses(args.app);
    const same = exact.find(({ pid, path, startedAt }) => (
      pid === lastVerifiedAppProcess.pid
      && normalize(path) === normalize(args.app)
      && startedAt === lastVerifiedAppProcess.startedAt
    ));
    if (same) {
      try { process.kill(same.pid); } catch { /* already gone */ }
    }
  }
  await persist().catch(() => undefined);
}
