import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { gzipSync, strToU8, zipSync } from "fflate";

const DATABASE_NAME = "scadmill-projects-v1";
const SCRATCH_AUTOSAVE_KEY = "scadmill.scratch-autosave.v1";
const GATE_ARTIFACT_DIR = process.env.SCADMILL_GATE_ARTIFACT_DIR?.trim()
  ? resolve(process.env.SCADMILL_GATE_ARTIFACT_DIR)
  : null;
const RUNNER_PATHS = [
  "tests/e2e/m2-browser-gate.e2e.ts",
  "tests/e2e/m2-storage-fallback.e2e.ts",
  "tests/e2e/m2-svg-viewer.e2e.ts",
  "tests/e2e/m2-gate.playwright.config.ts",
] as const;
const REPRODUCTION_COMMAND =
  "pnpm.cmd exec playwright test --config tests/e2e/m2-gate.playwright.config.ts";

interface StoredFileEvidence {
  readonly path: string;
  readonly kind: "text" | "binary";
  readonly text?: string;
  readonly bytes?: readonly number[];
}

interface StoredProjectEvidence {
  readonly projectId: string;
  readonly files: readonly StoredFileEvidence[];
}

async function editorSource(page: Page): Promise<string> {
  return (await page.locator(".cm-line").allTextContents()).join("\n");
}

async function replaceEditorSource(page: Page, source: string): Promise<void> {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(source);
  await expect.poll(() => editorSource(page)).toBe(source);
}

async function openFilesPanel(page: Page): Promise<Locator> {
  const button = page.getByRole("button", { name: "Files", exact: true });
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
  const panel = page.getByRole("region", { name: "Files panel" });
  await expect(panel).toBeVisible();
  return panel;
}

async function indexedDbNames(page: Page): Promise<readonly string[]> {
  return page.evaluate(async () =>
    (await indexedDB.databases()).map(({ name }) => name ?? "").filter(Boolean).sort()
  );
}

async function indexedDbProjects(page: Page): Promise<readonly StoredProjectEvidence[]> {
  return page.evaluate(async (databaseName) => new Promise((resolveProjects, rejectProjects) => {
    const opened = indexedDB.open(databaseName, 1);
    opened.onerror = () => rejectProjects(opened.error ?? new Error("Could not open IndexedDB."));
    opened.onsuccess = () => {
      const database = opened.result;
      const transaction = database.transaction("projects", "readonly");
      const request = transaction.objectStore("projects").getAll();
      request.onerror = () => rejectProjects(request.error ?? new Error("Could not read projects."));
      request.onsuccess = () => {
        const records = request.result as {
          projectId: string;
          files: { path: string; content: string | Uint8Array }[];
        }[];
        resolveProjects(records.map((record) => ({
          projectId: record.projectId,
          files: record.files.map(({ path, content }) => typeof content === "string"
            ? { path, kind: "text" as const, text: content }
            : { path, kind: "binary" as const, bytes: [...content] }),
        })).sort((left, right) => left.projectId.localeCompare(right.projectId)));
        database.close();
      };
      transaction.onabort = () => rejectProjects(
        transaction.error ?? new Error("IndexedDB project read was aborted."),
      );
    };
  }), DATABASE_NAME);
}

function sourceShareFragment(source: string): string {
  return `#scadmill-share=v1.${Buffer.from(gzipSync(strToU8(source))).toString("base64url")}`;
}

function binaryProjectZip(source: string, bytes: Uint8Array): Buffer {
  return Buffer.from(zipSync({
    ".scadmill-project-v1.json": strToU8(JSON.stringify({
      version: 1,
      payloadPrefix: ".scadmill-files/",
      textPaths: ["main.scad"],
    })),
    ".scadmill-files/main.scad": strToU8(source),
    ".scadmill-files/assets/pixel.bin": bytes,
  }));
}

