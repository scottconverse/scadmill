import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Q-0033 WebAssembly publication quarantine", () => {
  it("ignores the complete public engine payload until counsel resolves distribution materials", async () => {
    const gitignore = await readFile(".gitignore", "utf8");

    expect(gitignore).toContain("public/openscad-engine/");
  });
});
