import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

const artifactRoot = resolve(
  process.env.SCADMILL_M4_HOSTED_ARTIFACT_DIR?.trim()
    || "test-results/m4-hosted-artifacts",
);

export default defineConfig({
  testDir: ".",
  testMatch: "m4-hosted-journey.e2e.ts",
  timeout: 480_000,
  outputDir: resolve(artifactRoot, "playwright"),
  forbidOnly: true,
  fullyParallel: false,
  preserveOutput: "always",
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(artifactRoot, "playwright-report.json") }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4176",
    browserName: "chromium",
    headless: true,
    trace: "on",
  },
  webServer: {
    command: "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4176",
    cwd: resolve(import.meta.dirname, "../.."),
    url: "http://127.0.0.1:4176",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
