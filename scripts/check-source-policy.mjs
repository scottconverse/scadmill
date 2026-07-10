#!/usr/bin/env node
import { scanSourcePolicy } from "./lib/source-policy.mjs";

const violations = await scanSourcePolicy(process.cwd());
if (violations.length > 0) {
  console.error("Source policy violations:");
  for (const violation of violations) {
    console.error(`- ${violation.file} [${violation.rule}] ${violation.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("Source policy passed: UI files are within 400 lines and platform boundaries are intact.");
}
