import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8").replaceAll(
  "\r\n",
  "\n",
);

function jobBlock(jobId: string): string {
  const marker = `  ${jobId}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) {
    return "";
  }

  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/^ {2}[a-zA-Z0-9_-]+:\n/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

describe("regular CI workflow contract", () => {
  it("runs desktop-shell Rust tests in the native V-2 lane", () => {
    expect(
      jobBlock("native").includes(
        "cargo test --locked --manifest-path src/desktop-shell/src-tauri/Cargo.toml",
      ),
      "the native job must execute the desktop-shell Rust test suite",
    ).toBe(true);
  });

  it("does not describe the resolved Q-0001 license policy as blocked", () => {
    expect(workflow.includes("Q-0001"), "the regular CI workflow must not retain stale Q-0001 copy").toBe(
      false,
    );
    expect(jobBlock("native").includes("name: Rust license policy")).toBe(true);
  });

  it("runs browser acceptance on both Linux and Windows for V-4", () => {
    const acceptance = jobBlock("e2e");

    expect(acceptance.length > 0, "the regular CI workflow must define an e2e job").toBe(true);
    expect(acceptance.includes(`runs-on: \${{ matrix.os }}`)).toBe(true);
    expect(/os:\s*\[\s*ubuntu-latest,\s*windows-latest\s*\]/.test(acceptance)).toBe(true);
    expect(acceptance.includes("if: runner.os == 'Linux'")).toBe(true);
    expect(acceptance.includes("if: runner.os == 'Windows'")).toBe(true);
    expect(acceptance.includes("run: pnpm test:e2e")).toBe(true);
  });
});
