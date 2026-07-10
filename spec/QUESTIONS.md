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

## Q-0004 — Open — 2026-07-09

- **Section:** M1 C12 theming core; FR-12.4; M2 C9 settings
- **Question:** Does M1 include the user-facing control for importing a custom theme JSON file, or only the schema validator and runtime registration service, with the visible import control arriving in the M2 settings surface?
- **Evidence:** The milestone table puts theming core in M1 and the settings capability in M2; FR-12.4 requires themes to be loadable from settings without pinning which side owns the initial control.
- **Blocked:** Only the visible custom-theme import control. M1 theme schema validation, registration, shipped themes, OS/manual selection, and runtime switching continue.

## Q-0005 — Open — 2026-07-09

- **Section:** FR-12.5; AC-12.c; Appendix C
- **Question:** Which exact foreground/background token pairs and large-text classifications are normative for the automated WCAG AA contrast oracle?
- **Evidence:** Appendix C defines the tokens, while FR-12.5 requires automated contrast checks but does not define a pairing matrix. The implementation will use a conservative, ledgered matrix of normal text at 4.5:1 and UI/focus boundaries at 3:1 unless amended.
- **Blocked:** Only declaring the owner-selected contrast pair matrix final. The explicit conservative matrix, contrast utility, and shipped-theme checks continue.

## Q-0006 — Open — 2026-07-10

- **Section:** Appendix C color values; FR-12.4; FR-12.5
- **Question:** Must user-defined themes accept the entire browser CSS color grammar, including alpha and wide-gamut forms, with normalization and background compositing before contrast checks; or may custom theme tokens be restricted to opaque six-digit sRGB hex values?
- **Evidence:** Appendix C currently says only "CSS colors." The shipped-theme contrast oracle uses exact sRGB luminance on opaque hex, while contrast for alpha, `color()`, and wide-gamut values depends on normalization, gamut mapping, and the composited background. Accepting those values structurally without defining that pipeline would make FR-12.5 nondeterministic across hosts.
- **Blocked:** Final custom-theme color acceptance and contrast validation only. Exact schema parsing, shipped opaque themes, the conservative shipped-theme contrast gate, OS/manual selection, and runtime theme switching continue.

## Q-0007 — Open — 2026-07-10

- **Section:** FR-12.2; Appendix C viewer tokens
- **Question:** Is neutral Three.js illumination a rendering mechanic outside the theme palette, or which Appendix C viewer token must drive ambient and key-light color?
- **Evidence:** The M0 viewer authored a non-normative `--viewer-light` variable, but Appendix C defines no illumination token. Reusing `viewer.meshHighlight` would give that token two unrelated meanings and tint the rendered mesh. The runtime slice will remove the non-normative variable and use the renderer's neutral default while continuing to theme the visible scene background and mesh.
- **Blocked:** Only declaring viewer illumination color owner-selectable. Live switching for the normative viewer background and mesh tokens, and all unrelated theming work, continue.

## Q-0008 — Open — 2026-07-10

- **Section:** FR-0.7; AC-0.b; M1 C0; M2 C6/C9
- **Question:** Before C6 defines projects, should desktop per-project layout state live inside project workspace data or in the per-user config store keyed by a canonical project path?
- **Evidence:** C0 and AC-0.b require per-workspace restart persistence in M1, while the project and settings capabilities that own workspace identity and durable configuration are assigned to M2. The layout codec and injected persistence port do not depend on that owner decision, but the final desktop key and storage location do.
- **Blocked:** Only the final desktop persistence adapter and its canonical project-identity test. Typed layout state, mutation commands, codec validation, injected restart round trips, web profile persistence, and all UI behavior continue.

## Q-0009 — Open — 2026-07-10

- **Section:** FR-0.2, FR-0.3, FR-0.6; M1 C0; M2–M5 owning capabilities
- **Question:** Is M1 intended to deliver honest layout shells for the Files, Search, History, AI, Libraries, and Parameters destinations whose functional capabilities land in later milestones, or must any of those owning capabilities be pulled forward before the C0 layout can exit?
- **Evidence:** M1 explicitly includes C0, whose rail and viewer-column requirements name C6, C10, C11, C5, and FR-15 items scheduled for M2–M5. Implementing their product behavior in the C0 slice would exceed §2.7's coherent FR-cluster/capability-slice unit and the milestone sequence; omitting the destinations would violate the C0 layout contract.
- **Blocked:** Only claiming later-capability content inside those destinations. C0 will provide labeled, keyboard-reachable shells with truthful empty/not-yet-configured states and no controls that imply unavailable functionality.
