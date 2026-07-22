import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test, type Download, type Locator, type Page } from "@playwright/test";

const ARTIFACT_DIRECTORY = process.env.SCADMILL_BATCH_EXPORT_ARTIFACT_DIR?.trim()
  ? resolve(process.env.SCADMILL_BATCH_EXPORT_ARTIFACT_DIR)
  : null;
const SUCCESS_SOURCE = [
  "// Batch width",
  "width = 10; // [10:10:30]",
  "cube([width, 10, 10]);",
].join("\n");
const FAILURE_SOURCE = [
  "// Batch width",
  "width = 10; // [10:10:30]",
  'assert(width != 20, "intentional item-two failure");',
  "cube([width, 10, 10]);",
].join("\n");
const SETS = [
  { name: "Small", width: 10 },
  { name: "Middle", width: 20 },
  { name: "Large", width: 30 },
] as const;

interface DownloadEvidence {
  readonly bytes: number;
  readonly fileName: string;
  readonly maximum: readonly [number, number, number];
  readonly minimum: readonly [number, number, number];
  readonly sha256: string;
  readonly triangleCount: number;
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

async function saveParameterSets(page: Page): Promise<void> {
  const parameters = page.getByRole("region", { name: "Parameters" });
  const width = parameters.getByLabel("Batch width");
  const name = parameters.getByLabel("Parameter set name");
  const saved = parameters.getByLabel("Parameter set", { exact: true });
  await expect(width).toBeVisible();
  for (const set of SETS) {
    await width.fill(String(set.width));
    await name.fill(set.name);
    await parameters.getByRole("button", { name: "Save parameter set" }).click();
    await expect(saved).toHaveValue(set.name);
  }
  await expect(saved.locator("option")).toHaveCount(4);
}

async function configureBatchDialog(
  files: Locator,
  template: string,
): Promise<Locator> {
  await files.getByRole("button", { name: "Export\u2026", exact: true }).click();
  const dialog = files.getByRole("dialog", { name: /Export .+/u });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Format" }).selectOption("stl-binary");
  await dialog.getByRole("radio", { name: "Batch parameter sets" }).check();
  for (const { name } of SETS) await dialog.getByRole("checkbox", { name }).uncheck();
  for (const { name } of SETS) await dialog.getByRole("checkbox", { name }).check();
  await dialog.getByRole("textbox", { name: "File name template" }).fill(template);
  return dialog;
}

function inspectBinaryStl(bytes: Uint8Array): Omit<DownloadEvidence, "fileName" | "sha256"> {
  expect(bytes.byteLength).toBeGreaterThanOrEqual(84);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(80, true);
  expect(bytes.byteLength).toBe(84 + triangleCount * 50);
  const minimum = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const vertices = 84 + triangle * 50 + 12;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = view.getFloat32(vertices + (vertex * 3 + axis) * 4, true);
        minimum[axis] = Math.min(minimum[axis] ?? value, value);
        maximum[axis] = Math.max(maximum[axis] ?? value, value);
      }
    }
  }
  return {
    bytes: bytes.byteLength,
    maximum: maximum as [number, number, number],
    minimum: minimum as [number, number, number],
    triangleCount,
  };
}

async function inspectDownload(
  download: Download,
  expectedName: string,
  expectedWidth: number,
  phase: "success" | "failure",
): Promise<DownloadEvidence> {
  expect(download.suggestedFilename()).toBe(expectedName);
  const path = await download.path();
  if (!path) throw new Error(`The ${expectedName} browser download has no readable path.`);
  const bytes = await readFile(path);
  const geometry = inspectBinaryStl(bytes);
  expect(geometry.triangleCount).toBe(12);
  expect(geometry.minimum).toEqual([0, 0, 0]);
  expect(geometry.maximum).toEqual([expectedWidth, 10, 10]);
  const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  expect(sha256).toMatch(/^[0-9A-F]{64}$/u);
  if (ARTIFACT_DIRECTORY) {
    const output = join(ARTIFACT_DIRECTORY, phase, expectedName);
    await mkdir(resolve(output, ".."), { recursive: true });
    await writeFile(output, bytes);
  }
  return { ...geometry, fileName: expectedName, sha256 };
}

