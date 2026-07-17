import { expect, test, type Page } from "@playwright/test";

import { dismissWelcome } from "./helpers/welcome";

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

test("browser Create workspace is discoverable and reopens without an internal id", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await dismissWelcome(page);
  const files = page.getByRole("region", { name: "Files panel" });
  await expect(files.getByRole("button", { name: "Create workspace" })).toBeVisible();
  await expect(files.getByRole("button", { name: "Open workspace" })).toBeVisible();

  await files.getByRole("button", { name: "Create workspace" }).click();
  await files.getByRole("textbox", { name: "Workspace name" }).fill("Gear Lab");
  await files.getByRole("button", { name: "Create and open workspace" }).click();
  await page.getByRole("button", { name: "Confirm project replacement" }).click();
  await expect(files.getByRole("button", { name: "main.scad", exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("workspace:");

  await files.getByRole("button", { name: "New file" }).click();
  await files.getByRole("textbox", { name: "New project-relative file path" }).fill("draft.scad");
  await files.getByRole("button", { name: "Create file" }).click();
  await files.getByRole("button", { name: "Rename draft.scad" }).click();
  await files.getByRole("textbox", { name: "Rename draft.scad" }).fill("model.scad");
  await files.getByRole("button", { name: "Rename draft.scad" }).click();
  await files.getByRole("button", { name: "Move model.scad", exact: true }).click();
  await files.getByRole("textbox", { name: "New project path for model.scad" })
    .fill("parts/model.scad");
  await files.getByRole("button", { name: "Confirm move of model.scad" }).click();
  await page.getByRole("button", { name: "Close model.scad" }).click();
  await files.getByRole("button", { name: "Expand parts" }).click();
  await expect(files.getByRole("button", { name: "Move parts/model.scad to trash" }))
    .toHaveCount(0);
  await expect(files.getByRole("button", { name: "model.scad", exact: true })).toBeVisible();

  await replaceEditorSource(page, "cube(21);");
  await page.keyboard.press("Control+S");
  await expect(page.getByRole("tab", { name: "main.scad", exact: true })).toBeVisible();

  await page.reload();
  await dismissWelcome(page);
  const reloadedFiles = page.getByRole("region", { name: "Files panel" });
  await expect(reloadedFiles.getByRole("button", { name: "Reopen Gear Lab" })).toBeVisible();
  await reloadedFiles.getByRole("button", { name: "Open workspace" }).click();
  await reloadedFiles.getByRole("button", { name: "Open Gear Lab", exact: true }).click();
  await page.getByRole("button", { name: "Confirm project replacement" }).click();
  await expect.poll(() => editorSource(page)).toBe("cube(21);");
  await reloadedFiles.getByRole("button", { name: "Expand parts" }).click();
  await expect(reloadedFiles.getByRole("button", { name: "model.scad", exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("workspace:");

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
