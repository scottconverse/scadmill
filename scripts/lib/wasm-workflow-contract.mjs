import { parse } from "yaml";

const uploadAction = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";
const checkoutAction = "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5";
const actionExpression = (value) => `\u0024{{ ${value} }}`;
const requiredSourceCommit = "0a66508c67374febcfc814a73b5b948dd84a1ca3";
const requiredImage = "openscad/wasm-base@sha256:f73d33d5f2fd4c7ae4d3aaacb1e2e2deb193b878b38bb80c8235c933ac340c66";
const artifactName = "openscad-wasm-$" + "{{ env.OPENSCAD_COMMIT }}";
const requiredPaths = [
  ".github/workflows/build-openscad-wasm.yml",
];
const artifactPaths = [
  "openscad/build-web/openscad.js",
  "openscad/build-web/openscad.wasm",
  "openscad-wasm-manifest.json",
];
const stepNames = [
  "Clone and verify official source",
  "Build release WASM in the pinned official image",
  "Verify outputs and create provenance manifest",
  "Upload reproducible WASM artifact",
];
const detectorStepNames = [
  "Check out candidate history for synchronize diff",
  "Decide whether the heavyweight build is current",
];

function requireContract(condition, message) {
  if (!condition) throw new Error(`WASM workflow contract: ${message}`);
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function requireExactLines(actual, expected, message) {
  requireContract(actual.length === expected.length && expected.every((line, index) => actual[index] === line), message);
}

function requireEngineValue(source, key, expected) {
  const prefix = `${key}:`;
  const matches = String(source ?? "").split(/\r?\n/).filter((line) => line.startsWith(prefix));
  requireContract(matches.length === 1, `ENGINE_VERSION must contain exactly one ${key} entry`);
  requireContract(matches[0].slice(prefix.length).trim() === expected, `ENGINE_VERSION ${key} must match the approved value`);
}

function executable(run) {
  return String(run ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join("\n");
}

function executableLines(run) {
  return executable(run).split("\n");
}

function stepByName(steps, name) {
  const step = steps.find((candidate) => candidate?.name === name);
  requireContract(step, `missing step ${name}`);
  return step;
}

export function validateWasmWorkflow(source, engineVersionSource) {
  let workflow;
  try {
    workflow = parse(source, { strict: true });
  } catch (error) {
    throw new Error(`WASM workflow contract: malformed YAML: ${error.message}`);
  }
  requireContract(workflow && typeof workflow === "object", "root must be a mapping");
  requireContract(hasExactKeys(workflow, ["name", "on", "permissions", "env", "jobs"]), "root fields must be exact");
  requireContract(workflow.name === "Build pinned OpenSCAD WASM", "workflow name must be exact");
  const triggers = workflow.on;
  requireContract(hasExactKeys(triggers, ["workflow_dispatch", "pull_request"]), "triggers must be exactly workflow_dispatch and pull_request");
  requireContract(triggers?.workflow_dispatch !== undefined, "workflow_dispatch trigger is required");
  requireContract(triggers.workflow_dispatch === null || hasExactKeys(triggers.workflow_dispatch, []), "workflow_dispatch options must be empty");
  requireContract(hasExactKeys(triggers.pull_request, ["paths"]), "pull_request fields must contain only paths");
  const paths = triggers?.pull_request?.paths;
  requireContract(Array.isArray(paths), "pull_request.paths is required");
  requireContract(paths.length === requiredPaths.length && requiredPaths.every((path, index) => paths[index] === path), "pull_request.paths must be exactly scoped");
  requireContract(hasExactKeys(workflow.permissions, ["contents"]) && workflow.permissions.contents === "read", "permissions must contain only contents: read");
  requireContract(hasExactKeys(workflow.jobs, ["detector", "build"]), "jobs must contain only detector and build");
  requireContract(hasExactKeys(workflow.env, ["OPENSCAD_COMMIT", "WASM_IMAGE"]), "workflow environment fields must be exact");

  const image = workflow.env?.WASM_IMAGE;
  requireContract(image === requiredImage, "WASM_IMAGE must match the approved digest");
  requireContract(workflow.env?.OPENSCAD_COMMIT === requiredSourceCommit, "OPENSCAD_COMMIT must match the approved source commit");
  requireEngineValue(engineVersionSource, "wasm.required_source_commit", requiredSourceCommit);
  requireEngineValue(engineVersionSource, "wasm.container_image", requiredImage);

  const detector = workflow.jobs.detector;
  requireContract(hasExactKeys(detector, ["runs-on", "outputs", "steps"]), "detector job fields must be exact and must not override permissions");
  requireContract(detector["runs-on"] === "ubuntu-24.04", "detector runner must be exact");
  requireContract(hasExactKeys(detector.outputs, ["should_build"]) && detector.outputs.should_build === actionExpression("steps.detect.outputs.should_build"), "detector output must bind to the decision step");
  const detectorSteps = detector.steps;
  requireContract(Array.isArray(detectorSteps), "jobs.detector.steps is required");
  requireContract(detectorSteps.length === detectorStepNames.length && detectorStepNames.every((name, index) => detectorSteps[index]?.name === name), "detector step names and order must be exact");
  const checkout = stepByName(detectorSteps, detectorStepNames[0]);
  requireContract(hasExactKeys(checkout, ["name", "if", "uses", "with"]), "detector checkout fields must be exact");
  requireContract(checkout.if === "github.event_name == 'pull_request' && github.event.action == 'synchronize'", "detector checkout must run only for synchronize events");
  requireContract(checkout.uses === checkoutAction, "detector checkout action pin is incorrect");
  requireContract(hasExactKeys(checkout.with, ["fetch-depth", "persist-credentials"]), "detector checkout inputs must be exact");
  requireContract(checkout.with["fetch-depth"] === 0 && checkout.with["persist-credentials"] === false, "detector checkout must fetch history without persisted credentials");
  const decision = stepByName(detectorSteps, detectorStepNames[1]);
  requireContract(hasExactKeys(decision, ["name", "id", "shell", "env", "run"]), "detector decision fields must be exact");
  requireContract(decision.id === "detect" && decision.shell === "bash", "detector decision identity must be exact");
  requireContract(hasExactKeys(decision.env, ["EVENT_NAME", "EVENT_ACTION", "BEFORE_SHA", "AFTER_SHA"]), "detector event inputs must be exact");
  requireContract(decision.env.EVENT_NAME === actionExpression("github.event_name") && decision.env.EVENT_ACTION === actionExpression("github.event.action"), "detector event metadata bindings must be exact");
  requireContract(decision.env.BEFORE_SHA === actionExpression("github.event.before") && decision.env.AFTER_SHA === actionExpression("github.event.after"), "detector commit-range bindings must be exact");
  requireExactLines(executableLines(decision.run), [
    "set -euo pipefail",
    'if [[ "$EVENT_NAME" == "workflow_dispatch" ]]; then',
    'echo "should_build=true" >> "$GITHUB_OUTPUT"',
    'elif [[ "$EVENT_ACTION" != "synchronize" ]]; then',
    'echo "should_build=true" >> "$GITHUB_OUTPUT"',
    'elif git diff --quiet "$BEFORE_SHA" "$AFTER_SHA" -- .github/workflows/build-openscad-wasm.yml; then',
    'echo "should_build=false" >> "$GITHUB_OUTPUT"',
    "else",
    'echo "should_build=true" >> "$GITHUB_OUTPUT"',
    "fi",
  ], "detector decision commands must be exact");

  const job = workflow.jobs.build;
  requireContract(hasExactKeys(job, ["needs", "if", "runs-on", "timeout-minutes", "steps"]), "build job fields must be exact and must not override permissions");
  requireContract(job.needs === "detector" && job.if === "needs.detector.outputs.should_build == 'true'", "build must depend on the positive detector output");
  requireContract(job["runs-on"] === "ubuntu-24.04" && job["timeout-minutes"] === 90, "build runner and timeout must be exact");
  const steps = job.steps;
  requireContract(Array.isArray(steps), "jobs.build.steps is required");
  requireContract(steps.length === stepNames.length && stepNames.every((name, index) => steps[index]?.name === name), "step names and order must be exact");
  for (const step of steps.slice(0, 3)) requireContract(hasExactKeys(step, ["name", "shell", "run"]) && step.shell === "bash", `${step.name} fields must be exact`);

  const cloneLines = executableLines(stepByName(steps, stepNames[0]).run);
  requireExactLines(cloneLines, [
    "set -euo pipefail",
    "git clone --no-checkout --recurse-submodules https://github.com/openscad/openscad.git openscad",
    'git -C openscad fetch --depth 1 origin "$OPENSCAD_COMMIT"',
    'git -C openscad checkout --detach "$OPENSCAD_COMMIT"',
    "git -C openscad submodule update --init --recursive",
    'test "$(git -C openscad rev-parse HEAD)" = "$OPENSCAD_COMMIT"',
  ], "clone and source verification commands must be exact");

  const buildStep = stepByName(steps, "Build release WASM in the pinned official image");
  const buildLines = executableLines(buildStep.run);
  const exactCmake = "emcmake cmake -S . -B build-web -DCMAKE_BUILD_TYPE=Release -DEXPERIMENTAL=ON -DSNAPSHOT=ON";
  requireExactLines(buildLines, [
    "set -euo pipefail",
    "docker run --rm --platform linux/amd64 \\",
    '--volume "$PWD:/work" \\',
    "--workdir /work/openscad \\",
    '"$WASM_IMAGE" \\',
    "bash -euo pipefail -c '",
    "emcc --version | tee /tmp/emcc-version.txt",
    'grep -Eq "(^|[^0-9.])4\\.0\\.10([^0-9.]|$)" /tmp/emcc-version.txt',
    exactCmake,
    "cmake --build build-web --config Release -j2",
    "'",
  ], "container and build commands must be exact");

  const manifestLines = executableLines(stepByName(steps, stepNames[2]).run);
  requireExactLines(manifestLines, [
    "set -euo pipefail",
    "test -f openscad/build-web/openscad.js",
    "test -f openscad/build-web/openscad.wasm",
    'JS_SHA256="$(sha256sum openscad/build-web/openscad.js | cut -d \' \' -f1)"',
    'WASM_SHA256="$(sha256sum openscad/build-web/openscad.wasm | cut -d \' \' -f1)"',
    "jq -n \\",
    '--arg source_commit "$OPENSCAD_COMMIT" \\',
    '--arg container_image "$WASM_IMAGE" \\',
    '--arg emcc_version "4.0.10" \\',
    '--arg cmake_flags "-DCMAKE_BUILD_TYPE=Release -DEXPERIMENTAL=ON -DSNAPSHOT=ON" \\',
    '--arg js_sha256 "$JS_SHA256" \\',
    '--arg wasm_sha256 "$WASM_SHA256" \\',
    "'{source_commit: $source_commit, container_image: $container_image, emcc_version: $emcc_version, cmake_flags: $cmake_flags, artifacts: {\"openscad.js\": {sha256: $js_sha256}, \"openscad.wasm\": {sha256: $wasm_sha256}}}' \\",
    "> openscad-wasm-manifest.json",
  ], "output verification and manifest commands must be exact");

  const upload = stepByName(steps, "Upload reproducible WASM artifact");
  requireContract(hasExactKeys(upload, ["name", "uses", "with"]), "upload step fields must be exact");
  requireContract(upload.uses === uploadAction, "upload action pin is incorrect");
  requireContract(hasExactKeys(upload.with, ["name", "if-no-files-found", "path"]), "upload inputs must be exact");
  requireContract(upload.with.name === artifactName && upload.with["if-no-files-found"] === "error", "upload identity and missing-file policy must be exact");
  const uploaded = String(upload.with?.path ?? "").trim().split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
  requireContract(uploaded.length === artifactPaths.length && artifactPaths.every((path, index) => uploaded[index] === path), "upload path list must contain exactly the three required paths");
  return workflow;
}

export const wasmWorkflowContract = { requiredPaths, artifactPaths, uploadAction, checkoutAction, requiredSourceCommit, requiredImage };
