import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const questions = readFileSync(new URL("../../spec/QUESTIONS.md", import.meta.url), "utf8");
const specification = readFileSync(
  new URL("../../spec/scadmill-spec-v0.6.md", import.meta.url),
  "utf8",
);
const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
const a9Ledger = readFileSync(
  new URL("../../provenance/entries/2026-07-14-a9-viewer-baseline.json", import.meta.url),
  "utf8",
);
const closureLedger = readFileSync(
  new URL(
    "../../provenance/entries/2026-07-11-m2-five-zero-review-closure.json",
    import.meta.url,
  ),
  "utf8",
);
const viewerPerformanceHarness = readFileSync(
  new URL("../performance/m2-viewer-performance.perf.ts", import.meta.url),
  "utf8",
);

describe("M2 boundary documentation", () => {
  it("records the latest exact green Q-0001 package counts", () => {
    expect(questions).toContain("passes 492 Rust packages");
    expect(questions).toContain("passes 119 npm plus 492 Rust packages");
    expect(questions).not.toContain("passes 478 Rust packages");
    expect(questions).not.toContain("passes 117 npm plus 478 Rust packages");
  });

  it("states the source-bound packaged acceptance rule without a stale run status", () => {
    expect(readme).toContain(
      "A packaged PASS is accepted only from retained evidence bound to the exact clean source commit and its self-built executable.",
    );
    expect(readme).not.toContain("await the owner-coordinated final combined clean rebuild");
    expect(changelog).toContain(
      "The oracle is called green only by a retained combined clean rebuild and Sandbox run bound to the exact source commit and executable hash.",
    );
    expect(changelog).not.toContain("final combined rebuild and Sandbox rerun remain required");
  });

  it("describes compensating settings recovery without guaranteeing rollback", () => {
    expect(readme).not.toContain("immediate application with durable rollback");
    expect(changelog).not.toContain("persistence with rollback on failure");
    expect(readme).toContain("compensating recovery that preserves concurrent edits");
    expect(changelog).toContain("reports any incomplete recovery");
    expect(changelog).toContain("Hardened the final M2 settings and secret boundary");
  });

  it("uses the owner-designated Radeon 780M benchmark instead of a 2020 minimum", () => {
    expect(specification).not.toContain("2020-class integrated GPU");
    expect(specification).toMatch(/owner-designated benchmark baseline is\s+AMD Radeon\s+780M/u);
    expect(specification).toContain("not a minimum supported-hardware claim");
    expect(specification).toContain("| A-9 | 2026-07-14 | FR-2.5, M2-R04 |");
    expect(readme).not.toContain("2020-class integrated");
    expect(readme).toContain("owner-baseline-amd-radeon-780m");
    expect(changelog).not.toContain("required 2020-class");
    expect(questions).toContain("Q-0032");
    expect(questions).toContain("AMD Radeon 780M is the owner-designated benchmark baseline");
    expect(viewerPerformanceHarness).toContain(
      'OWNER_BASELINE_QUALIFICATION = "owner-baseline-amd-radeon-780m"',
    );
    expect(viewerPerformanceHarness).toContain("TRIANGLE_COUNT !== 2_000_000");
    expect(viewerPerformanceHarness).toContain("profile.renderer).toMatch(/AMD Radeon 780M/iu)");
  });

  it("keeps Radeon qualification source-bound instead of embedding a stale run verdict", () => {
    const staticRecords = [specification, questions, readme, changelog, a9Ledger, closureLedger];
    for (const record of staticRecords) {
      expect(record).not.toContain("a9-viewer-baseline-final2");
      expect(record).not.toContain(
        "2EEC795E6D4D7E57BDEBD5F27B4B0A5C0FBA30B61DFE61732169A577D6E45C2D",
      );
    }
    expect(specification).toContain(
      "Per-candidate qualification is accepted only from retained external evidence bound to the exact candidate source tree and profiler harness.",
    );
    expect(questions).toContain(
      "Run-specific status, metrics, and hashes live only in that external artifact",
    );
    expect(readme).toContain(
      "Fully stage the candidate before applying the owner-baseline qualification",
    );
    expect(changelog).toContain(
      "Static release notes do not predeclare a per-candidate performance verdict.",
    );
    expect(a9Ledger).toContain("diagnostic only");
    expect(a9Ledger).toContain("does not predeclare current-candidate qualification");
    expect(closureLedger).toContain("retained external evidence bound to the exact candidate tree");
  });
});
