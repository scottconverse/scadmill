#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import { validateProvenanceChanges, validateProvenanceLedger } from "./lib/provenance.mjs";

const errors = await validateProvenanceLedger(process.cwd());
const baseArgument = process.argv.indexOf("--base");
const base =
  (baseArgument >= 0 ? process.argv[baseArgument + 1] : undefined) ??
  process.env.SCADMILL_PROVENANCE_BASE;

if (!base && process.env.CI) {
  errors.push("CI provenance validation requires an explicit comparison base");
}

if (base) {
  if (!/^[A-Fa-f0-9]{7,64}$/u.test(base)) {
    errors.push("provenance PR base must be a 7-64 character hexadecimal git object id");
  } else {
    const changedEntries = execFileSync(
      "git",
      ["diff", "--name-status", "--find-renames", `${base}...HEAD`, "--", "provenance/entries"],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    errors.push(...validateProvenanceChanges(changedEntries));
  }
}

if (errors.length > 0) {
  console.error("Provenance ledger failed validation:");
  errors.forEach((error) => {
    console.error(`- ${error}`);
  });
  process.exitCode = 1;
} else {
  const mode = base ? "PR append mode" : "baseline mode; no PR base supplied";
  console.log(`Provenance ledger passed validation (${mode}).`);
}
