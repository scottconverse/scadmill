import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  testIgnore: ["m3-production-static.e2e.ts", "m4-cache-paint.e2e.ts"],
  outputDir: "test-results",
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    launchOptions: { args: ["--enable-precise-memory-info"] },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
