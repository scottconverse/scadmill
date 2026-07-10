import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanSourcePolicy } from "../../scripts/lib/source-policy.mjs";

const temporaryRoots: string[] = [];
const DOLLAR = String.fromCharCode(36);

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

  it("scans source-root composition files as component source", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "src", "main.tsx"), '<main style={{ color: "#fff" }} />;\n');

    await expect(scanSourcePolicy(root)).resolves.toContainEqual({
      file: "src/main.tsx",
      rule: "hardcoded-color",
      message: "Component source contains a hardcoded color literal: #fff.",
    });
  });

  it("applies color policy to generated, fixture, and non-token theme source", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src", "ui", "fixtures"), { recursive: true });
    await mkdir(join(root, "src", "theme", "themes"), { recursive: true });
    await writeFile(
      join(root, "src", "ui", "fixtures", "ColorFixture.tsx"),
      '<i style={{ color: "#fff" }} />;\n',
    );
    await writeFile(
      join(root, "src", "ui", "Swatch.generated.tsx"),
      '<i style={{ color: "#fff" }} />;\n',
    );
    await writeFile(
      join(root, "src", "theme", "ThemePreview.tsx"),
      '<i style={{ color: "#fff" }} />;\n',
    );
    await writeFile(
      join(root, "src", "theme", "themes", "ThemePreview.tsx"),
      '<i style={{ color: "#fff" }} />;\n',
    );

    await expect(scanSourcePolicy(root)).resolves.toEqual(
      expect.arrayContaining(
        [
          "src/theme/ThemePreview.tsx",
          "src/theme/themes/ThemePreview.tsx",
          "src/ui/Swatch.generated.tsx",
          "src/ui/fixtures/ColorFixture.tsx",
        ].map((file) => expect.objectContaining({ file, rule: "hardcoded-color" })),
      ),
    );
  });

  it("does not let CSS string content smuggle a comment opener past the color gate", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "src", "ui", "Smuggle.css"),
      '.x::before { content: "/*"; color: #fff; } /* end */\n',
    );

    await expect(scanSourcePolicy(root)).resolves.toContainEqual({
      file: "src/ui/Smuggle.css",
      rule: "hardcoded-color",
      message: "Component source contains a hardcoded color literal: #fff.",
    });
  });

  it("does not mistake the Three.js Color constructor for a CSS color literal", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "src", "ui", "Viewer.tsx"), "const mesh = new Color(themeToken);\n");

    await expect(scanSourcePolicy(root)).resolves.toEqual([]);
  });

  it.each([
    ['const style = { color: "RGB(255 0 0)" };', "RGB(255 0 0)"],
    ["const material = { color: 0xff00aa };", "0xff00aa"],
    ["const material = { color: 0xfff };", "0xfff"],
    ["const material = new Color(0xff);", "0xff"],
    ["const material = new Color(16711680);", "16711680"],
    ["material.color.setHex(0xff0000);", "0xff0000"],
    ['const style = { background: "rebeccapurple" };', "rebeccapurple"],
    ['const style = { background: "linear-gradient(#fff, var(--token))" };', "#fff"],
    ['const css = "background-image: linear-gradient(red, var(--token))";', "red"],
    ["const css = `color: rgb(255 0\n0 / 50%)`;", "rgb(255 0\n0 / 50%)"],
    ['const css = "color: color-mix(in srgb, var(--token), red)";', "red"],
    ['const css = "color: var(--token, red)";', "red"],
    ['const marker = <stop stopColor="red" />;', "red"],
    ['context.fillStyle = "red";', "red"],
    ['const mesh = new Color("red");', "red"],
    ['const css = ".edge { border-inline: 1px solid red; }";', "red"],
    ['const css = ".shadow { filter: drop-shadow(0 0 red); }";', "red"],
    ['const css = ".label { color: CanvasText; }";', "CanvasText"],
    ['mesh.color.setStyle("red");', "red"],
    ["mesh.color.set(0xff0000);", "0xff0000"],
    ["const light = new AmbientLight(\"white\");", "white"],
    ["const color = new Color(0xff_00_aa);", "0xff_00_aa"],
    ["const color = new Color(16_711_680);", "16_711_680"],
    ['const css = ".swatch { --swatch: red; }";', "red"],
    ['const css = ".link { text-decoration: underline red; }";', "red"],
    ['const css = `.x::before { content: "/*"; color: #fff; } /* end */`;', "#fff"],
    ['const style = { borderColor: "red" };', "red"],
    ['const style = { borderInline: "1px solid red" };', "red"],
    ['const style = { "--swatch": "red" };', "red"],
    ['const light = new THREE.AmbientLight("white");', "white"],
    ["const light = new AmbientLight(16777215);", "16777215"],
    ['const css = ".rule { column-rule: 1px solid red; }";', "red"],
    ['const material = new MeshStandardMaterial({ emissive: "red" });', "red"],
    ['renderer.setClearColor("red");', "red"],
    ['const fog = new Fog("white", 1, 10);', "white"],
    ['const material = new MeshPhongMaterial({ specular: "red" });', "red"],
    ['const css = ".mode { color: light-dark(var(--light), red); }";', "red"],
  ])("rejects additional component color syntax in %s", async (source, literal) => {
    const root = await fixtureRoot();
    await writeFile(join(root, "src", "ui", "Colored.tsx"), `${source}\n`);

    await expect(scanSourcePolicy(root)).resolves.toContainEqual({
      file: "src/ui/Colored.tsx",
      rule: "hardcoded-color",
      message: `Component source contains a hardcoded color literal: ${literal}.`,
    });
  });

  it.each([
    'const status = "red";\n',
    'const anchor = <a href="#face">Face</a>;\n',
    'const selector = ".badge #face { color: var(--chrome-text); }";\n',
    'const link = "https://example.test/model#face";\n',
    'const face = document.querySelector("#face");\n',
    'const css = ".face { background: url(#face); }";\n',
    'const red = theme.chrome.badgeError;\nconst style = { color: red };\n',
    'const style = { color: "var(--brand-blue)" };\n',
    `const style = \`${DOLLAR}{token} ${DOLLAR}{/* #fff */ value}\`;\n`,
    "// Example rejected value: #fff\nconst value = token;\n",
    'const value = "var(--chrome-text)";\n',
  ])("does not report non-color contexts in %s", async (source) => {
    const root = await fixtureRoot();
    await writeFile(join(root, "src", "ui", "Safe.tsx"), source);

    await expect(scanSourcePolicy(root)).resolves.toEqual([]);
  });
});
