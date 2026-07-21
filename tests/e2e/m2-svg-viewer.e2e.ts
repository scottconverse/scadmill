import { expect, test } from "@playwright/test";

test("production Workbench SVG supports zoom, pan, fit, and mode recovery", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/tests/e2e/fixtures/c5-customizer.html");
  await page.getByRole("button", { name: "Collapse parameters" }).click();

  const viewport = page.getByRole("button", { name: "2D drawing viewer" });
  const drawing = page.getByRole("img", { name: "2D OpenSCAD drawing" });
  const scale = page.getByTestId("svg-scale");
  const mode = page.getByLabel("Viewer mode");
  await expect(viewport).toBeVisible();
  await expect(drawing).toBeAttached();
  await expect(page.getByText("10 × 10 mm", { exact: true })).toBeVisible();
  await expect(mode).toHaveValue("auto");
  const initialScale = await scale.textContent();
  const initialTransform = await drawing.evaluate((element) => element.style.transform);

  const box = await viewport.boundingBox();
  if (!box) throw new Error("The SVG viewport has no browser layout box.");
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.34);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => scale.textContent()).not.toBe(initialScale);
  const zoomTransform = await drawing.evaluate((element) => element.style.transform);
  expect(zoomTransform).not.toBe(initialTransform);

  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 205);
  await page.mouse.up();
  await expect.poll(() => drawing.evaluate((element) => element.style.transform))
    .not.toBe(zoomTransform);

  await page.getByRole("button", { name: "Fit drawing" }).click();
  await expect(scale).toHaveText(initialScale ?? "");
  await expect.poll(() => drawing.evaluate((element) => element.style.transform))
    .toBe(initialTransform);

  await mode.selectOption("3d");
  await expect(page.getByRole("status").filter({
    hasText: "incompatible with pinned 3D mode",
  })).toBeVisible();
  await expect(drawing).not.toBeAttached();
  await mode.selectOption("auto");
  await expect(drawing).toBeAttached();
  await expect(page.getByText("10 × 10 mm", { exact: true })).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
