import { spawnSync } from "node:child_process";

const basePath = process.env.SCADMILL_STATIC_BASE_PATH?.trim() || "/scadmill-evidence/";
const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) throw new Error("pnpm did not provide npm_execpath to the evidence runner.");

function run(arguments_, environment) {
  const result = spawnSync(process.execPath, [pnpmEntry, ...arguments_], {
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["build"], {
  ...process.env,
  SCADMILL_WEB_BASE_PATH: basePath,
});
run(["exec", "playwright", "test", "--config", "playwright.production-static.config.ts"], {
  ...process.env,
  SCADMILL_STATIC_BASE_PATH: basePath,
});
