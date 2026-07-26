import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicVersion = JSON.parse(
  readFileSync(new URL("../public/release.json", import.meta.url), "utf8"),
).version;
const websiteManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const versionPattern = new RegExp(
  publicVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
);

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("starts the production preview through the Worker asset configuration", () => {
  assert.match(websiteManifest.scripts.start, /^wrangler dev /);
  assert.match(websiteManifest.scripts.start, /--config dist\/server\/wrangler\.json/);
  assert.doesNotMatch(websiteManifest.scripts.start, /vinext start/);
});

test("renders the honest, versioned product landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /OpenSCAD,[\s\S]*without losing the code/);
  assert.match(html, versionPattern);
  assert.match(html, /Download Windows beta/);
  assert.match(html, /Source-bound/);
  assert.doesNotMatch(html, /release-tested|fully release-proven/i);
  assert.match(html, /class="hero-visual" role="img" aria-label="A source model becoming rendered geometry"/);
  assert.match(html, /Printability,[\s\S]*headless CLI,[\s\S]*manufacturing estimates/);
  assert.match(html, /No public browser app yet/);
  assert.match(html, /Architecture/);
  assert.doesNotMatch(html, /Starter Project|taking shape|codex-preview/i);
});

for (const [path, expected] of [["/manual", "Official user manual"], ["/architecture", "A workbench around an engine"]]) {
  test(`renders ${path} with the current public version`, async () => {
    const response = await render(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, new RegExp(expected));
    assert.match(html, versionPattern);
    assert.doesNotMatch(html, /development (?:branch|builds?)/i);
    assert.match(html, /color-preserving 3MF/);
    if (path === "/architecture") {
      assert.match(html, /hosted-Windows/);
      assert.match(html, /source-bound/);
      assert.match(html, /final exact-main clean-environment rerun was not completed/i);
      assert.doesNotMatch(html, /Windows Sandbox install-to-uninstall/);
    }
  });
}
