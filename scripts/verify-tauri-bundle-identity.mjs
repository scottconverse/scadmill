#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

import { verifyTauriBundleIdentity } from "./lib/tauri-bundle-identity.mjs";

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`Missing required ${name} argument.`);
  }
  return process.argv[index + 1];
}

try {
  const builtPath = readArgument("--built");
  const packagedPath = readArgument("--packaged");
  const outputPath = readArgument("--out");
  const result = verifyTauriBundleIdentity(
    await readFile(builtPath),
    await readFile(packagedPath),
  );
  const evidence = {
    ...result,
    builtPath,
    packagedPath,
    verification:
      "Exact byte identity after reversing Tauri's documented UNK-to-NSS bundle token patch.",
  };
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(evidence));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
