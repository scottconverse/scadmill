import { expect, test, type Page } from "@playwright/test";

import { dismissWelcome } from "./helpers/welcome";

test.setTimeout(60_000);

async function replaceEditorSource(page: Page, source: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(source);
}

async function runFormatDocument(page: Page) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Format document" }).click();
}

test("Format document runs through the real menu and reports syntax refusal", async ({ page }) => {
  await page.goto("/");
  await dismissWelcome(page);

  await replaceEditorSource(page, "x=1+2;");
  await runFormatDocument(page);
  await expect(page.locator(".cm-content")).toHaveText("x = 1 + 2;");

  const malformed = "module broken( { cube(1);";
  await replaceEditorSource(page, malformed);
  await runFormatDocument(page);
  await expect(page.locator(".cm-content")).toHaveText(malformed);
  await expect(page.getByRole("status")).toContainText(
    "Formatting was not applied because the source contains a syntax error.",
  );
});