test("production composition downloads three parameter sets and preserves item one when item two fails", async ({
  page,
}) => {
  test.setTimeout(180_000);
  if (process.env.CI && !ARTIFACT_DIRECTORY) {
    throw new Error("CI must retain batch-export acceptance evidence.");
  }
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const downloads: Download[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("download", (download) => downloads.push(download));

  await page.goto("/");
  const welcome = page.getByRole("dialog", { name: "Welcome to ScadMill" });
  await welcome.getByRole("button", { name: "Open sample Parametric storage box" }).click();
  await expect(page.locator(".status-engine")).toHaveText("OpenSCAD 2026.06.12", {
    timeout: 30_000,
  });
  await expect(page.locator(".status-render")).toHaveText(/Rendered parametric_box\.scad \(3d\)/u, {
    timeout: 30_000,
  });

  await replaceEditorSource(page, SUCCESS_SOURCE);
  await saveParameterSets(page);
  const files = await openFilesPanel(page);
  const successDialog = await configureBatchDialog(files, "batch-{set}-{model}.{ext}");
  await successDialog.getByRole("button", { name: "Export selected sets" }).click();
  await expect(successDialog.getByText("3 of 3 complete")).toBeVisible({ timeout: 90_000 });
  for (const { name } of SETS) {
    await expect(successDialog.getByText(new RegExp(`${name}.*Saved`, "u"))).toBeVisible();
  }
  await expect.poll(() => downloads.length, { timeout: 90_000 }).toBe(3);

  const success = await Promise.all(SETS.map((set, index) => inspectDownload(
    downloads[index] as Download,
    `batch-${set.name}-parametric_box.stl`,
    set.width,
    "success",
  )));
  expect(new Set(success.map(({ sha256 }) => sha256)).size).toBe(3);
  const preservedItemOnePath = await (downloads[0] as Download).path();
  if (!preservedItemOnePath) throw new Error("The first successful batch item was not retained.");
  const preservedItemOneHash = success[0]?.sha256;

  await successDialog.getByRole("button", { name: "Close", exact: true }).click();
  await replaceEditorSource(page, FAILURE_SOURCE);
  const failureDialog = await configureBatchDialog(files, "failure-{set}-{model}.{ext}");
  await failureDialog.getByRole("button", { name: "Export selected sets" }).click();
  await expect(failureDialog.getByText("3 of 3 complete")).toBeVisible({ timeout: 90_000 });
  await expect(failureDialog.getByText(/Small.*Saved/u)).toBeVisible();
  await expect(failureDialog.getByText(/Middle.*Failed:/u)).toBeVisible();
  await expect(failureDialog.getByText(/Large.*Saved/u)).toBeVisible();
  await expect.poll(() => downloads.length, { timeout: 90_000 }).toBe(5);

  const failure = await Promise.all([
    inspectDownload(
      downloads[3] as Download,
      "failure-Small-parametric_box.stl",
      10,
      "failure",
    ),
    inspectDownload(
      downloads[4] as Download,
      "failure-Large-parametric_box.stl",
      30,
      "failure",
    ),
  ]);
  expect(downloads.map((download) => download.suggestedFilename()))
    .not.toContain("failure-Middle-parametric_box.stl");
  expect(createHash("sha256").update(await readFile(preservedItemOnePath)).digest("hex").toUpperCase())
    .toBe(preservedItemOneHash);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  if (ARTIFACT_DIRECTORY) {
    await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
    await writeFile(join(ARTIFACT_DIRECTORY, "batch-export-evidence.json"), `${JSON.stringify({
      schemaVersion: 1,
      status: "passed",
      engine: "OpenSCAD 2026.06.12",
      platform: process.platform,
      parameterSets: SETS,
      success: {
        template: "batch-{set}-{model}.{ext}",
        downloads: success,
      },
      itemTwoFailure: {
        template: "failure-{set}-{model}.{ext}",
        statuses: ["success", "failure", "success"],
        downloads: failure,
        failedSet: "Middle",
        failedDownloadAbsent: true,
        itemOnePreserved: true,
      },
      pageErrors,
      consoleErrors,
    }, null, 2)}\n`, "utf8");
  }
});
