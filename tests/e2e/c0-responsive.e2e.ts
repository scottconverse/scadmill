import { expect, test } from "@playwright/test";

test.describe("AC-0.c responsive workspace", () => {
  test.use({ viewport: { width: 800, height: 700 } });

  test("engages narrow mode, switches Code and Model, and prevents body overflow", async ({
    page,
  }) => {
    await page.goto("/");

    const frame = page.locator(".workspace-frame");
    const code = page.getByRole("button", { name: "Code", exact: true });
    const model = page.getByRole("button", { name: "Model", exact: true });
    const editor = page.locator(".workspace-editor");
    const viewer = page.locator(".workspace-viewer-column");

    await expect(frame).toHaveAttribute("data-layout-mode", "narrow");
    await expect(code).toHaveAttribute("aria-pressed", "true");
    await expect(editor).toBeVisible();
    await expect(viewer).toBeHidden();

    await model.click();

    await expect(model).toHaveAttribute("aria-pressed", "true");
    await expect(editor).toBeHidden();
    await expect(viewer).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.body.scrollWidth === document.body.clientWidth))
      .toBe(true);
  });

  test("keeps capped viewer resizing aligned with its rendered and accessible size", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto("/");

    const splitter = page.getByRole("separator", { name: "Resize viewer column" });
    const viewer = page.locator(".workspace-viewer-column");
    const before = await viewer.boundingBox();
    const divider = await splitter.boundingBox();
    if (!before || !divider) throw new Error("Wide viewer geometry is unavailable.");

    expect(Math.round(before.width)).toBe(396);
    await expect(splitter).toHaveAttribute("aria-valuenow", "396");

    expect(divider.width).toBeGreaterThanOrEqual(24);
    const expandedHitX = divider.x + divider.width / 2;
    const dragY = divider.y + divider.height / 2;
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.className ?? "",
        { x: expandedHitX, y: dragY },
      ),
    ).toContain("panel-splitter");
    await page.mouse.move(expandedHitX, dragY);
    await page.mouse.down();
    await page.mouse.move(expandedHitX + 40, dragY, { steps: 5 });
    await expect(splitter).toHaveAttribute("aria-valuenow", "356");
    await page.mouse.up();
    await expect.poll(async () => Math.round((await viewer.boundingBox())?.width ?? 0)).toBe(356);
    await expect(splitter).toHaveAttribute("aria-valuenow", "356");
  });
});

test.describe("FR-0.6 mobile-web default", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit Mobile",
    viewport: { width: 1024, height: 700 },
  });

  test("uses the complete narrow presentation above the width breakpoint", async ({ page }) => {
    await page.goto("/");

    const frame = page.locator('.workspace-frame[data-layout-mode="narrow"]');
    const switcher = page.getByRole("group", { name: "Workspace view" });
    const editor = page.locator(".workspace-editor");

    await expect(frame).toBeVisible();
    await expect(switcher).toBeVisible();
    await expect(editor).toBeVisible();
    await expect
      .poll(async () => Math.round((await editor.boundingBox())?.x ?? -1))
      .toBe(44);
    await expect
      .poll(() => page.evaluate(() => document.body.scrollWidth === document.body.clientWidth))
      .toBe(true);
  });
});
