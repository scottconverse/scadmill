import { expect, test } from "@playwright/test";

import { dismissWelcome } from "./helpers/welcome";

test.describe("C9 settings layout", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("keeps the header, portability controls, and sections inside the modal grid", async ({
    page,
  }) => {
    await page.goto("/");
    await dismissWelcome(page);
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
      await dismissWelcome(page);
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

  test("keeps load failures visible inside a modal that isolates the workbench", async ({ page }) => {
    await page.goto("/");
    await dismissWelcome(page);
    await page.getByRole("button", { name: "Open settings" }).click();
    const enabledDialog = page.getByRole("dialog", { name: "Settings" });
    const readAppearance = (label: string) => enabledDialog.getByLabel(label).locator("..")
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderTopColor,
          color: style.color,
        };
      });
    const enabledSettingsImport = await readAppearance("Import settings JSON");
    const enabledThemeImport = await readAppearance("Import custom theme JSON");
    await enabledDialog.getByRole("button", { name: "Close settings" }).click();
    await page.evaluate(() => {
      localStorage.setItem("scadmill:settings:v1", "{malformed");
    });
    await page.reload();
    await dismissWelcome(page);
    const workbench = page.locator(".workbench");
    await page.getByRole("button", { name: "Open settings" }).click();

    const layer = page.locator(".settings-modal-layer");
    const dialog = page.getByRole("dialog", { name: "Settings" });
    const feedback = dialog.getByRole("alert");
    const search = dialog.getByRole("searchbox", { name: "Search settings" });
    const close = dialog.getByRole("button", { name: "Close settings" });
    const exportSettings = dialog.getByRole("button", { name: "Export settings" });
    const settingsImport = dialog.getByLabel("Import settings JSON").locator("..");
    const themeImport = dialog.getByLabel("Import custom theme JSON").locator("..");
    const autoRender = page.locator(".auto-render-toggle input");
    await expect(workbench).toHaveJSProperty("inert", true);
    await expect(feedback).toContainText("Saved settings could not be read safely");
    expect(await dialog.evaluate((node) => node.closest(".workbench"))).toBeNull();
    await expect(search).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(exportSettings).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await expect(settingsImport).toHaveAttribute("aria-disabled", "true");
    await expect(settingsImport).toHaveCSS("cursor", "not-allowed");
    await expect(themeImport).toHaveCSS("cursor", "not-allowed");
    const disabledSettingsImport = await readAppearance("Import settings JSON");
    const disabledThemeImport = await readAppearance("Import custom theme JSON");
    expect(disabledSettingsImport.color).not.toBe(enabledSettingsImport.color);
    expect(disabledSettingsImport.backgroundColor).not.toBe(enabledSettingsImport.backgroundColor);
    expect(disabledSettingsImport.borderColor).not.toBe(enabledSettingsImport.borderColor);
    expect(disabledThemeImport.color).not.toBe(enabledThemeImport.color);
    expect(disabledThemeImport.backgroundColor).not.toBe(enabledThemeImport.backgroundColor);
    expect(disabledThemeImport.borderColor).not.toBe(enabledThemeImport.borderColor);
    await expect(autoRender.locator("..")).toHaveAttribute("aria-disabled", "true");
    await expect(autoRender.locator("..")).toHaveCSS("cursor", "not-allowed");

    const layerBox = await layer.boundingBox();
    const dialogBox = await dialog.boundingBox();
    const feedbackBox = await feedback.boundingBox();
    if (!layerBox || !dialogBox || !feedbackBox) {
      throw new Error("Modal feedback geometry is unavailable.");
    }
    expect(layerBox.x).toBe(0);
    expect(layerBox.y).toBe(0);
    expect(layerBox.width).toBe(1280);
    expect(layerBox.height).toBe(720);
    expect(feedbackBox.height).toBeGreaterThan(0);
    expect(feedbackBox.y).toBeGreaterThanOrEqual(dialogBox.y);
    expect(feedbackBox.y + feedbackBox.height).toBeLessThanOrEqual(
      dialogBox.y + dialogBox.height + 1,
    );

    await dialog.getByRole("button", { name: "Close settings" }).click();
    await expect(workbench).toHaveJSProperty("inert", false);
  });

  test("does not reserve a blank project strip below the visible banner", async ({ page }) => {
    await page.goto("/");
    await dismissWelcome(page);
    const banners = page.locator(".workbench-banners");
    const engineBanner = banners.locator(".engine-banner");
    const lifecycle = banners.locator(".project-lifecycle-controls");
    const portability = banners.locator(".project-portability");
    const workspace = page.locator(".workspace-frame");

    await expect(engineBanner).toBeVisible();
    await expect(lifecycle).toHaveCSS("display", "none");
    await expect(portability).toHaveCSS("display", "none");
    const bannersBox = await banners.boundingBox();
    const engineBox = await engineBanner.boundingBox();
    const workspaceBox = await workspace.boundingBox();
    if (!bannersBox || !engineBox || !workspaceBox) {
      throw new Error("Workbench banner geometry is unavailable.");
    }
    expect(Math.abs(bannersBox.height - engineBox.height)).toBeLessThan(1);
    expect(Math.abs(workspaceBox.y - (engineBox.y + engineBox.height))).toBeLessThan(1);
  });

  test("animates the production render spinner while respecting reduced motion", async ({ page }) => {
    await page.goto("/");
    await dismissWelcome(page);
    await page.evaluate(async () => {
      const importModule = new Function(
        "specifier",
        "return import(specifier)",
      ) as (specifier: string) => Promise<Record<string, unknown>>;
      const react = await importModule("/@id/react") as Record<string, unknown> & {
        default?: { createElement: (component: unknown, props: unknown) => unknown };
      };
      const reactDom = await importModule("/@id/react-dom/client") as Record<string, unknown> & {
        default?: { createRoot: (host: Element) => { render(node: unknown): void } };
      };
      const overlay = await importModule("/src/ui/viewer/RenderProgressOverlay.tsx") as {
        RenderProgressOverlay: unknown;
      };
      const host = document.createElement("div");
      host.id = "production-spinner-fixture";
      document.body.append(host);
      const createElement = (react.createElement ?? react.default?.createElement) as
        (component: unknown, props: unknown) => unknown;
      const createRoot = (reactDom.createRoot ?? reactDom.default?.createRoot) as
        (target: Element) => { render(node: unknown): void };
      createRoot(host).render(createElement(
        overlay.RenderProgressOverlay,
        { startedAtMs: Date.now() },
      ));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const spinner = page.locator("#production-spinner-fixture .viewer-spinner");

    await expect(spinner).toHaveText("");
    await expect(spinner).toHaveCSS("animation-name", "viewer-spin");
    const borderColors = await spinner.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopColor, style.borderRightColor];
    });
    expect(borderColors[0]).not.toBe(borderColors[1]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(spinner).toHaveCSS("animation-name", "none");
  });
});
