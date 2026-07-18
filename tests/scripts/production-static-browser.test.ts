import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { webBasePath } from "../../vite.config";

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8").replaceAll("\r\n", "\n") : "";
}

describe("production static browser evidence contract", () => {
  const children: ChildProcess[] = [];
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    for (const child of children.splice(0)) child.kill();
    await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {
      force: true,
      recursive: true,
    })));
  });

  it("normalizes a configurable non-root Vite deployment base and rejects URLs", () => {
    expect(webBasePath(undefined)).toBe("/");
    expect(webBasePath("scadmill/evidence")).toBe("/scadmill/evidence/");
    expect(webBasePath("/scadmill/evidence/")).toBe("/scadmill/evidence/");
    expect(() => webBasePath("https://example.test/scadmill")).toThrow(/absolute URL path/u);
    expect(() => webBasePath("/scadmill?candidate=1")).toThrow(/without query or hash/u);
  });

  it("builds for a non-root base and serves only dist through a dedicated Playwright lane", () => {
    const packageSource = readIfPresent("package.json");
    const runnerSource = readIfPresent("scripts/run-production-static-evidence.mjs");
    const viteSource = readIfPresent("vite.config.ts");
    const serverSource = readIfPresent("scripts/serve-static-dist.mjs");
    const configSource = readIfPresent("playwright.production-static.config.ts");
    const workflowSource = readIfPresent(".github/workflows/ci.yml");

    expect(packageSource).toContain('"test:e2e:production-static"');
    expect(packageSource).toContain("run-production-static-evidence.mjs");
    expect(runnerSource).toContain('SCADMILL_WEB_BASE_PATH: basePath');
    expect(runnerSource).toContain('SCADMILL_STATIC_BASE_PATH: basePath');
    expect(viteSource).toContain("SCADMILL_WEB_BASE_PATH");
    expect(serverSource).toContain('resolve(process.env.SCADMILL_STATIC_ROOT || "dist")');
    expect(serverSource).toContain("SCADMILL_STATIC_BASE_PATH");
    expect(configSource).toContain('testMatch: "m3-production-static.e2e.ts"');
    expect(configSource).toContain("SCADMILL_STATIC_BASE_PATH");
    expect(workflowSource).toContain("SCADMILL_STATIC_BASE_PATH: /scadmill-evidence/");
    expect(workflowSource).toContain("run: pnpm test:e2e:production-static");
    expect(runnerSource).toContain('run(["build"]');
    expect(workflowSource).toContain("name: Native and WASM byte parity");
    expect(workflowSource).toContain("run: pnpm test:parity");
    expect(workflowSource).toContain("name: ac4-parity-evidence");
    expect(workflowSource).toContain("name: Retain raw and canonical parity evidence");
    expect(workflowSource).toContain("if: always()");
    const acceptance = workflowSource.indexOf("run: pnpm test:e2e:production-static");
    expect(acceptance).toBeGreaterThanOrEqual(0);
  });

  it("serves files only from the configured dist root and base path", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "scadmill-static-host-"));
    temporaryRoots.push(fixture);
    const dist = join(fixture, "dist");
    await mkdir(dist);
    await writeFile(join(dist, "index.html"), "static candidate", "utf8");
    await writeFile(join(fixture, "outside.txt"), "must stay private", "utf8");
    const port = 41_875;
    const child = spawn(process.execPath, ["scripts/serve-static-dist.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SCADMILL_STATIC_BASE_PATH: "/candidate/",
        SCADMILL_STATIC_PORT: String(port),
        SCADMILL_STATIC_ROOT: dist,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    children.push(child);
    await new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error("Static server did not start.")), 5_000);
      child.once("error", rejectReady);
      child.stdout?.on("data", (chunk) => {
        if (!String(chunk).includes("ScadMill static evidence server")) return;
        clearTimeout(timeout);
        resolveReady();
      });
    });

    const origin = `http://127.0.0.1:${port}`;
    const candidate = await fetch(`${origin}/candidate/`);
    expect(candidate.status).toBe(200);
    expect(await candidate.text()).toBe("static candidate");
    expect((await fetch(`${origin}/`)).status).toBe(404);
    expect((await fetch(`${origin}/candidate/missing.txt`)).status).toBe(404);
    expect((await fetch(`${origin}/outside.txt`)).status).toBe(404);
    expect((await fetch(`${origin}/candidate/`, { method: "POST" })).status).toBe(405);
  });
});
