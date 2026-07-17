import { expect, type Page, test } from "@playwright/test";

import { dismissWelcome } from "./helpers/welcome";

async function editorSource(page: Page): Promise<string> {
  return (await page.locator(".cm-line").allTextContents()).join("\n");
}

async function persistedProjectSource(
  page: Page,
  source: string,
): Promise<boolean> {
  return page.evaluate(async ({ databaseName, expected }) => new Promise<boolean>((resolve, reject) => {
    const opened = indexedDB.open(databaseName, 1);
    opened.onerror = () => reject(opened.error ?? new Error("Could not open project storage."));
    opened.onsuccess = () => {
      const database = opened.result;
      const transaction = database.transaction("projects", "readonly");
      const request = transaction.objectStore("projects").getAll();
      request.onerror = () => reject(request.error ?? new Error("Could not read project storage."));
      request.onsuccess = () => {
        const records = request.result as Array<{ files: Array<{ path: string; content: unknown }> }>;
        resolve(records.some(({ files }) => files.some(({ path, content }) =>
          path === "main.scad" && content === expected
        )));
        database.close();
      };
    };
  }), { databaseName: "scadmill-projects-v1", expected: source });
}

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
    await page.route("**/openscad-engine/**", (route) => route.abort());
    await page.goto("/");
    await dismissWelcome(page);
    const banners = page.locator(".workbench-banners");
    const engineBanner = banners.locator(".wasm-engine-banner[role='alert']");
    const lifecycle = banners.locator(".project-lifecycle-controls");
    const portability = banners.locator(".project-portability");
    const workspace = page.locator(".workspace-frame");

    await expect(engineBanner).toBeVisible({ timeout: 10_000 });
    await expect(engineBanner.getByRole("button", { name: "Retry engine load" })).toBeVisible();
    await expect(lifecycle).toHaveCSS("display", "none");
    await expect(portability).toHaveCSS("display", "none");
    await expect.poll(async () => {
      const [engineBox, workspaceBox] = await Promise.all([
        engineBanner.boundingBox(),
        workspace.boundingBox(),
      ]);
      if (!engineBox || !workspaceBox) return Number.POSITIVE_INFINITY;
      return Math.abs(workspaceBox.y - (engineBox.y + engineBox.height));
    }).toBeLessThan(1);
  });

  test("keeps browser editing durable through a real engine fetch failure and retries once without reload", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const onlineEngineRequests: string[] = [];
    let blockingEngine = true;
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      if (!blockingEngine && request.url().includes("/openscad-engine/")) {
        onlineEngineRequests.push(new URL(request.url()).pathname);
      }
    });
    await page.route("**/openscad-engine/**", (route) => route.abort());
    await page.goto("/");
    await dismissWelcome(page);
    await expect(page.getByRole("button", { name: "Retry engine load" })).toBeVisible({
      timeout: 10_000,
    });

    const files = page.getByRole("region", { name: "Files panel" });
    await files.getByRole("button", { name: "Create workspace" }).click();
    await files.getByRole("textbox", { name: "Workspace name" }).fill("Offline engine work");
    await files.getByRole("button", { name: "Create and open workspace" }).click();
    await files.getByRole("dialog", { name: "Confirm project replacement" })
      .getByRole("button", { name: "Confirm project replacement" }).click();

    const source = "// preserved while the engine is offline\ncube([13, 14, 15]);";
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(source);
    await expect.poll(() => editorSource(page)).toBe(source);
    await files.getByRole("button", { name: "Save active file" }).click();
    await expect.poll(() => persistedProjectSource(page, source)).toBe(true);

    await page.evaluate(() => { (globalThis as typeof globalThis & { retrySentinel?: string })
      .retrySentinel = "same-document"; });
    await page.unroute("**/openscad-engine/**");
    blockingEngine = false;
    await page.getByRole("button", { name: "Retry engine load" }).click();

    await expect(page.locator(".status-engine")).toHaveText("OpenSCAD 2026.06.12", {
      timeout: 30_000,
    });
    await expect(page.locator(".status-render")).toHaveText(/Rendered main\.scad \(3d\)/u, {
      timeout: 30_000,
    });
    expect(await page.evaluate(() =>
      (globalThis as typeof globalThis & { retrySentinel?: string }).retrySentinel
    )).toBe("same-document");
    expect(onlineEngineRequests.filter((path) => path.endsWith("/openscad.js"))).toHaveLength(1);
    expect(onlineEngineRequests.filter((path) => path.endsWith("/openscad.wasm"))).toHaveLength(1);
    expect(await persistedProjectSource(page, source)).toBe(true);
    expect(pageErrors).toEqual([]);
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
