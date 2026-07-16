import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validateWasmWorkflow, wasmWorkflowContract } from "../../scripts/lib/wasm-workflow-contract.mjs";

const workflowUrl = new URL("../../.github/workflows/build-openscad-wasm.yml", import.meta.url);
const workflow = readFileSync(workflowUrl, "utf8").replaceAll("\r\n", "\n");
const engineVersion = readFileSync(new URL("../../ENGINE_VERSION", import.meta.url), "utf8");
function rejected(source: string, message: RegExp, versionSource = engineVersion) {
  expect(() => validateWasmWorkflow(source, versionSource)).toThrow(message);
}

describe("official-source OpenSCAD WASM build workflow", () => {
  it("passes the parsed workflow contract and records the reproducible recipe", () => {
    expect(validateWasmWorkflow(workflow, engineVersion)).toBeTruthy();
    expect(engineVersion).toContain("wasm.build_workflow: .github/workflows/build-openscad-wasm.yml");
    expect(engineVersion).toContain("wasm.build_status: produced and checksum-verified from the exact official source build");
  });

  it("has manual and artifact-affecting pull-request triggers", () => {
    const parsed = validateWasmWorkflow(workflow, engineVersion);
    expect(parsed.on.workflow_dispatch).toBeDefined();
    expect(parsed.on.pull_request.paths).toEqual(wasmWorkflowContract.requiredPaths);
  });

  it.each<[string, string, RegExp]>([
    ["malformed YAML", workflow.replace("jobs:\n", "jobs: [\n"), /malformed YAML/],
    ["unscoped push trigger", workflow.replace("on:\n", "on:\n  push:\n"), /triggers must be exactly/],
    ["extra pull-request event filter", workflow.replace("  pull_request:\n", "  pull_request:\n    types: [opened]\n"), /pull_request fields must contain only paths/],
    ["metadata-only ENGINE_VERSION trigger", workflow.replace("      - .github/workflows/build-openscad-wasm.yml", "      - ENGINE_VERSION\n      - .github/workflows/build-openscad-wasm.yml"), /pull_request.paths must be exactly scoped/],
    ["root command defaults", workflow.replace("permissions:\n", "defaults:\n  run:\n    working-directory: /tmp\n\npermissions:\n"), /root fields must be exact/],
    ["Git clone redirect environment", workflow.replace("  OPENSCAD_COMMIT:", "  GIT_CONFIG_COUNT: 1\n  GIT_CONFIG_KEY_0: url.https://attacker.invalid/.insteadOf\n  GIT_CONFIG_VALUE_0: https://github.com/\n  OPENSCAD_COMMIT:"), /workflow environment fields must be exact/],
    ["commented HEAD verification", workflow.replace('          test "$(git -C openscad rev-parse HEAD)" = "$OPENSCAD_COMMIT"', '          # test "$(git -C openscad rev-parse HEAD)" = "$OPENSCAD_COMMIT"'), /source verification commands must be exact/],
    ["removed HEAD verification", workflow.replace('          test "$(git -C openscad rev-parse HEAD)" = "$OPENSCAD_COMMIT"\n', ""), /source verification commands must be exact/],
    ["wrong source commit", workflow.replace(wasmWorkflowContract.requiredSourceCommit, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), /approved source commit/],
    ["wrong container digest", workflow.replace(wasmWorkflowContract.requiredImage, "openscad/wasm-base@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), /approved digest/],
    ["unbound image", workflow.replace('            "$WASM_IMAGE" \\\n', `            "${wasmWorkflowContract.requiredImage}" \\\n`), /container and build commands must be exact/],
    ["remote submodules", workflow.replace("submodule update --init --recursive", "submodule update --remote --init --recursive"), /source verification commands must be exact/],
    ["missing toolchain check", workflow.replace('              grep -Eq "(^|[^0-9.])4\\.0\\.10([^0-9.]|$)" /tmp/emcc-version.txt\n', ""), /container and build commands must be exact/],
    ["extra build command", workflow.replace("              cmake --build build-web --config Release -j2", "              echo injected\n              cmake --build build-web --config Release -j2"), /container and build commands must be exact/],
    ["JavaScript hash not passed to jq", workflow.replace('--arg js_sha256 "$JS_SHA256"', '--arg js_sha256 "missing"'), /manifest commands must be exact/],
    ["WASM hash not passed to jq", workflow.replace('--arg wasm_sha256 "$WASM_SHA256"', '--arg wasm_sha256 "missing"'), /manifest commands must be exact/],
    ["JavaScript hash overwritten", workflow.replace("          jq -n \\", '          JS_SHA256="not-the-output-hash"\n          jq -n \\'), /manifest commands must be exact/],
    ["extra write permission", workflow.replace("  contents: read", "  contents: read\n  id-token: write"), /permissions must contain only contents: read/],
    ["job permission override", workflow.replace("  build:\n    runs-on:", "  build:\n    permissions:\n      contents: write\n    runs-on:"), /build job fields must be exact/],
    ["extra executable step", workflow.replace("      - name: Upload reproducible WASM artifact", "      - name: Injected command\n        shell: bash\n        run: echo injected\n\n      - name: Upload reproducible WASM artifact"), /step names and order must be exact/],
  ])("rejects %s", (_name, mutation, message) => rejected(mutation, message));

  it.each<[string, string, RegExp]>([
    ["wrong canonical source pin", engineVersion.replace(`wasm.required_source_commit: ${wasmWorkflowContract.requiredSourceCommit}`, "wasm.required_source_commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), /required_source_commit must match/],
    ["duplicate source pin", `${engineVersion}\nwasm.required_source_commit: ${wasmWorkflowContract.requiredSourceCommit}\n`, /exactly one wasm.required_source_commit/],
    ["disconnected expected source text", `${engineVersion.replace(`wasm.required_source_commit: ${wasmWorkflowContract.requiredSourceCommit}`, "wasm.required_source_commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")}\nnote: wasm.required_source_commit: ${wasmWorkflowContract.requiredSourceCommit}\n`, /required_source_commit must match/],
    ["wrong canonical image pin", engineVersion.replace(`wasm.container_image: ${wasmWorkflowContract.requiredImage}`, "wasm.container_image: openscad/wasm-base@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), /container_image must match/],
  ])("rejects ENGINE_VERSION %s", (_name, versionMutation, message) => rejected(workflow, message, versionMutation));
});
