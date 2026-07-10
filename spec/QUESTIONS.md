# Specification questions

Numbered questions are appended here under §2.7. Only the affected work item is parked while the remaining milestone work continues.

## Q-0001 — Open — 2026-07-09

- **Section:** §6 dependency policy; V-2 license scan
- **Question:** May `Unicode-3.0` be added to the permitted-license list for transitive dependencies of the explicitly approved Tauri stack, or should the owner prescribe a Tauri/dependency pin whose complete graph uses only the licenses currently enumerated in §6?
- **Evidence:** Tauri 2.11.5's resolved Cargo graph contains 18 `Unicode-3.0` packages and one `(MIT OR Apache-2.0) AND Unicode-3.0` package. Other unfamiliar expressions offer an allowed MIT, Apache-2.0, BSD, ISC, MPL-2.0, or Zlib choice and therefore do not require a new license.
- **Blocked:** Finalizing the Rust half of the V-2 license-policy CI job and declaring the first PR fully green. No product implementation item is blocked.

## Q-0002 — Open — 2026-07-09

- **Section:** §2.2 permitted inputs; §2.4 provenance ledger
- **Question:** May primary legal and license references be consulted solely to assess engagement feasibility and interpret provenance/license policy when they do not supply product behavior, design, or implementation content, or must every such reference first be added to the §2.2 whitelist by amendment?
- **Evidence:** Before implementation began, the feasibility review consulted the GNU GPL FAQ and a U.S. Copyright Office AI report. They are truthfully retained in the ledger as pre-implementation context and were not used to produce product code, UI behavior, or architecture.
- **Blocked:** Declaring the treatment of those two pre-implementation references fully resolved under the clean-room protocol. No product implementation item is blocked.

## Q-0003 — Open — 2026-07-09

- **Section:** FR-4.3/A-2 preview quality
- **Question:** Is the configurable preview facet cap intended as a fixed global `-D $fn=<value>` override, or as a true maximum that preserves lower source values and also constrains `$fa`/`$fs`-driven tessellation?
- **Evidence:** The M0 walking skeleton currently uses a disclosed preview-only `$fn=48` override. That can increase tessellation when a model intentionally sets a lower `$fn`, so it is not truthfully a cap in every model.
- **Blocked:** Finalizing the M1 preview facet-cap algorithm. The quality-policy seam, preview/full separation, and all unrelated native-engine work continue.
