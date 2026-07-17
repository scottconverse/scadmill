import { expect, type Page, test } from "@playwright/test";

import { dismissWelcome } from "./helpers/welcome";

async function openFilesPanel(page: Page) {
  const button = page.getByRole("button", { name: "Files", exact: true });
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
  const panel = page.getByRole("region", { name: "Files panel" });
  await expect(panel).toBeVisible();
  return panel;
}

async function wasmCacheBytes(page: Page): Promise<readonly number[]> {
  return page.evaluate(async () => new Promise<readonly number[]>((resolveBytes, rejectBytes) => {
    const opened = indexedDB.open("scadmill-openscad-wasm-v1", 1);
    opened.onerror = () => rejectBytes(opened.error ?? new Error("Could not open WASM cache."));
    opened.onsuccess = () => {
      const database = opened.result;
      const transaction = database.transaction("artifact-bundles", "readonly");
      const request = transaction.objectStore("artifact-bundles").getAll();
      request.onerror = () => rejectBytes(request.error ?? new Error("Could not read WASM cache."));
      request.onsuccess = () => {
        const records = request.result as Array<{ javascript: Uint8Array; wasm: Uint8Array }>;
        resolveBytes(records.flatMap(({ javascript, wasm }) => [
          javascript.byteLength,
          wasm.byteLength,
        ]));
        database.close();
      };
    };
  }));
}

test("production static subpath renders from verified cache and omits desktop capabilities", async ({
  page,
}) => {
  const configuredBase = process.env.SCADMILL_STATIC_BASE_PATH?.trim() || "/scadmill-evidence/";
  const expectedBasePath = `/${configuredBase.replace(/^\/+|\/+$/gu, "")}/`
    .replace(/^\/\/$/u, "/");
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("./");
  expect(new URL(page.url()).pathname).toBe(expectedBasePath);
  const welcome = page.getByRole("dialog", { name: "Welcome to ScadMill" });
  await welcome.getByRole("button", { name: "Open sample Gear knob" }).click();
  await expect(page.locator(".status-engine")).toHaveText("OpenSCAD 2026.06.12", {
    timeout: 30_000,
  });
  await expect(page.locator(".status-render")).toHaveText(/Rendered .+ \(3d\)/u, {
    timeout: 30_000,
  });
  await expect(page.locator(".cm-content")).toContainText("knob_diameter");
  await expect.poll(() => wasmCacheBytes(page)).toEqual([100_027, 10_760_714]);

  let blockedEngineRequests = 0;
  await page.route("**/openscad-engine/**", (route) => {
    blockedEngineRequests += 1;
    return route.abort();
  });
  await page.reload();
  await dismissWelcome(page);
  await expect(page.locator(".status-engine")).toHaveText("OpenSCAD 2026.06.12", {
    timeout: 30_000,
  });
  await expect(page.locator(".status-render")).toHaveText("Idle");
  await page.getByRole("button", { name: "Render preview", exact: true }).click();
  await expect(page.locator(".status-render")).toHaveText(/Rendered .+ \(3d\)/u, {
    timeout: 30_000,
  });
  await expect(page.locator(".cm-content")).toContainText("knob_diameter");
  expect(blockedEngineRequests).toBe(0);
  expect(await wasmCacheBytes(page)).toEqual([100_027, 10_760_714]);

  const files = await openFilesPanel(page);
  await files.getByRole("button", { name: "Create workspace" }).click();
  await files.getByRole("textbox", { name: "Workspace name" }).fill("Static host proof");
  await files.getByRole("button", { name: "Create and open workspace" }).click();
  await files.getByRole("dialog", { name: "Confirm project replacement" })
    .getByRole("button", { name: "Confirm project replacement" }).click();
  await expect(files.getByRole("button", { name: "main.scad", exact: true })).toBeVisible();
  await expect(files.getByRole("button", { name: /Reveal .* in the operating system/iu }))
    .toHaveCount(0);
  await expect(files.getByRole("button", { name: /Move .* to trash/iu })).toHaveCount(0);
  for (const desktopOnly of [
    /MCP server/iu,
    /Open associated file/iu,
    /Send to slicer/iu,
    /Manage OpenSCAD versions/iu,
  ]) {
    await expect(page.getByRole("button", { name: desktopOnly })).toHaveCount(0);
  }
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
