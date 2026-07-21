import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import config from "../e2e/m4-hosted.playwright.config";

describe("M4 hosted Playwright bounds", () => {
  it("gives the composite journey a bounded envelope without retries or wider step waits", async () => {
    expect(config.timeout).toBe(480_000);
    expect(config.retries).toBe(0);
    expect(config.workers).toBe(1);
    expect(config.testMatch).toBe("m4-hosted-journey.e2e.ts");

    const journey = await readFile(
      resolve(import.meta.dirname, "../e2e/m4-hosted-journey.e2e.ts"),
      "utf8",
    );
    expect([...journey.matchAll(/\btimeout:\s*([0-9_]+)/gu)]
      .map((match) => match[1])).toEqual([
      "60_000",
      "30_000",
      "30_000",
      "30_000",
      "30_000",
      "60_000",
      "60_000",
    ]);
    expect(journey).toContain(
      'getByRole("button", { name: /^History(?:, activity pending)?$/u }).click()',
    );
    expect(journey).not.toContain(
      'getByRole("button", { name: "History", exact: true }).click()',
    );
    expect(journey.match(
      /getByLabel\("Allow tool calls for this conversation"\)\.check\(\)/gu,
    )).toHaveLength(2);
  });
});
