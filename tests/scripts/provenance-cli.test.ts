import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("provenance CLI release enforcement", () => {
  it("fails closed in CI when no comparison base is supplied", () => {
    const environment: NodeJS.ProcessEnv = { ...process.env, CI: "true" };
    delete environment.SCADMILL_PROVENANCE_BASE;
    const result = spawnSync(
      process.execPath,
      ["scripts/check-provenance.mjs"],
      { cwd: process.cwd(), encoding: "utf8", env: environment },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "CI provenance validation requires an explicit comparison base",
    );
  });
});
