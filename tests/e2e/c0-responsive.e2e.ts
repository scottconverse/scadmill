import { expect, test } from "@playwright/test";

test.describe("AC-0.c responsive workspace", () => {
  test.use({ viewport: { width: 800, height: 700 } });

  test("engages narrow mode, switches Code and Model, and prevents body overflow", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
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
    expect(pageErrors).toEqual([]);
  });

  test("keeps the fresh wide viewer useful until the first render error opens Console", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    await expect(page.getByRole("region", { name: "Console" })).toBeHidden();
    const viewer = page.locator(".workspace-viewer-surface");
    await expect(viewer).toBeVisible();
    await expect
      .poll(async () => Math.round((await viewer.boundingBox())?.height ?? 0))
      .toBeGreaterThanOrEqual(260);
  });

  test("keeps capped viewer resizing aligned with its rendered and accessible size", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
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
    expect(consoleErrors).toEqual([]);
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

test.describe("AC-0.c compact mobile chrome", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps primary chrome and the engine status inside compact viewports", async ({ page }) => {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");

      const settings = page.getByRole("button", { name: "Open settings" });
      const engineStatus = page.locator(".engine-banner");
      await expect(settings).toBeVisible();
      await expect(engineStatus).toBeVisible();
      const settingsBox = await settings.boundingBox();
      const engineBox = await engineStatus.boundingBox();
      if (!settingsBox || !engineBox) throw new Error("Compact chrome geometry is unavailable.");

      expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(viewport.width);
      expect(engineBox.x + engineBox.width).toBeLessThanOrEqual(viewport.width);
      await expect
        .poll(() => page.evaluate(() => document.body.scrollWidth === document.body.clientWidth))
        .toBe(true);
    }
  });
});

test.describe("Appendix D editor pointer bindings", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("adds an Alt+Click cursor without replacing native multi-selection", async ({ page }) => {
    await page.goto("/");
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText("cube(10);\nsphere(4);\ncylinder(3);");
    const lines = content.locator(".cm-line");
    await expect(lines).toHaveCount(3);
    const first = await lines.nth(0).boundingBox();
    const second = await lines.nth(1).boundingBox();
    const third = await lines.nth(2).boundingBox();
    if (!first || !second || !third) throw new Error("Editor line geometry is unavailable.");

    await page.mouse.click(first.x + 12, first.y + first.height / 2);
    await expect(page.locator(".cm-cursor")).toHaveCount(1);
    await page.keyboard.down("Alt");
    await page.mouse.click(second.x + 20, second.y + second.height / 2);
    await page.keyboard.up("Alt");

    await expect(page.locator(".cm-cursor")).toHaveCount(2);
    await page.keyboard.down("Control");
    await page.mouse.click(third.x + 24, third.y + third.height / 2);
    await page.keyboard.up("Control");
    await expect(page.locator(".cm-cursor")).toHaveCount(3);
  });
});
