import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the honest, versioned product landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /OpenSCAD,[\s\S]*without losing the code/);
  assert.match(html, /0\.1\.0-beta\.2/);
  assert.match(html, /Download Windows beta/);
  assert.match(html, /Lifecycle-tested/);
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
    assert.match(html, /0\.1\.0-beta\.2/);
    assert.doesNotMatch(html, /development (?:branch|builds?)/i);
    assert.match(html, /color-preserving 3MF/);
    if (path === "/architecture") {
      assert.match(html, /hosted-Windows/);
      assert.match(html, /source-bound/);
      assert.doesNotMatch(html, /Windows Sandbox install-to-uninstall/);
    }
  });
}
