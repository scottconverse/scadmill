import { expect, test } from "@playwright/test";

test("AC-15.n estimates the last full render with no external network", async ({ page }) => {
  test.setTimeout(90_000);
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    externalRequests.push(url.href);
    return route.abort("blockedbyclient");
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("./");
  const welcome = page.getByRole("dialog", { name: "Welcome to ScadMill" });
  await welcome.getByRole("button", { name: "Open sample Gear knob" }).click();
  await expect(page.locator(".status-engine")).toHaveText("OpenSCAD 2026.06.12", {
    timeout: 30_000,
  });
  await expect(page.locator(".status-render")).toHaveText(/Rendered gear_knob\.scad \(3d\)/u, {
    timeout: 30_000,
  });

  const runsBefore = await page.locator(".console-run").count();
  await page.getByRole("button", { name: "Full render", exact: true }).click();
  await expect.poll(async () => ({
    runs: await page.locator(".console-run").count(),
    status: (await page.locator(".status-render").textContent())?.trim(),
  }), { timeout: 60_000 }).toEqual({
    runs: runsBefore + 1,
    status: "Rendered gear_knob.scad (3d)",
  });

  await page.getByRole("button", { name: "Manufacturing", exact: true }).click();
  const panel = page.getByRole("region", { name: "Manufacturing panel" });
  await panel.getByRole("button", { name: "Estimate print time and filament" }).click();

  await expect(panel.getByText(/^Estimated print time:/u)).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText(/^Estimated filament use:/u)).toBeVisible();
  const copy = (await panel.textContent())?.toLowerCase() ?? "";
  expect(copy).toContain("estimate");
  expect(copy).toContain("kiri:moto 4.7.1");
  expect(copy).toContain("generic profile");
  expect(copy).toContain("real slicer settings or printer tuning");
  expect(copy).not.toContain("print-ready");
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
