import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  mirrorWebViewDevToolsPort,
  parseSourceMetadata,
  parseBinaryStl,
  processHasExited,
  scanFileForBytes,
  unwrapWebDriverValue,
  validateHarnessManifest,
  validatePackagedWorkspaceLayoutObservation,
  validatePackagedWorkspaceLayoutRestart,
  validateSandboxConfig,
  validateCredentialProbe,
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
  for (const required of ["app", "engine", "tauri-driver", "native-driver", "webview", "credential-probe", "source-metadata", "harness-manifest", "output"]) {
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

class WebDriverClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionId = null;
    this.lastPortMirror = null;
  }

  async request(method, path, body) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(method === "POST" && path === "/session" ? 90_000 : 30_000),
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
    const userDataFolder = join(process.env.LOCALAPPDATA, "dev.scadmill.app");
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
    return value.capabilities ?? {};
  }

  sessionPath(suffix) {
    if (!this.sessionId) throw new Error("No active WebDriver session.");
    return `/session/${encodeURIComponent(this.sessionId)}${suffix}`;
  }

  execute(script, args = []) {
    return this.request("POST", this.sessionPath("/execute/sync"), { script, args });
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

  async screenshot(path) {
    const encoded = await this.request("GET", this.sessionPath("/screenshot"));
    if (typeof encoded !== "string") throw new Error("WebDriver screenshot was not base64 text.");
    await writeFile(path, Buffer.from(encoded, "base64"));
  }

  async deleteSession() {
    if (!this.sessionId) return;
    const active = this.sessionId;
    this.sessionId = null;
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
  const clicked = await client.execute(`
    const wanted = arguments[0];
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent.trim() === wanted && !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  `, [text]);
  if (clicked !== true) throw new Error(`Could not click enabled button ${JSON.stringify(text)}.`);
}

async function clickAria(client, label) {
  const clicked = await client.execute(`
    const element = document.querySelector('[aria-label="' + CSS.escape(arguments[0]) + '"]');
    if (!(element instanceof HTMLElement) || element.matches(':disabled')) return false;
    element.click();
    return true;
  `, [label]);
  if (clicked !== true) throw new Error(`Could not click element labelled ${JSON.stringify(label)}.`);
}

async function setControl(client, label, value) {
  const selected = await client.execute(`
    const control = document.querySelector('[aria-label="' + CSS.escape(arguments[0]) + '"]');
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return null;
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
  `, [label, value]);
  if (selected !== String(value)) {
    throw new Error(`Could not set ${JSON.stringify(label)} to the requested value.`);
  }
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
    const content = document.querySelector('.cm-content');
    const view = content?.cmView?.view;
    return view?.state?.doc?.toString() ?? content?.innerText ?? null;
  `);
  return typeof source === "string" ? source.replaceAll("\r\n", "\n") : null;
}

async function replaceEditorSource(client, source) {
  const editor = await client.find(".cm-content");
  await client.clickElement(editor);
  await client.sendKeys(editor, `${CONTROL_KEY}a${NULL_KEY}${source}`);
  await waitFor(async () => (await editorSource(client)) === source, "exact editor source", 10_000, 50);
}

async function appendEditorSource(client, suffix) {
  const editor = await client.find(".cm-content");
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
    `@($candidates | Where-Object { $_.Path -eq '${escaped}' } | Select-Object @{n='pid';e={[int]$_.Id}},@{n='path';e={$_.Path}},@{n='startedAt';e={$_.StartTime.ToUniversalTime().ToString('o')}}) | ConvertTo-Json -Compress`,
  ].join(" ");
  const result = await run("powershell.exe", ["-NoProfile", "-Command", command]);
  if (!result.stdout) return [];
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
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
    credentialProbe: args["credential-probe"],
    sandboxBootstrap: join(dirname(executingRunner), "run-packaged-desktop-sandbox.ps1"),
    sourceMetadata: args["source-metadata"],
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
    userDataFolder: join(process.env.LOCALAPPDATA, "dev.scadmill.app"),
  });

  driver = await startDriver(args["tauri-driver"], args["native-driver"], args.output, 1);
  client = new WebDriverClient(DRIVER_URL);
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

  const cubeSource = "cube([10, 10, 10]);";
  await waitFor(async () => Boolean(await client.find(".cm-content").catch(() => null)), "CodeMirror editor", 30_000, 100);
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
    const saved = await client.execute("return localStorage.getItem('scadmill.scratch-autosave.v1');");
    const recovery = await client.execute("return localStorage.getItem('scadmill.recovery.v1');");
    return saved === cubeSource && recovery === null;
  }, "clean scratch autosave before normal restart", 15_000, 50);
  await record("visible-setting-and-source-persisted", {
    settingsPath: settingsFiles[0],
    editorFontSize: settingsJson.editor.fontSize,
    sourceSha256: fingerprint(cubeSource),
    secretAbsentFromSettings: true,
  });

  await client.deleteSession();
  await waitForNoAppProcess(args.app);
  client = new WebDriverClient(DRIVER_URL);
  await client.createSession(args.app, args.webview);
  await waitForBody(client, `OpenSCAD ${EXPECTED_ENGINE_VERSION}`, 60_000);
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
  client = new WebDriverClient(DRIVER_URL);
  await client.createSession(args.app, args.webview);
  await waitForBody(client, `OpenSCAD ${EXPECTED_ENGINE_VERSION}`, 60_000);
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

  client = new WebDriverClient(DRIVER_URL);
  await client.createSession(args.app, args.webview);
  await waitForBody(client, `OpenSCAD ${EXPECTED_ENGINE_VERSION}`, 60_000);
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
  client = new WebDriverClient(DRIVER_URL);
  await client.createSession(args.app, args.webview);
  await waitForBody(client, "Restore unsaved work", 30_000);
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
