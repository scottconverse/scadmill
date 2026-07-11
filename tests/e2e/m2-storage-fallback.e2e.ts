import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import { gunzipSync, strFromU8, unzipSync } from "fflate";

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

function decodeShareSource(href: string): string {
  const payload = new URL(href).hash.replace(/^#scadmill-share=v1\./u, "");
  return strFromU8(gunzipSync(Buffer.from(payload, "base64url")));
}

test("IndexedDB getter failure preserves exact share and ZIP export", async ({ context, page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4173",
  });
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        throw new DOMException("IndexedDB denied for the fallback acceptance test.", "SecurityError");
      },
    });
  });

  await page.goto("/");
  const filesButton = page.getByRole("button", { name: "Files", exact: true });
  if (await filesButton.getAttribute("aria-pressed") !== "true") await filesButton.click();
  const files = page.getByRole("region", { name: "Files panel" });
  await expect(files).toBeVisible();
  await expect(files.getByText(
    "Browser project storage is unavailable. Share links and ZIP export still work; ZIP import is disabled.",
    { exact: true },
  )).toBeVisible();
  await expect(files.getByLabel("Import project ZIP")).toBeDisabled();
  await expect(files.getByRole("button", { name: "Copy share link" })).toBeEnabled();
  await expect(files.getByRole("button", { name: "Export project ZIP" })).toBeEnabled();

  const source = "// storage-independent backup\ntext(\"雪 gear\");";
  await replaceEditorSource(page, source);
  await files.getByRole("button", { name: "Copy share link" }).click();
  await expect(files.getByRole("status")).toContainText("Share link copied");
  const shareHref = await files.getByRole("textbox", { name: "Share link" }).inputValue();
  expect(decodeShareSource(shareHref)).toBe(source);

  const downloadPromise = page.waitForEvent("download");
  await files.getByRole("button", { name: "Export project ZIP" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("The project ZIP download did not produce a readable path.");
  const entries = unzipSync(new Uint8Array(await readFile(downloadPath)));
  const manifest = JSON.parse(strFromU8(entries[".scadmill-project-v1.json"])) as {
    readonly payloadPrefix: string;
    readonly textPaths: readonly string[];
  };
  const sourcePath = manifest.textPaths.find((path) => path === "Untitled")
    ?? manifest.textPaths[0];
  if (!sourcePath) throw new Error("The fallback project ZIP did not declare its scratch source.");
  expect(strFromU8(entries[`${manifest.payloadPrefix}${sourcePath}`])).toBe(source);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
