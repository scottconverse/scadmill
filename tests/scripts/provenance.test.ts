import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

function validDecision() {
  return {
    id: "D-0001",
    topic: "UI platform",
    decision: "React and Tauri",
    rationale: "Shared typed UI with an out-of-process desktop engine.",
    specBasis: ["3/A-1", "6"],
  };
}

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
    decisions: [validDecision()],
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

  it("rejects a decision identifier outside the published D-number format", () => {
    const entry = validEntry();
    entry.decisions = [{ ...validDecision(), id: "not-a-decision-id" }];

    expect(validateProvenanceEntry(entry, "2026-07-09-m0-bootstrap.json")).toEqual([
      "decisions[0].id must be a decision id",
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

  it("validates every field in an optional structured decision-id correction", () => {
    const entry = validEntry();
    entry.decisionIdCorrections = [
      {
        duplicateId: "not-a-decision-id",
        declarationEntry: "Declaration Entry",
        retainedEntry: "Retained Entry",
        correctedEntry: "corrected-entry",
        authoritativeId: "D-0002",
        authorityEntry: "authority-entry",
        extra: true,
      },
    ];

    expect(validateProvenanceEntry(entry, "2026-07-09-m0-bootstrap.json")).toEqual([
      "decisionIdCorrections[0] has unknown field: extra",
      "decisionIdCorrections[0].duplicateId must be a decision id",
      "decisionIdCorrections[0].declarationEntry must be a ledger entry id",
      "decisionIdCorrections[0].retainedEntry must be a ledger entry id",
    ]);
  });
});

describe("provenance schema", () => {
  it("publishes the structured decision-id correction contract", async () => {
    const schema = JSON.parse(
      await readFile(join(process.cwd(), "provenance", "schema.json"), "utf8"),
    ) as {
      properties?: Record<string, unknown> & {
        decisions?: { items?: { properties?: Record<string, unknown> } };
      };
    };

    expect(schema.properties?.decisions?.items?.properties?.id).toEqual({
      $ref: "#/$defs/decisionId",
    });

    expect(schema.properties?.decisionIdCorrections).toEqual({
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "duplicateId",
          "declarationEntry",
          "retainedEntry",
          "correctedEntry",
          "authoritativeId",
          "authorityEntry",
        ],
        properties: {
          duplicateId: { $ref: "#/$defs/decisionId" },
          declarationEntry: { $ref: "#/$defs/entryId" },
          retainedEntry: { $ref: "#/$defs/entryId" },
          correctedEntry: { $ref: "#/$defs/entryId" },
          authoritativeId: { $ref: "#/$defs/decisionId" },
          authorityEntry: { $ref: "#/$defs/entryId" },
        },
      },
    });
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

  it("rejects duplicate decision identifiers without an append-only structured correction", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-ledger-"));
    temporaryRoots.push(root);
    const entries = join(root, "provenance", "entries");
    await mkdir(entries, { recursive: true });

    const first = { ...validEntry(), id: "first-entry" };
    const second = { ...validEntry(), id: "second-entry" };
    await writeFile(join(entries, "first-entry.json"), JSON.stringify(first));
    await writeFile(join(entries, "second-entry.json"), JSON.stringify(second));

    await expect(validateProvenanceLedger(root)).resolves.toEqual([
      "decision id D-0001 is duplicated by first-entry and second-entry without a valid append-only correction",
    ]);
  });

  it("accepts a structured correction that preserves one duplicate and assigns the other an authoritative id", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-ledger-"));
    temporaryRoots.push(root);
    const entries = join(root, "provenance", "entries");
    await mkdir(entries, { recursive: true });

    const retained = { ...validEntry(), id: "retained-entry" };
    const corrected = { ...validEntry(), id: "corrected-entry" };
    const authority = {
      ...validEntry(),
      id: "authority-entry",
      decisions: [{ ...validDecision(), id: "D-0002" }],
    };
    const registry = {
      ...validEntry(),
      id: "registry-entry",
      decisions: [{ ...validDecision(), id: "D-0003" }],
      decisionIdCorrections: [
        {
          duplicateId: "D-0001",
          declarationEntry: "registry-entry",
          retainedEntry: "retained-entry",
          correctedEntry: "corrected-entry",
          authoritativeId: "D-0002",
          authorityEntry: "authority-entry",
        },
      ],
    };

    await Promise.all(
      [retained, corrected, authority, registry].map((entry) =>
        writeFile(join(entries, `${entry.id}.json`), JSON.stringify(entry)),
      ),
    );

    await expect(validateProvenanceLedger(root)).resolves.toEqual([]);
  });

  it("rejects a correction whose declared host is not the entry that contains it", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-ledger-"));
    temporaryRoots.push(root);
    const entries = join(root, "provenance", "entries");
    await mkdir(entries, { recursive: true });

    const retained = { ...validEntry(), id: "retained-entry" };
    const corrected = { ...validEntry(), id: "corrected-entry" };
    const authority = {
      ...validEntry(),
      id: "authority-entry",
      decisions: [{ ...validDecision(), id: "D-0002" }],
    };
    const registry = {
      ...validEntry(),
      id: "registry-entry",
      decisions: [{ ...validDecision(), id: "D-0003" }],
      decisionIdCorrections: [
        {
          duplicateId: "D-0001",
          declarationEntry: "authority-entry",
          retainedEntry: "retained-entry",
          correctedEntry: "corrected-entry",
          authoritativeId: "D-0002",
          authorityEntry: "authority-entry",
        },
      ],
    };

    await Promise.all(
      [retained, corrected, authority, registry].map((entry) =>
        writeFile(join(entries, `${entry.id}.json`), JSON.stringify(entry)),
      ),
    );

    await expect(validateProvenanceLedger(root)).resolves.toEqual([
      "decision id D-0001 is duplicated by corrected-entry and retained-entry without a valid append-only correction",
    ]);
  });

  it("rejects a correction whose authority entry does not own the authoritative decision", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-ledger-"));
    temporaryRoots.push(root);
    const entries = join(root, "provenance", "entries");
    await mkdir(entries, { recursive: true });

    const retained = { ...validEntry(), id: "retained-entry" };
    const corrected = { ...validEntry(), id: "corrected-entry" };
    const authority = {
      ...validEntry(),
      id: "authority-entry",
      decisions: [{ ...validDecision(), id: "D-0002" }],
    };
    const registry = {
      ...validEntry(),
      id: "registry-entry",
      decisions: [{ ...validDecision(), id: "D-0003" }],
      decisionIdCorrections: [
        {
          duplicateId: "D-0001",
          declarationEntry: "registry-entry",
          retainedEntry: "retained-entry",
          correctedEntry: "corrected-entry",
          authoritativeId: "D-0002",
          authorityEntry: "registry-entry",
        },
      ],
    };

    await Promise.all(
      [retained, corrected, authority, registry].map((entry) =>
        writeFile(join(entries, `${entry.id}.json`), JSON.stringify(entry)),
      ),
    );

    await expect(validateProvenanceLedger(root)).resolves.toEqual([
      "decision id D-0001 is duplicated by corrected-entry and retained-entry without a valid append-only correction",
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
