import { expect, test } from "@playwright/test";

interface C5BrowserEvidence {
  readonly requests: readonly {
    readonly entryFile: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly quality: string;
    readonly timeoutMs: number;
  }[];
  readonly renderState: () => { readonly status: string };
  readonly source: () => string | undefined;
}

test.describe("V-4 Customizer slider to re-render", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("debounces a visible slider into one preview without rewriting source", async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto("/tests/e2e/fixtures/c5-customizer.html");

    const slider = page.getByLabel("Overall width");
    await expect(slider).toBeVisible();
    await expect(slider).toHaveValue("10");
    await expect(page.getByText("10 × 10 mm", { exact: true })).toBeVisible();
    const baseline = await page.evaluate(() =>
      (window as typeof window & { c5CustomizerHarness: C5BrowserEvidence })
        .c5CustomizerHarness.requests.length
    );
    expect(baseline).toBe(1);

    await slider.fill("25");

    await expect(page.locator(".parameter-slider output")).toHaveText("25");
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { c5CustomizerHarness: C5BrowserEvidence })
        .c5CustomizerHarness.requests.length
    )).toBe(2);
    const evidence = await page.evaluate(() => {
      const harness = (window as typeof window & { c5CustomizerHarness: C5BrowserEvidence })
        .c5CustomizerHarness;
      return {
        lastRequest: harness.requests.at(-1),
        source: harness.source(),
        status: harness.renderState().status,
      };
    });
    expect(evidence).toEqual({
      lastRequest: {
        entryFile: "main.scad",
        parameters: { width: 25 },
        quality: "preview",
        timeoutMs: 30_000,
      },
      source: "// Overall width\nwidth = 10; // [1:1:100]\nsquare([width, 10]);",
      status: "success",
    });
    await expect(page.getByText("25 × 10 mm", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "2D OpenSCAD drawing" })).toBeAttached();
    await page.waitForTimeout(200);
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { c5CustomizerHarness: C5BrowserEvidence })
        .c5CustomizerHarness.requests.length
    )).toBe(2);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
