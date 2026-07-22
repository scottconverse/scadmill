import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

const rawBase = process.env.SCADMILL_STATIC_BASE_PATH?.trim() || "/scadmill-evidence/";
const basePath = `/${rawBase.replace(/^\/+|\/+$/gu, "")}/`.replace(/^\/\/$/u, "/");
const origin = "http://127.0.0.1:4175";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "m3-production-static.e2e.ts",
    "m4-cache-paint.e2e.ts",
    "manufacturing-estimate-offline.e2e.ts",
  ],
  outputDir: "test-results/production-static",
  forbidOnly: true,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `${origin}${basePath}`,
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve-static-dist.mjs",
    cwd: resolve("."),
    env: {
      ...process.env,
      SCADMILL_STATIC_BASE_PATH: basePath,
      SCADMILL_STATIC_ROOT: resolve("dist"),
    },
    url: `${origin}${basePath}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
