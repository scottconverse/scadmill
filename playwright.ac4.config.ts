import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/parity",
  testMatch: "**/*.parity.ts",
  outputDir: "test-results/ac4-parity",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 480_000,
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
