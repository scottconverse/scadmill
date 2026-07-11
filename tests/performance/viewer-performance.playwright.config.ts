import { resolve } from "node:path";

import { chromium, defineConfig } from "@playwright/test";

const artifactRoot = resolve(
  process.env.SCADMILL_PERF_ARTIFACT_DIR?.trim() || "test-results/m2-viewer-performance",
);

export default defineConfig({
  testDir: ".",
  testMatch: "m2-viewer-performance.perf.ts",
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
    headless: false,
    launchOptions: {
      executablePath: chromium.executablePath(),
      args: [
        "--enable-gpu-rasterization",
        "--headless=new",
        "--ignore-gpu-blocklist",
        "--use-angle=d3d11",
      ],
    },
    trace: "on",
    viewport: { width: 1_280, height: 800 },
  },
  webServer: {
    command: "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
    cwd: process.cwd(),
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
