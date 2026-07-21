import { expect, test } from "@playwright/test";

const LIMIT_MS = Number(process.env.SCADMILL_CACHE_PAINT_LIMIT_MS ?? "100");
if (!Number.isFinite(LIMIT_MS) || LIMIT_MS < 0 || LIMIT_MS > 100) {
  throw new Error(
    "SCADMILL_CACHE_PAINT_LIMIT_MS must be a non-negative finite number no greater than 100.",
  );
}

test("AC-15.a paints an unchanged cached render in under 100 ms", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
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
  await expect(page.locator(".status-render")).toHaveText(/Rendered .+ \(3d\)$/u, {
    timeout: 30_000,
  });

  const elapsedMs = await page.evaluate(async () => {
    const status = document.querySelector<HTMLElement>(".status-render");
    const render = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Render preview");
    if (!status || !render) throw new Error("Cache paint controls are unavailable.");
    if (render.disabled) throw new Error("Render preview is unexpectedly disabled.");

    return new Promise<number>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error("Cached render did not reach the status area."));
      }, 10_000);
      const startedAt = performance.now();
      const observer = new MutationObserver(() => {
        if (!/\bcached\b/iu.test(status.textContent ?? "")) return;
        observer.disconnect();
        window.clearTimeout(timeout);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          resolve(performance.now() - startedAt);
        }));
      });
      observer.observe(status, { childList: true, characterData: true, subtree: true });
      render.click();
    });
  });

  test.info().annotations.push({
    type: "AC-15.a cached paint",
    description: `${elapsedMs.toFixed(3)} ms (limit ${LIMIT_MS} ms)`,
  });
  process.stdout.write(
    `AC-15.a cached paint: ${elapsedMs.toFixed(3)} ms (limit ${LIMIT_MS} ms)\n`,
  );
  expect(elapsedMs, `cached render painted in ${elapsedMs.toFixed(3)} ms`).toBeLessThan(LIMIT_MS);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
