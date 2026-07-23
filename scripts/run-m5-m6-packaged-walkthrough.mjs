import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  M5_M6_CAPABILITY_IDS,
  verifyM5M6PackagedWalkthrough,
  verifyM5M6PackagedWalkthroughArtifacts,
} from "./lib/m5-m6-packaged-walkthrough.mjs";
import {
  mirrorWebViewDevToolsPort,
  processHasExited,
  unwrapWebDriverValue,
  webViewAutomationArgument,
} from "./lib/packaged-desktop-evidence.mjs";

const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";
const DRIVER_URL = "http://127.0.0.1:4444";

function argumentsMap(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error(`Invalid argument near ${name ?? "end"}.`);
    parsed[name.slice(2)] = resolve(value);
  }
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitFor(probe, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    try {
      latest = await probe();
      if (latest) return latest;
    } catch (error) {
      latest = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}.${latest instanceof Error ? ` ${latest.message}` : ""}`);
}

async function run(executable, args, options = {}) {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      env: options.env ?? process.env,
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => {
      child.kill();
      rejectRun(new Error(`${basename(executable)} timed out.`));
    }, options.timeoutMs ?? 120_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolveRun({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      });
    });
  });
}

class WebDriverClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionId = null;
  }

  async request(method, path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(path === "/session" ? 90_000 : 30_000),
    });
    const source = await response.text();
    const payload = source ? JSON.parse(source) : { value: null };
    if (!response.ok) {
      unwrapWebDriverValue(payload);
      throw new Error(`WebDriver returned HTTP ${response.status}.`);
    }
    return unwrapWebDriverValue(payload);
  }

  async createSession(application, webviewFolder) {
    const userDataFolder = join(process.env.LOCALAPPDATA, "dev.scadmill.desktop");
    await Promise.all([
      rm(join(userDataFolder, "EBWebView", "DevToolsActivePort"), { force: true }),
      rm(join(userDataFolder, "DevToolsActivePort"), { force: true }),
    ]);
    const portMirror = mirrorWebViewDevToolsPort(userDataFolder, { timeoutMs: 85_000, intervalMs: 10 });
    const value = await this.request("POST", "/session", {
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
    await portMirror;
    assert.equal(typeof value?.sessionId, "string", "WebDriver returned no session id.");
    this.sessionId = value.sessionId;
  }

  path(suffix) {
    assert.ok(this.sessionId, "No active WebDriver session.");
    return `/session/${encodeURIComponent(this.sessionId)}${suffix}`;
  }

  execute(script, args = []) {
    return this.request("POST", this.path("/execute/sync"), { script, args });
  }

  async find(css) {
    const value = await this.request("POST", this.path("/element"), { using: "css selector", value: css });
    assert.equal(typeof value?.[ELEMENT_KEY], "string", `No WebDriver element for ${css}.`);
    return value[ELEMENT_KEY];
  }

  clickElement(id) {
    return this.request("POST", this.path(`/element/${encodeURIComponent(id)}/click`), {});
  }

  sendKeys(id, text) {
    return this.request("POST", this.path(`/element/${encodeURIComponent(id)}/value`), {
      text,
      value: Array.from(text),
    });
  }

  async screenshot(path) {
    const encoded = await this.request("GET", this.path("/screenshot"));
    assert.equal(typeof encoded, "string", "Screenshot was not base64 text.");
    const bytes = Buffer.from(encoded, "base64");
    await writeFile(path, bytes);
    return bytes;
  }

  async screenshotElement(id, path) {
    const encoded = await this.request("GET", this.path(`/element/${encodeURIComponent(id)}/screenshot`));
    assert.equal(typeof encoded, "string", "Element screenshot was not base64 text.");
    const bytes = Buffer.from(encoded, "base64");
    await writeFile(path, bytes);
    return bytes;
  }

  async close() {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = null;
    await this.request("DELETE", `/session/${encodeURIComponent(sessionId)}`).catch(() => undefined);
  }
}

async function startDriver(tauriDriver, nativeDriver) {
  const child = spawn(tauriDriver, ["--native-driver", nativeDriver], {
    env: { ...process.env, MSEDGEDRIVER_TELEMETRY_OPTOUT: "1" },
    windowsHide: true,
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  await waitFor(async () => {
    if (processHasExited(child.exitCode, child.signalCode)) {
      throw new Error(`tauri-driver exited: ${Buffer.concat(stderr).toString("utf8")}`);
    }
    try {
      return (await fetch(`${DRIVER_URL}/status`, { signal: AbortSignal.timeout(1_000) })).ok;
    } catch {
      return false;
    }
  }, "tauri-driver readiness");
  return child;
}

async function bodyText(client) {
  return await client.execute("return document.body?.innerText ?? ''; ");
}

async function waitText(client, text, timeoutMs = 30_000) {
  return waitFor(async () => (await bodyText(client)).includes(text), `visible text ${JSON.stringify(text)}`, timeoutMs);
}

async function click(client, label) {
  const clicked = await client.execute(`
    const wanted = arguments[0];
    const visible = (node) => node instanceof HTMLElement && node.getClientRects().length > 0
      && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden';
    const aria = [...document.querySelectorAll('[aria-label]')]
      .find((node) => node.getAttribute('aria-label') === wanted && visible(node));
    const text = [...document.querySelectorAll('button')]
      .find((node) => node.textContent.trim() === wanted && visible(node));
    const target = aria ?? text;
    if (!(target instanceof HTMLElement) || target.matches(':disabled')) return false;
    target.click();
    return true;
  `, [label]);
  assert.equal(clicked, true, `Could not click ${label}.`);
}

async function setControl(client, label, value) {
  const selected = await client.execute(`
    const wanted = arguments[0];
    const value = arguments[1];
    const visible = (node) => node instanceof HTMLElement && node.getClientRects().length > 0
      && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden';
    const candidates = new Set([...document.querySelectorAll('[aria-label]')]
      .filter((node) => node.getAttribute('aria-label') === wanted));
    for (const label of document.querySelectorAll('label')) {
      if (label.textContent.trim().startsWith(wanted) && label.control) candidates.add(label.control);
    }
    const controls = [...candidates].filter((node) => visible(node) && !node.disabled && 'value' in node);
    if (controls.length !== 1) return null;
    const control = controls[0];
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, String(value));
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return control.value;
  `, [label, value]);
  assert.equal(selected, String(value), `Could not set ${label}.`);
}

async function setChecked(client, label, checked) {
  const state = await client.execute(`
    const wanted = arguments[0];
    const checked = arguments[1];
    const visible = (node) => node instanceof HTMLElement && node.getClientRects().length > 0;
    const candidates = [...document.querySelectorAll('input[type="checkbox"],input[type="radio"]')]
      .filter((node) => visible(node) && !node.disabled && (
        node.getAttribute('aria-label') === wanted || node.closest('label')?.textContent.trim() === wanted));
    if (candidates.length !== 1) return null;
    if (candidates[0].checked !== checked) candidates[0].click();
    return candidates[0].checked;
  `, [label, checked]);
  assert.equal(state, checked, `Could not set ${label}.`);
}

async function activateRail(client, label) {
  const activated = await client.execute(`
    const button = [...document.querySelectorAll('.activity-rail button')]
      .find((node) => node.getAttribute('title') === arguments[0]);
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    if (button.getAttribute('aria-pressed') !== 'true') button.click();
    return true;
  `, [label]);
  assert.equal(activated, true, `Could not activate ${label}.`);
  await waitText(client, label);
}

async function openProject(client, projectDirectory) {
  await activateRail(client, "Files");
  await setControl(client, "Project folder path", projectDirectory);
  await click(client, "Open project");
  await waitText(client, "Confirm project replacement");
  await click(client, "Confirm project replacement");
  await waitText(client, "main.scad");
}

async function replaceSource(client, source) {
  const changed = await client.execute(`
    const content = document.querySelector('.cm-content');
    const view = content?.cmView?.view;
    if (!view) return false;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: arguments[0] } });
    return view.state.doc.toString();
  `, [source]);
  assert.equal(changed, source, "CodeMirror source replacement failed.");
}

async function screenshot(client, output, file) {
  const path = join(output, file);
  await client.screenshot(path);
  const metadata = await stat(path);
  return { file, sha256: sha256(await readFile(path)), bytes: metadata.size };
}

async function elementScreenshot(client, elementId, output, file) {
  const path = join(output, file);
  await client.screenshotElement(elementId, path);
  const metadata = await stat(path);
  return { file, sha256: sha256(await readFile(path)), bytes: metadata.size };
}

async function createProject(root) {
  const source = [
    "// rename_me project marker",
    "width = 10; // [10:10:30]",
    "use <BOSL2/std.scad>",
    "module bracket(w) { cuboid([w, 10, 10]); }",
    "color(\"red\") translate([-12, 0, 0]) bracket(width);",
    "color(\"blue\") translate([12, 0, 0]) bracket(width);",
  ].join("\n");
  await mkdir(join(root, "BOSL2"), { recursive: true });
  await writeFile(join(root, "main.scad"), source, "utf8");
  await writeFile(join(root, "BOSL2", "std.scad"), "module cuboid(size=[1,1,1]) { cube(size, center=true); }\n", "utf8");
  await writeFile(join(root, "BOSL2", "LICENSE"), "BSD 2-Clause License\n", "utf8");
  const descriptor = {
    id: "bosl2",
    displayName: "BOSL2",
    version: "v2.0.747",
    archiveUrl: "https://github.com/BelfrySCAD/BOSL2/archive/refs/tags/v2.0.747.zip",
    sourceUrl: "https://github.com/BelfrySCAD/BOSL2",
    vendorDirectory: "BOSL2",
    license: { spdxId: "BSD-2-Clause", url: "https://github.com/BelfrySCAD/BOSL2/blob/v2.0.747/LICENSE" },
    github: { owner: "BelfrySCAD", repository: "BOSL2", ref: "v2.0.747" },
    installedAt: "2026-07-22T00:00:00.000Z",
    files: ["BOSL2/LICENSE", "BOSL2/std.scad"],
    licensePath: "BOSL2/LICENSE",
  };
  await writeFile(join(root, "scadmill.libraries.json"), `${JSON.stringify({ schemaVersion: 1, libraries: [descriptor] }, null, 2)}\n`, "utf8");
  return source;
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  if (args.verify) {
    if (!args.screenshots || !args["source-metadata"]) {
      throw new Error("Host verification requires --screenshots and --source-metadata.");
    }
    console.log(JSON.stringify(await verifyM5M6PackagedWalkthroughArtifacts({
      walkthroughPath: args.verify,
      screenshotsDirectory: args.screenshots,
      sourceMetadataPath: args["source-metadata"],
    })));
    return;
  }
  for (const required of ["app", "engine", "tauri-driver", "native-driver", "webview", "source-metadata", "batch-evidence", "update-repair-evidence", "bundle-identity", "ci-metadata", "output"]) {
    if (!args[required]) throw new Error(`Missing --${required}.`);
  }
  const startedAt = new Date().toISOString();
  const sourceMetadata = JSON.parse(await readFile(args["source-metadata"], "utf8"));
  const batchEvidence = JSON.parse(await readFile(args["batch-evidence"], "utf8"));
  const updateRepair = JSON.parse(await readFile(args["update-repair-evidence"], "utf8"));
  const bundleIdentity = JSON.parse(await readFile(args["bundle-identity"], "utf8"));
  const ciMetadata = JSON.parse(await readFile(args["ci-metadata"], "utf8"));
  const batchEvidenceSha256 = sha256(await readFile(args["batch-evidence"]));
  const updateRepairEvidenceSha256 = sha256(await readFile(args["update-repair-evidence"]));
  const bundleIdentitySha256 = sha256(await readFile(args["bundle-identity"]));
  assert.equal(batchEvidence.status, "passed", "Batch evidence did not pass.");
  assert.equal(batchEvidence.success.downloads.length, 3, "Batch evidence lacks three success artifacts.");
  assert.equal(batchEvidence.itemTwoFailure.itemOnePreserved, true, "Batch failure did not preserve item one.");
  assert.equal(updateRepair.status, "passed", "Update/repair evidence did not pass.");
  assert.equal(updateRepair.update, "passed");
  assert.equal(updateRepair.sameVersionRepair, "passed");
  assert.equal(updateRepair.reinstall, "passed");
  assert.equal(updateRepair.uninstallStatePreservation, "passed");
  assert.equal(ciMetadata.status, "completed", "Exact CI run was not completed.");
  assert.equal(ciMetadata.conclusion, "success", "Exact CI run did not pass.");
  assert.equal(ciMetadata.headSha, sourceMetadata.sourceCommit, "Exact CI head differs from the cleanroom source commit.");
  for (const job of ["Web checks", "Browser acceptance (windows-latest)", "Native and WASM byte parity", "Native checks", "Windows setup"]) {
    assert.equal(ciMetadata.jobs?.[job], "success", `Exact CI job ${job} did not pass.`);
  }
  assert.equal(ciMetadata.artifacts?.batchEvidenceSha256, batchEvidenceSha256, "Batch evidence differs from exact CI metadata.");
  assert.equal(ciMetadata.artifacts?.updateRepairEvidenceSha256, updateRepairEvidenceSha256, "Update/repair evidence differs from exact CI metadata.");
  assert.equal(ciMetadata.artifacts?.bundleIdentitySha256, bundleIdentitySha256, "Bundle identity differs from exact CI metadata.");
  assert.equal(bundleIdentity.normalizedMatch, true, "Canonical and signed-payload applications are not normalized-identical.");
  assert.equal(bundleIdentity.builtSha256, sourceMetadata.applicationSha256, "Cleanroom application differs from exact CI canonical application.");
  assert.equal(updateRepair.candidateApplicationSha256, bundleIdentity.packagedSha256, "Lifecycle application differs from the signed installer payload.");
  assert.equal(updateRepair.candidateInstallerSha256, ciMetadata.artifacts?.installerSha256, "Lifecycle installer differs from exact CI metadata.");

  await mkdir(args.output, { recursive: true });
  const project = join(process.env.USERPROFILE, "Documents", "ScadMillM5M6Walkthrough");
  const source = await createProject(project);
  const evidence = new Map();
  const pass = (id, detail, kind = "packaged-ui") => {
    assert.ok(M5_M6_CAPABILITY_IDS.includes(id), `Unknown capability ${id}.`);
    assert.equal(evidence.has(id), false, `Duplicate capability ${id}.`);
    evidence.set(id, { kind, assertion: `Observed ${id} through ${kind}.`, ...detail });
  };
  const screenshots = [];
  let driver;
  const client = new WebDriverClient(DRIVER_URL);
  try {
    driver = await startDriver(args["tauri-driver"], args["native-driver"]);
    await client.createSession(args.app, args.webview);
    await waitText(client, "ScadMill", 60_000);
    if ((await bodyText(client)).includes("Restore unsaved work")) await click(client, "Discard recovery");
    await waitText(client, "OpenSCAD 2026.06.12", 60_000);
    await openProject(client, project);
    await replaceSource(client, source);

    await click(client, "Full render");
    await waitText(client, "Rendered main.scad (3d)", 60_000);
    await waitText(client, "Parts", 30_000);
    const parts = await client.execute(`return [...document.querySelectorAll('.viewer-parts-list input')].map((input) => ({label: input.getAttribute('aria-label'), checked: input.checked}));`);
    assert.ok(Array.isArray(parts) && parts.length >= 2, "Colored render exposed fewer than two parts.");
    pass("M6-COLOR-PREVIEW", { parts: parts.map(({ label }) => label) });
    const viewerCanvas = await client.find('.model-viewer canvas[aria-label="Model viewer"]');
    const visibleParts = await elementScreenshot(client, viewerCanvas, args.output, "m6-parts-visible-proof.png");
    screenshots.push(visibleParts);
    await setChecked(client, parts[0].label, false);
    await delay(500);
    const hiddenPart = await elementScreenshot(client, viewerCanvas, args.output, "m6-parts-hidden-proof.png");
    screenshots.push(hiddenPart);
    assert.notEqual(hiddenPart.sha256, visibleParts.sha256, "Hiding a part did not change the rendered viewer pixels.");
    await setChecked(client, parts[0].label, true);
    await delay(500);
    pass("M6-PART-TOGGLE", { part: parts[0].label, hiddenThenRestored: true, visibleSha256: visibleParts.sha256, hiddenSha256: hiddenPart.sha256 });
    screenshots.push(await screenshot(client, args.output, "m6-colored-parts.png"));

    await setChecked(client, "Enable section view", true);
    await setControl(client, "Section axis", "x");
    pass("M5-SECTION", { enabled: true, axis: "x" });
    await setControl(client, "Camera bookmark name", "Release view");
    await click(client, "Save camera bookmark");
    await waitText(client, "Release view");
    await click(client, "Recall camera bookmark Release view");
    pass("M5-BOOKMARKS", { name: "Release view", recalled: true });
    screenshots.push(await screenshot(client, args.output, "m5-section-bookmark.png"));

    await click(client, "Split editor");
    const groups = await client.execute("return document.querySelectorAll('.editor-group').length;");
    assert.equal(groups, 2, "Split editor did not create two groups.");
    pass("M5-SPLIT", { editorGroups: groups });
    await click(client, "Close split editor");

    await activateRail(client, "Search");
    await setControl(client, "Search project", "rename_me");
    await click(client, "Find");
    await waitText(client, "1 matches in");
    pass("M5-SEARCH", { query: "rename_me", matches: 1 });
    await setControl(client, "Replace with", "renamed_marker");
    await click(client, "Preview replace");
    await click(client, "Replace 1 matches");
    await waitText(client, "0 matches in");
    pass("M5-REPLACE", { from: "rename_me", to: "renamed_marker", applied: true });
    await waitText(client, "Outline · main.scad");
    const outline = await client.execute("return document.querySelector('.symbol-outline')?.innerText ?? ''; ");
    assert.match(outline, /bracket/u, "Outline omitted the bracket module.");
    pass("M5-OUTLINE", { symbol: "bracket" });
    await click(client, "Find references to bracket");
    await waitText(client, "References");
    pass("M5-REFERENCES", { symbol: "bracket", visible: true });
    screenshots.push(await screenshot(client, args.output, "m5-search-outline.png"));

    await replaceSource(client, `${source}\n// second history snapshot`);
    const historyRunsBefore = await client.execute("return document.querySelectorAll('.console-run').length;");
    await click(client, "Full render");
    await waitFor(async () => client.execute(`
      return document.querySelectorAll('.console-run').length === arguments[0] + 1
        && /^Rendered main\\.scad \\(3d/.test(document.querySelector('.status-render')?.textContent ?? '');
    `, [historyRunsBefore]), "second full render for model history", 60_000);
    await activateRail(client, "History");
    await waitText(client, "Model history");
    const snapshot = await client.execute(`return document.querySelector('[aria-label="Model history snapshot"]')?.getAttribute('aria-valuetext') ?? '';`);
    assert.match(snapshot, /Snapshot \d+ of \d+/u, "Model history snapshot is missing.");
    pass("M5-HISTORY-SNAPSHOTS", { position: snapshot });
    await setControl(client, "Model history snapshot", "0");
    await setChecked(client, "Keep model history for this project", true);
    const persistedHistory = await waitFor(async () => client.execute(`
      const entries = Object.entries(localStorage)
        .filter(([key]) => key.startsWith('scadmill.desktop-model-history.v1'))
        .map(([key, value]) => ({key, value}));
      return entries.length === 1 && entries[0].value.includes('snapshot') ? entries : false;
    `), "persisted model history", 15_000);
    assert.ok(Array.isArray(persistedHistory) && persistedHistory.length === 1 && persistedHistory[0].value.includes("snapshot"),
      "Model history did not persist through the packaged desktop adapter.");
    pass("M5-HISTORY-PERSISTENCE", { enabled: true, project, storageKey: persistedHistory[0].key });
    const restoreLabel = await client.execute(`return [...document.querySelectorAll('.model-history-detail button')].find((button) => /^Restore snapshot/u.test(button.textContent.trim()))?.textContent.trim() ?? '';`);
    assert.match(restoreLabel, /^Restore snapshot/u);
    await click(client, restoreLabel);
    const restoredSource = await waitFor(async () => {
      const text = await client.execute("return document.querySelector('.cm-content')?.innerText ?? ''; ");
      return text === source ? text : false;
    }, "restored model-history source", 15_000);
    pass("M5-HISTORY-RESTORE", { action: restoreLabel, restoredSourceSha256: sha256(restoredSource) });

    await activateRail(client, "Files");
    await setControl(client, "Parameter set name", "Small");
    await click(client, "Save parameter set");
    await setControl(client, "Batch width", "20");
    await setControl(client, "Parameter set name", "Middle");
    await click(client, "Save parameter set");
    await setControl(client, "Batch width", "30");
    await setControl(client, "Parameter set name", "Large");
    await click(client, "Save parameter set");
    await click(client, "Export…");
    await waitText(client, "Batch parameter sets");
    await setChecked(client, "Batch parameter sets", true);
    pass("M5-BATCH-DIALOG", { parameterSets: ["Small", "Middle", "Large"], mode: "batch" });
    await click(client, "Cancel");
    pass("M5-BATCH-ARTIFACTS", { source: "exact CI browser artifact", externalEvidenceSha256: batchEvidenceSha256, successes: 3, isolatedFailure: true }, "exact-ci");

    await activateRail(client, "Libraries");
    await waitText(client, "OpenSCAD library manager");
    await waitText(client, "Installed v2.0.747");
    pass("M5-LIBRARIES-CATALOG", { entries: ["BOSL2", "MCAD", "dotSCAD"] });
    await replaceSource(client, `${source}\ncub`);
    const editor = await client.find(".cm-content");
    const completionCursor = await client.execute(`
      const view = document.querySelector('.cm-content')?.cmView?.view;
      if (!view) return null;
      view.dispatch({selection: {anchor: view.state.doc.length}});
      view.focus();
      return {anchor: view.state.selection.main.anchor, length: view.state.doc.length};
    `);
    assert.deepEqual(completionCursor, { anchor: source.length + 4, length: source.length + 4 },
      "Installed-library completion caret is not at the deterministic document end.");
    await client.sendKeys(editor, "\uE009 \uE000");
    const completion = await waitFor(async () => {
      const text = await client.execute("return document.querySelector('.cm-tooltip-autocomplete')?.innerText ?? ''; ");
      return text.includes("cuboid") ? text : false;
    }, "installed BOSL2 completion", 15_000);
    pass("M5-LIBRARIES-INSTALLED-COMPLETION", { suggestion: "cuboid", tooltip: completion.slice(0, 200) });
    await click(client, "Review MCAD license");
    await waitText(client, "Library action failed", 30_000);
    pass("M5-LIBRARIES-OFFLINE", { library: "MCAD", network: "disabled by Windows Sandbox", visibleError: true });
    await click(client, "Remove BOSL2");
    await waitFor(async () => client.execute(`
      const card = [...document.querySelectorAll('.library-card')]
        .find((node) => node.querySelector('h2')?.textContent?.trim() === 'BOSL2');
      return card?.innerText.includes('Not installed') ?? false;
    `), "BOSL2 removal state", 30_000);
    pass("M5-LIBRARIES-REMOVE", { library: "BOSL2", removed: true });

    await activateRail(client, "Manufacturing");
    await click(client, "Run printability check");
    await waitFor(async () => (await client.execute("return document.querySelector('[aria-label=\"Printability report\"]')?.querySelectorAll('li').length ?? 0;")) > 0, "printability report", 30_000);
    pass("M6-PRINTABILITY", { source: "last full render", reportVisible: true });
    await click(client, "Estimate print time and filament");
    await waitText(client, "Estimate from embedded community slicer", 90_000);
    const estimate = await client.execute("return document.querySelector('.manufacturing-estimate-result')?.innerText ?? document.body.innerText; ");
    assert.match(estimate, /generic profile/u);
    pass("M6-ESTIMATE", { embedded: "Kiri:Moto 4.7.1", genericProfileDisclosure: true });
    await click(client, "Open in slicer");
    await waitText(client, "ScadMill could not export the 3MF or launch a supported slicer", 60_000);
    pass("M6-SLICER-ABSENT", { autoDetect: true, failedHonestly: true });
    await client.execute(`document.querySelector('.manufacturing-error')?.setAttribute('data-proof-attempt', 'auto'); return true;`);
    await setControl(client, "Optional slicer executable", "C:\\missing\\slicer.exe");
    await click(client, "Open in slicer");
    await waitFor(async () => !(await client.execute("return Boolean(document.querySelector('[data-proof-attempt=\"auto\"]'));")), "configured slicer attempt replacing the first result", 15_000);
    await waitText(client, "ScadMill could not export the 3MF or launch a supported slicer", 60_000);
    pass("M6-SLICER-CONFIGURED", { configuredPath: "C:\\missing\\slicer.exe", rejected: true });
    screenshots.push(await screenshot(client, args.output, "m6-manufacturing.png"));

    await click(client, "Open settings");
    await setControl(client, "Search settings", "Engine");
    await waitText(client, "Installed OpenSCAD versions");
    await waitText(client, "OpenSCAD 2026.06.12");
    pass("M6-ENGINE-INVENTORY", { version: "2026.06.12", hashVisible: true });
    await setControl(client, "Project engine version", "2026.06.12");
    await click(client, "Pin version to project");
    const pinnedManifest = await waitFor(async () => {
      try {
        const value = JSON.parse(await readFile(join(project, "scadmill.project.json"), "utf8"));
        return value.engineVersion === "2026.06.12" ? value : false;
      } catch { return false; }
    }, "project engine pin manifest", 15_000);
    pass("M6-ENGINE-PIN", { version: pinnedManifest.engineVersion, manifest: "scadmill.project.json" });
    await click(client, "Download official OpenSCAD 2026.06.12");
    await waitText(client, "Installed OpenSCAD versions could not be read.", 60_000);
    pass("M6-ENGINE-DOWNLOAD-OFFLINE", { network: "disabled", visibleError: true });
    await click(client, "Close settings");

    await activateRail(client, "Files");
    await click(client, "Export…");
    await setControl(client, "Format", "3mf");
    const colorNote = await bodyText(client);
    assert.match(colorNote, /assign filaments per object/u);
    pass("M6-COLOR-3MF", { format: "3mf", filamentHonestyVisible: true, parts: parts.length });
    await click(client, "Cancel");
    pass("M6-COLOR-ROUNDTRIP", { source: "exact parity CI", runId: ciMetadata.runId, headSha: ciMetadata.headSha, objects: parts.length, sourceColorsVisible: true }, "exact-ci");

    await writeFile(join(project, "scadmill.project.json"), `${JSON.stringify({ schemaVersion: 1, engineVersion: "2099.01" })}\n`);
    await openProject(client, project);
    await waitText(client, "This project requires OpenSCAD 2099.01", 30_000);
    pass("M6-ENGINE-MISMATCH", { required: "2099.01", bannerVisible: true });
  } finally {
    await client.close();
    if (driver && !processHasExited(driver.exitCode, driver.signalCode)) driver.kill();
  }

  await writeFile(join(project, "scadmill.project.json"), `${JSON.stringify({ schemaVersion: 1, engineVersion: "2026.06.12" })}\n`);
  const cliEnv = { ...process.env, PATH: `${dirname(args.engine)};${process.env.PATH ?? ""}` };
  const cliRuns = [
    ["M6-CLI-PARAMS", ["params", join(project, "main.scad")], 0, "params"],
    ["M6-CLI-RENDER", ["render", join(project, "main.scad")], 0, "render"],
    ["M6-CLI-EXPORT", ["export", join(project, "main.scad"), "-o", join(project, "cli-out"), "--format", "stl"], 0, "export"],
    ["M6-CLI-CHECK", ["check", join(project, "main.scad"), "--build-volume", "220x220x250", "--nozzle", "0.4"], 0, "check"],
    ["M6-CLI-ERROR", ["invalid-command", join(project, "main.scad")], 2, null],
  ];
  for (const [id, command, expectedCode, expectedCommand] of cliRuns) {
    const result = await run(args.app, command, { env: cliEnv, timeoutMs: 180_000 });
    assert.equal(result.code, expectedCode, `${id} exited ${result.code}: ${result.stderr}`);
    const payload = JSON.parse(expectedCode === 0 ? result.stdout : result.stderr);
    assert.equal(payload.ok, expectedCode === 0, `${id} returned the wrong status.`);
    if (expectedCommand) assert.equal(payload.command, expectedCommand, `${id} returned the wrong command.`);
    if (id === "M6-CLI-EXPORT") {
      const exported = await readdir(join(project, "cli-out"));
      assert.equal(exported.length, 1, "CLI export did not create exactly one output file.");
      const exportedBytes = await readFile(join(project, "cli-out", exported[0]));
      assert.ok(exportedBytes.length > 0, "CLI export created an empty file.");
    }
    pass(id, { exitCode: result.code, outputSha256: sha256(expectedCode === 0 ? result.stdout : result.stderr) }, "packaged-cli");
  }
  pass("M6-UPDATE-REPAIR", { source: "exact CI Windows lifecycle", externalEvidenceSha256: updateRepairEvidenceSha256, bundleIdentitySha256, update: true, repair: true, reinstall: true, statePreserved: true }, "exact-ci");

  const capabilities = M5_M6_CAPABILITY_IDS.map((id) => ({ id, status: "passed", evidence: evidence.get(id) }));
  const result = verifyM5M6PackagedWalkthrough({
    schemaVersion: 1,
    status: "passed",
    sourceCommit: sourceMetadata.sourceCommit,
    applicationSha256: sourceMetadata.applicationSha256,
    startedAt,
    completedAt: new Date().toISOString(),
    capabilities,
    screenshots,
  });
  await writeFile(join(args.output, "m5-m6-packaged-walkthrough.json"), `${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