async function writeGateJson(name: string, value: unknown): Promise<void> {
  if (!GATE_ARTIFACT_DIR) return;
  await mkdir(GATE_ARTIFACT_DIR, { recursive: true });
  await writeFile(join(GATE_ARTIFACT_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function preserveRunner(): Promise<Record<string, string>> {
  if (!GATE_ARTIFACT_DIR) return {};
  const runnerDirectory = join(GATE_ARTIFACT_DIR, "runner");
  await mkdir(runnerDirectory, { recursive: true });
  const checksums: Record<string, string> = {};
  for (const path of RUNNER_PATHS) {
    const bytes = await readFile(resolve(path));
    checksums[path] = createHash("sha256").update(bytes).digest("hex").toUpperCase();
    await writeFile(join(runnerDirectory, basename(path)), bytes);
  }
  await writeFile(join(GATE_ARTIFACT_DIR, "REPRODUCE.md"), [
    "# Reproduce the M2 browser gate",
    "",
    "From the ScadMill repository root in PowerShell:",
    "",
    "```powershell",
    `$env:SCADMILL_GATE_ARTIFACT_DIR = "${GATE_ARTIFACT_DIR}"`,
    REPRODUCTION_COMMAND,
    "```",
    "",
    "The exact runner and Playwright configuration used for this evidence are retained in `runner/`.",
    "",
  ].join("\n"), "utf8");
  return checksums;
}

test.describe("M2 real-browser gate", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("fresh missing-engine session preserves autosave and composes a startup share", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/");
    await expect(page.getByRole("status").filter({ hasText: "OpenSCAD is unavailable" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Render preview", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Full render", exact: true })).toBeDisabled();
    await expect(page.getByRole("tab", { name: "Untitled", exact: true })).toBeVisible();
    expect(await editorSource(page)).toBe("");
    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual([]);
    await expect(page.getByRole("region", { name: "Console" })).toBeHidden();
    const viewer = page.locator(".workspace-viewer-surface");
    await expect(viewer).toBeVisible();
    await expect.poll(async () => Math.round((await viewer.boundingBox())?.height ?? 0))
      .toBeGreaterThanOrEqual(260);
    await expect.poll(() => indexedDbNames(page)).toContain(DATABASE_NAME);

    if (GATE_ARTIFACT_DIR) {
      await mkdir(GATE_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({
        fullPage: true,
        path: join(GATE_ARTIFACT_DIR, "first-run-dependency-absent.png"),
      });
      await writeFile(
        join(GATE_ARTIFACT_DIR, "first-run-dependency-absent.html"),
        await page.content(),
        "utf8",
      );
    }

    const persistedSource = [
      "module persisted_gate(size = 7) {",
      "  cube([size, size + 1, 2]);",
      "}",
      "persisted_gate();",
    ].join("\n");
    await replaceEditorSource(page, persistedSource);
    await expect.poll(() => page.evaluate(
      (key) => localStorage.getItem(key),
      SCRATCH_AUTOSAVE_KEY,
    )).toBe(persistedSource);
    await expect(page.getByRole("tab", { name: "Untitled", exact: true })).toBeVisible();

    await page.reload();
    await expect.poll(() => editorSource(page)).toBe(persistedSource);

    const sharedSource = "// shared startup source\nsphere(13);";
    await page.goto(`/?gate-share-session=1${sourceShareFragment(sharedSource)}`);
    const tabs = page.getByRole("tablist", { name: "Open documents" });
    await expect(tabs.getByRole("tab")).toHaveCount(2);
    await expect(page.getByRole("complementary", { name: "Shared-source notice" })).toBeVisible();
    await tabs.getByRole("tab", { name: "Untitled", exact: true }).click();
    await expect.poll(() => editorSource(page)).toBe(persistedSource);
    await tabs.getByRole("tab", { name: /^Untitled 2/u }).click();
    await expect.poll(() => editorSource(page)).toBe(sharedSource);

    await page.goto("/");
    await expect(tabs.getByRole("tab")).toHaveCount(1);
    await expect.poll(() => editorSource(page)).toBe(persistedSource);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);

    const runnerChecksums = await preserveRunner();
    await writeGateJson("first-run-attestation.json", {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      profile: "fresh Playwright Chromium context",
      viewport: { width: 1280, height: 720 },
      dependency: { openscad: "ABSENT (web target uses UnavailableEngineService)" },
      initialData: { document: "Untitled", source: "", project: "none" },
      initialStorageKeys: [],
      renderDisabled: true,
      consoleInitiallyHidden: true,
      viewerMinimumObservedHeight: 260,
      autosave: { key: SCRATCH_AUTOSAVE_KEY, exactSource: persistedSource, survivedReload: true },
      startupShare: {
        exactSource: sharedSource,
        separateTab: "Untitled 2",
        persistedScratchPreserved: true,
      },
      finalStorageKeys: await page.evaluate(() => Object.keys(localStorage).sort()),
      indexedDbNames: await indexedDbNames(page),
      runner: {
        command: REPRODUCTION_COMMAND,
        files: runnerChecksums,
      },
      pageErrors,
      consoleErrors,
    });
  });

  test("real IndexedDB persists create, write, move, trash, reload, and binary bytes", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const projectId = "m2-real-indexeddb-project";
    const mainSource = "// durable main source\ncube([17, 18, 19]);";
    const draftSource = "cylinder(h = 9, r = 2);";
    const importedSource = "// binary project\nsphere(11);";
    const binaryBytes = Uint8Array.from([0, 255, 137, 80, 78, 71, 10, 42]);

    await page.goto("/");
    const files = await openFilesPanel(page);
    await files.getByRole("textbox", { name: "Project name" }).fill(projectId);
    await files.getByRole("button", { name: "Open project", exact: true }).click();
    const confirmation = files.getByRole("dialog", { name: "Confirm project replacement" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Confirm project replacement" }).click();

    await replaceEditorSource(page, mainSource);
    await files.getByRole("button", { name: "Save active file" }).click();
    await expect.poll(async () => {
      const project = (await indexedDbProjects(page)).find((record) => record.projectId === projectId);
      return project?.files.find(({ path }) => path === "main.scad")?.text;
    }).toBe(mainSource);

    await files.getByRole("button", { name: "New file", exact: true }).click();
    await files.getByRole("textbox", { name: "New project-relative file path" }).fill("draft.scad");
    await files.getByRole("button", { name: "Create file", exact: true }).click();
    await replaceEditorSource(page, draftSource);
    await files.getByRole("button", { name: "Save active file" }).click();
    const moveDraft = files.getByRole("button", { name: "Move draft.scad", exact: true });
    await expect(moveDraft).toBeEnabled();
    await moveDraft.click();
    await files.getByRole("textbox", { name: "New project path for draft.scad" })
      .fill("parts/draft.scad");
    await files.getByRole("button", { name: "Confirm move of draft.scad" }).click();
    await expect.poll(async () => {
      const project = (await indexedDbProjects(page)).find((record) => record.projectId === projectId);
      return project?.files.find(({ path }) => path === "parts/draft.scad")?.text;
    }).toBe(draftSource);

    await page.getByRole("button", { name: "Close draft.scad" }).click();
    await files.getByRole("button", { name: "Expand parts" }).click();
    await files.getByRole("button", { name: "Move parts/draft.scad to trash" }).click();
    await expect.poll(async () => {
      const project = (await indexedDbProjects(page)).find((record) => record.projectId === projectId);
      return project?.files.some(({ path }) => path === "parts/draft.scad");
    }).toBe(false);

    await files.getByLabel("Import project ZIP").setInputFiles({
      name: "binary-gate.zip",
      mimeType: "application/zip",
      buffer: binaryProjectZip(importedSource, binaryBytes),
    });
    await expect(files.getByRole("status")).toHaveText("Imported project binary-gate.");
    const beforeReload = await indexedDbProjects(page);
    const imported = beforeReload.find((record) =>
      record.files.some(({ path }) => path === "assets/pixel.bin")
    );
    expect(imported?.files.find(({ path }) => path === "main.scad")?.text).toBe(importedSource);
    expect(imported?.files.find(({ path }) => path === "assets/pixel.bin")?.bytes)
      .toEqual([...binaryBytes]);

    await page.reload();
    const reloadedFiles = await openFilesPanel(page);
    await reloadedFiles.getByRole("textbox", { name: "Project name" }).fill(projectId);
    await reloadedFiles.getByRole("button", { name: "Open project", exact: true }).click();
    await reloadedFiles.getByRole("dialog", { name: "Confirm project replacement" })
      .getByRole("button", { name: "Confirm project replacement" }).click();
    await expect.poll(() => editorSource(page)).toBe(mainSource);
    const afterReload = await indexedDbProjects(page);
    const reloadedImported = afterReload.find(({ projectId: id }) => id === imported?.projectId);
    expect(reloadedImported?.files.find(({ path }) => path === "assets/pixel.bin")?.bytes)
      .toEqual([...binaryBytes]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);

    await preserveRunner();
    await writeGateJson("indexeddb-attestation.json", {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      browserStorage: "native Chromium IndexedDB",
      databaseName: DATABASE_NAME,
      operations: ["create", "write", "move", "trash", "reload", "binary roundtrip"],
      projectId,
      exactMainSource: mainSource,
      trashedPathAbsent: true,
      importedProjectId: imported?.projectId,
      binaryPath: "assets/pixel.bin",
      binaryBytes: [...binaryBytes],
      recordsAfterReload: afterReload,
      pageErrors,
      consoleErrors,
    });
  });
});

test.describe("M2 compact first run", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the missing-engine first run usable on a mobile viewport", async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto("/");
    await expect(page.getByRole("tab", { name: "Untitled", exact: true })).toBeVisible();
    expect(await editorSource(page)).toBe("");
    await expect(page.getByRole("button", { name: "Render preview", exact: true })).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: "OpenSCAD is unavailable" })).toBeVisible();
    await page.getByRole("button", { name: "Model", exact: true }).click();
    await expect(page.locator(".workspace-viewer-surface")).toBeVisible();
    await expect(page.getByRole("region", { name: "Console" })).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth === document.body.clientWidth))
      .toBe(true);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
