import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

const artifactRoot = resolve(
  process.env.SCADMILL_GATE_ARTIFACT_DIR?.trim() || "test-results/m2-gate-artifacts",
);

export default defineConfig({
  testDir: ".",
  testMatch: [
    "m2-browser-gate.e2e.ts",
    "m2-storage-fallback.e2e.ts",
    "m2-svg-viewer.e2e.ts",
  ],
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
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    trace: "on",
  },
  webServer: {
    command: "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
    cwd: process.cwd(),
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
