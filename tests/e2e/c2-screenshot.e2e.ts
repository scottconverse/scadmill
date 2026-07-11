import { expect, test } from "@playwright/test";

interface ScreenshotEvidence {
  readonly dominant: readonly [number, number, number, number];
  readonly dominantRatio: number;
  readonly height: number;
  readonly signature: string;
  readonly width: number;
}

test.describe("AC-2.e real WebGL screenshot", () => {
  test.use({ viewport: { width: 640, height: 480 } });

  test("encodes a decodable PNG dominated by the active theme background", async ({ page }) => {
    await page.goto("/tests/e2e/fixtures/c2-screenshot.html");
    await expect(page.locator("canvas")).toHaveCount(1);

    const evidence = await page.evaluate<ScreenshotEvidence>(async () => {
      const capture = (window as typeof window & {
        captureViewerPng?: () => Promise<number[]>;
      }).captureViewerPng;
      if (!capture) throw new Error("The screenshot fixture did not expose its capture seam.");
      const bytes = Uint8Array.from(await capture());
      const signature = Array.from(bytes.slice(0, 8))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const decoded = document.createElement("canvas");
      decoded.width = bitmap.width;
      decoded.height = bitmap.height;
      const context = decoded.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Chromium could not create the PNG verification canvas.");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(0, 0, decoded.width, decoded.height).data;
      const counts = new Map<string, number>();
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const key = `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const [dominantKey, dominantCount] = [...counts.entries()]
        .sort((left, right) => right[1] - left[1])[0];
      return {
        dominant: dominantKey.split(",").map(Number) as [number, number, number, number],
        dominantRatio: dominantCount / (pixels.length / 4),
        height: decoded.height,
        signature,
        width: decoded.width,
      };
    });

    expect(evidence.signature).toBe("89504e470d0a1a0a");
    expect(evidence.width).toBeGreaterThan(1);
    expect(evidence.height).toBeGreaterThan(1);
    expect(evidence.dominant).toEqual([18, 52, 86, 255]);
    expect(evidence.dominantRatio).toBeGreaterThan(0.9);
  });
});
