import { expect, test } from "@playwright/test";

test.describe("C9 settings layout", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("keeps the header, portability controls, and sections inside the modal grid", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();

    const dialog = page.getByRole("dialog", { name: "Settings" });
    const header = dialog.locator(".settings-dialog-header");
    const sections = dialog.locator(".settings-sections");

    await expect(dialog).toHaveCSS("display", "grid");
    const dialogBox = await dialog.boundingBox();
    const headerBox = await header.boundingBox();
    const sectionsBox = await sections.boundingBox();
    if (!dialogBox || !headerBox || !sectionsBox) {
      throw new Error("Settings layout geometry is unavailable.");
    }

    expect(Math.abs(headerBox.y - dialogBox.y)).toBeLessThan(2);
    expect(sectionsBox.y).toBeGreaterThan(headerBox.y + headerBox.height);
    expect(sectionsBox.y + sectionsBox.height).toBeLessThanOrEqual(
      dialogBox.y + dialogBox.height + 1,
    );
  });

  test("keeps every modal control reachable on compact touch viewports", async ({ page }) => {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.getByRole("button", { name: "Open settings" }).click();

      const dialog = page.getByRole("dialog", { name: "Settings" });
      const close = dialog.getByRole("button", { name: "Close settings" });
      const dialogBox = await dialog.boundingBox();
      const closeBox = await close.boundingBox();
      if (!dialogBox || !closeBox) {
        throw new Error("Narrow settings geometry is unavailable.");
      }

      expect(dialogBox.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width);
      expect(closeBox.x).toBeGreaterThanOrEqual(dialogBox.x);
      expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(viewport.width);
      await expect
        .poll(() => page.evaluate(() => document.body.scrollWidth === document.body.clientWidth))
        .toBe(true);

      await close.click();
      await expect(dialog).toBeHidden();
    }
  });
});
