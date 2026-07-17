import { expect, test } from "@playwright/test";

test("a fresh profile opens and renders an Appendix F sample from the welcome screen", async ({
  page,
}) => {
  await page.goto("/");

  const dialog = page.getByRole("dialog", { name: "Welcome to ScadMill" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Open sample / })).toHaveCount(3);

  await dialog.getByRole("button", { name: "Open sample Gear knob" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("knob_diameter");
  await expect(page.getByRole("region", { name: "Parameters" })).toContainText("Knob");
  await expect(page.locator(".status-engine")).toHaveText("OpenSCAD 2026.06.12", {
    timeout: 30_000,
  });
  await expect(page.locator(".status-render")).toHaveText(/Rendered gear_knob\.scad \(3d\)/u, {
    timeout: 30_000,
  });
  await expect(page.locator(".bounds-readout")).toBeVisible();
});
