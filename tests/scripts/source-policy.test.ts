import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanSourcePolicy } from "../../scripts/lib/source-policy.mjs";

const temporaryRoots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scadmill-policy-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "src", "ui"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("scanSourcePolicy", () => {
  it("rejects UI production files beyond 400 physical lines", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "src", "ui", "Oversized.tsx"), Array.from({ length: 401 }, () => "// line").join("\n"));

    await expect(scanSourcePolicy(root)).resolves.toContainEqual({
      file: "src/ui/Oversized.tsx",
      rule: "ui-file-length",
      message: "UI source has 401 physical lines; the maximum is 400.",
    });
  });

  it("does not count a terminal newline as an extra physical line", async () => {
    const root = await fixtureRoot();
    const exactlyFourHundredLines = `${Array.from({ length: 400 }, () => "// line").join("\n")}\n`;
    await writeFile(join(root, "src", "ui", "AtLimit.tsx"), exactlyFourHundredLines);

    await expect(scanSourcePolicy(root)).resolves.toEqual([]);
  });

  it("rejects platform-specific imports from shared UI", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "src", "ui", "Leaky.tsx"), 'import { invoke } from "@tauri-apps/api/core";\n');

    await expect(scanSourcePolicy(root)).resolves.toContainEqual({
      file: "src/ui/Leaky.tsx",
      rule: "platform-boundary",
      message: "Shared UI imports a platform-specific module: @tauri-apps/api/core.",
    });
  });

  it("applies the UI file-length cap to app composition components", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src", "app"), { recursive: true });
    await writeFile(join(root, "src", "app", "Oversized.tsx"), Array.from({ length: 401 }, () => "// line").join("\n"));

    await expect(scanSourcePolicy(root)).resolves.toContainEqual({
      file: "src/app/Oversized.tsx",
      rule: "ui-file-length",
      message: "UI source has 401 physical lines; the maximum is 400.",
    });
  });

  it("rejects hardcoded color literals in component source", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "src", "ui", "Colored.tsx"), '<div style={{ color: "#fff" }} />;\n');

    await expect(scanSourcePolicy(root)).resolves.toContainEqual({
      file: "src/ui/Colored.tsx",
      rule: "hardcoded-color",
      message: "Component source contains a hardcoded color literal: #fff.",
    });
  });

  it("does not mistake the Three.js Color constructor for a CSS color literal", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "src", "ui", "Viewer.tsx"), "const mesh = new Color(themeToken);\n");

    await expect(scanSourcePolicy(root)).resolves.toEqual([]);
  });
});
