import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  REQUIRED_ATTESTATION,
  validateProvenanceChanges,
  validateProvenanceEntry,
  validateProvenanceLedger,
} from "../../scripts/lib/provenance.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function validEntry(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "2026-07-09-m0-bootstrap",
    createdAt: "2026-07-09T22:00:00-06:00",
    summary: "Initialize the M0 walking skeleton.",
    author: { kind: "agent", name: "Codex", model: "GPT-5", role: "implementer" },
    specSections: ["2.4", "8/M0"],
    filesTouched: [{ path: "src/main.tsx", status: "added" }],
    externalInputs: [
      {
        url: "https://openscad.org/documentation.html",
        accessedOn: "2026-07-09",
        purpose: "OpenSCAD CLI behavior",
      },
    ],
    providedInputs: [
      {
        label: "Owner similarity gate",
        destination: "owner-gate/similarity_gate.py",
        sha256: "80F6C898F84A0FBD39B4521D44B820688D9A8EF2FBE40C0E74A5DC2B3659E09D",
      },
    ],
    decisions: [
      {
        id: "D-0001",
        topic: "UI platform",
        decision: "React and Tauri",
        rationale: "Shared typed UI with an out-of-process desktop engine.",
        specBasis: ["3/A-1", "6"],
      },
    ],
    testEvidence: [
      {
        criterion: "AC-2.a",
        test: "cube bounds",
        red: { command: "pnpm test", observedAt: "2026-07-09T22:00:00-06:00", outcome: "failed assertion" },
        green: { command: "pnpm test", observedAt: "2026-07-09T22:01:00-06:00", outcome: "passed" },
      },
    ],
    nearMisses: [],
    questions: [],
    attestation: REQUIRED_ATTESTATION,
  };
}

describe("validateProvenanceEntry", () => {
  it("accepts a complete v1 entry whose filename matches its id", () => {
    expect(validateProvenanceEntry(validEntry(), "2026-07-09-m0-bootstrap.json")).toEqual([]);
  });

  it("rejects an inexact attestation and unknown top-level fields", () => {
    const entry = { ...validEntry(), attestation: "Close enough", surprise: true };

    expect(validateProvenanceEntry(entry, "2026-07-09-m0-bootstrap.json")).toEqual([
      "attestation must exactly match the required clean-room statement",
      "unknown top-level field: surprise",
    ]);
  });

  it("rejects a malformed provided-input hash and a mismatched filename", () => {
    const entry = validEntry();
    entry.providedInputs = [{ label: "Gate", destination: "owner-gate/gate.py", sha256: "not-a-hash" }];

    expect(validateProvenanceEntry(entry, "wrong-name.json")).toEqual([
      "filename must be 2026-07-09-m0-bootstrap.json",
      "providedInputs[0].sha256 must be 64 hexadecimal characters",
    ]);
  });

  it("rejects nested unknown fields and incomplete evidence", () => {
    const entry = validEntry();
    entry.author = { kind: "agent", name: "Codex", model: "GPT-5", role: "implementer", extra: true };
    entry.filesTouched = [{ path: "src/main.tsx", status: "changed" }];
    entry.testEvidence = [
      {
        criterion: "AC-2.a",
        test: "cube bounds",
        red: { command: "pnpm test", observedAt: "not-a-date", outcome: "failed assertion" },
        green: { command: "pnpm test", observedAt: "2026-07-09T22:01:00-06:00" },
      },
    ];
    entry.questions = [42];

    expect(validateProvenanceEntry(entry, "2026-07-09-m0-bootstrap.json")).toEqual([
      "author has unknown field: extra",
      "filesTouched[0].status must be added, modified, deleted, or renamed",
      "testEvidence[0].red.observedAt must be an ISO-8601 timestamp",
      "testEvidence[0].green.outcome must be a non-empty string",
      "questions[0] must be a non-empty string",
    ]);
  });
});

describe("validateProvenanceLedger", () => {
  it("reports invalid JSON with its ledger filename", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-ledger-"));
    temporaryRoots.push(root);
    const entries = join(root, "provenance", "entries");
    await mkdir(entries, { recursive: true });
    await writeFile(join(entries, "broken.json"), "{ not json }");

    await expect(validateProvenanceLedger(root)).resolves.toEqual([
      "provenance/entries/broken.json: invalid JSON",
    ]);
  });
});

describe("validateProvenanceChanges", () => {
  it("requires every pull request to append an entry", () => {
    expect(validateProvenanceChanges([])).toEqual([
      "pull request must add at least one provenance/entries/*.json ledger entry",
    ]);
  });

  it("accepts one or more newly added entries", () => {
    expect(validateProvenanceChanges(["A\tprovenance/entries/2026-07-09-feature.json"])).toEqual([]);
  });

  it("rejects rewriting a historical entry even when a new entry is added", () => {
    expect(
      validateProvenanceChanges([
        "M\tprovenance/entries/2026-07-09-m0-bootstrap.json",
        "A\tprovenance/entries/2026-07-10-feature.json",
      ]),
    ).toEqual([
      "provenance/entries/2026-07-09-m0-bootstrap.json: historical ledger entries are immutable (git status M)",
    ]);
  });
});
