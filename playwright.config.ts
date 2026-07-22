import { defineConfig } from "@playwright/test";

const port = process.env.SCADMILL_E2E_PORT?.trim() || "4173";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  testIgnore: [
    "m3-production-static.e2e.ts",
    "m4-cache-paint.e2e.ts",
    "m4-hosted-journey.e2e.ts",
  ],
  outputDir: "test-results",
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    headless: true,
    launchOptions: { args: ["--enable-precise-memory-info"] },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
