import { readFileSync } from "node:fs";

import { validateWasmWorkflow } from "./lib/wasm-workflow-contract.mjs";

const workflow = readFileSync(new URL("../.github/workflows/build-openscad-wasm.yml", import.meta.url), "utf8");
const engineVersion = readFileSync(new URL("../ENGINE_VERSION", import.meta.url), "utf8");
validateWasmWorkflow(workflow, engineVersion);
console.log("OpenSCAD WASM workflow contract passed.");
