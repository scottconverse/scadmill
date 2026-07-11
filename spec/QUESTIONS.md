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
- **Implementation status (M2, 2026-07-10):** Visible custom-theme import is delivered under C9. This question remains open only for historical M1 ownership and blocks no current product work.

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

## Q-0010 — Open — 2026-07-10

- **Section:** AC-1.e; Appendix D; §2.7 milestone sequence
- **Question:** At M1, must every Appendix D command have a working product handler even when its owning capability is scheduled for M2–M5, or should every binding route through the stable command bus with an explicit unavailable result until that capability lands?
- **Evidence:** Appendix D includes commands owned by C2, C4, C6, C7, C9, and C11. Pulling every handler into M1 would contradict the milestone table, while silently omitting bindings would contradict the literal AC-1.e wording.
- **Blocked:** Only the final AC-1.e claim for later-capability commands. The command registry, routing contract, C1-owned handlers, and unrelated editor work continue.

## Q-0011 — Open — 2026-07-10

- **Section:** FR-1.7; FR-1.8; M2 C9 settings
- **Question:** Does M1 require only typed editor/keybinding defaults and runtime configuration seams, with the visible rebind/settings UI and durable preference storage arriving with C9 in M2?
- **Evidence:** C1 requires rebindable commands and editor settings in M1, but C9 owns the settings surface and persistence in M2. A typed injected configuration boundary supports both without inventing a second settings owner.
- **Blocked:** Only the visible editor-settings/rebinding UI and final durable adapter. Defaults, runtime application, the command bus, and unrelated editor work continue.
- **Implementation status (M2, 2026-07-10):** The visible settings/rebinding UI and durable per-user adapters are delivered under C9. This question remains open only for historical M1 ownership.

## Q-0012 — Open — 2026-07-10

- **Section:** AC-1.d; FR-1.1; M2 C6 project/file management
- **Question:** Should M1 satisfy save behavior through a `save-document` command and injected persistence port before C6 defines the project filesystem, or is AC-1.d intentionally parked until C6 lands in M2?
- **Evidence:** AC-1.d requires the dirty indicator to clear on save in M1, while C6 owns project files in M2. An injected port can prove lifecycle behavior without pre-deciding project storage.
- **Blocked:** Only the final save boundary and AC-1.d claim. In-memory document state, dirty tracking, command routing, and unrelated editor work continue.

## Q-0013 — Open — 2026-07-10

- **Section:** FR-1.2; FR-1.3; AC-1.a; AC-1.b; ENGINE_VERSION
- **Question:** Which engine-version reference is the normative exhaustive corpus for highlighting and built-in completion, and should completion insert named arguments, positional placeholders, or a prescribed mixture for signatures with defaults?
- **Evidence:** The public cheat sheet identifies itself as v2021.01, while A-7 now mandates the 2026.06.12 snapshot. AC-1.b requires the "correct argument skeleton" for `cube` but does not define whether that means `cube(size = 1, center = false);`, `cube([width, depth, height], center);`, or another valid form, and it does not identify the normative snapshot-era built-in corpus.
- **Blocked:** Only exhaustive AC-1.a coverage and the final AC-1.b insertion text. A version-labeled representative grammar, token classes, completion infrastructure, and unrelated editor work continue.

## Q-0014 — Open — 2026-07-10

- **Section:** FR-1.4; M2 C6 project/file management
- **Question:** Before C6 defines project discovery and file ownership, should cross-file `include`/`use` symbol completion consume an injected in-memory project-source map?
- **Evidence:** FR-1.4 is in M1, but the capability responsible for enumerating and loading project files is in M2. An injected read-only source map permits deterministic symbol analysis without choosing a filesystem policy early.
- **Blocked:** Only the cross-file source adapter. Current-file symbol analysis, a project-source port, and unrelated editor work continue.

## Q-0015 — Open — 2026-07-10

- **Section:** Appendix D; N-3 web target; AC-1.e
- **Question:** Are browser-reserved shortcuts such as Mod+W, Mod+N, Mod+O, and Ctrl+Tab normative only for the desktop shell, or must the web target provide alternate bindings that Appendix D should enumerate?
- **Evidence:** Browsers may intercept these combinations before the application receives them, so an in-app handler cannot make them reliable on the web target. Claiming universal web conformance would therefore depend on host behavior outside ScadMill's control.
- **Blocked:** Only the web acceptance claim for browser-reserved bindings. Desktop bindings, non-reserved web bindings, command routing, and unrelated editor work continue.

## Q-0016 — Open — 2026-07-10

- **Section:** FR-1.6; C8 diagnostics; AC-1.c
- **Question:** After an edit invalidates the last render, should inline diagnostics disappear immediately or remain visibly marked as stale until the next render completes?
- **Evidence:** Keeping old locations unmarked can point at the wrong text, while clearing immediately removes potentially useful feedback. The specification requires inline diagnostics and staleness-aware renders but does not define this intermediate editor state.
- **Blocked:** Only the post-edit diagnostic presentation policy. Diagnostic parsing, per-run identity, location mapping, and unrelated editor work continue.

## Q-0017 — Open — 2026-07-10

- **Section:** FR-1.3; AC-1.b
- **Question:** Are parameter names and defaults in each completion entry the complete required "signature hint," or must ScadMill also show persistent call-site help that tracks the active argument after a call is inserted?
- **Evidence:** FR-1.3 requires signature hints and AC-1.b requires the `cube` offer to carry its signature, both of which the completion list can satisfy. Neither requirement defines an active-parameter popup, overload selection, or behavior for named and out-of-order arguments after the list closes.
- **Blocked:** Only the final persistent call-site-help behavior and its acceptance claim. Version-labeled completion metadata, completion-list signatures, provisional deterministic insertion, current-file symbol analysis, and unrelated editor work continue.

## Q-0018 — Open — 2026-07-10

- **Section:** FR-1.1; FR-6.7
- **Question:** When a close button, middle-click, or Close Tab command targets a dirty document, must ScadMill present Save / Discard / Cancel, refuse closing until C6 supplies persistence, or close into crash-recovery storage?
- **Evidence:** FR-1.1 mandates three close paths but does not define unsaved-data behavior. Silently discarding would risk data loss, while save prompts and recovery overlap the still-unresolved save boundary and C6.
- **Blocked:** Only closing dirty documents. Clean close, activation, reorder, dirty tracking, and reopening clean tabs continue.

## Q-0019 — Open — 2026-07-10

- **Section:** FR-1.1; FR-6.3
- **Question:** When the final clean tab closes, should the editor become empty or immediately create a new untitled scratch document?
- **Evidence:** FR-6.3 requires startup scratch mode but does not define the post-close state. Choosing either behavior would pre-decide project/file semantics.
- **Blocked:** Only closing the final clean tab. Closing clean tabs when another document remains, activation, reorder, dirty tracking, and reopening continue.

## Q-0020 — Open — 2026-07-10

- **Section:** FR-8.2; AC-8.b; M1 C8; M2 C6 project/file management
- **Question:** Before C6 supplies project-file discovery and loading, should M1 diagnostic navigation activate only current or already-open source buffers, with opening an unloaded reported path completed through the C6 source port in M2, or must M1 introduce an injected read-only project-file loader solely for C8?
- **Evidence:** The M1 document workspace and render snapshot currently contain open text buffers only. A diagnostic can safely activate any matching open project-relative path, but opening a path that is not loaded requires source bytes, document identity, and filesystem authority owned by C6; reconstructing it from an engine message would be unsafe and lossy.
- **Blocked:** Only opening a reported file that is not already available as an open buffer. Same-file and open-cross-file diagnostic clicks, cursor movement, current-snapshot inline squiggles/gutter markers, and all unrelated M1 work continue.

## Q-0021 — Open — 2026-07-10

- **Section:** FR-4.2; Appendix A `CameraPose`; PNG export
- **Question:** May the native PNG exporter reject explicit `CameraPose` requests until an amended camera contract provides a lossless mapping for `position`, `target`, and `up`, or must ScadMill adopt a specified projection/FOV and camera-roll convention for the pinned snapshot?
- **Evidence:** The pinned OpenSCAD 2026.06.12 snapshot CLI still accepts either a six-value eye/center camera or a seven-value translate/rotate/distance camera. Neither form represents the `up` vector required by Appendix A, and the specification does not define a projection/FOV and Euler-roll conversion for the seven-value form. Passing only eye/center would silently discard valid request data. Sources: [OpenSCAD command-line manual](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment); pinned snapshot `--help` output recorded during A-7 validation.
- **Blocked:** Only PNG exports that supply an explicit camera pose. PNG exports using the engine's default camera and every non-PNG export continue. The native service returns a typed failure instead of producing an incorrectly framed artifact.

## Q-0022 — Open — 2026-07-10

- **Section:** FR-4.8; Appendix A `RenderResult.rawLog` / `ExportResult.rawLog`; N-2
- **Question:** May the result contract replace the complete in-memory `rawLog: string` with a bounded preview plus a file-backed/chunked complete-log handle (or equivalent artifact metadata), or must every operation continue materializing the complete engine log as one string regardless of size?
- **Evidence:** FR-4.8 requires every run's output captured verbatim, and Appendix A explicitly calls `rawLog` the complete interleaved engine output. An arbitrary complete string cannot also have a fixed memory bound. The native runner reads fixed 8 KiB chunks, preserves split UTF-8 code points, and caps streamed IPC/display output **per engine subprocess** at 1 MiB or 4,096 records with one ordered truncation marker while spooling the complete interleaved text to a temporary file. A 2D request invokes an STL discriminator followed by SVG export, so its operation-level live ceiling is two such budgets (2 MiB / 8,192 records and at most two markers). Cancellation/timeout may replace undelivered queued events with a truthful terminal marker while retaining the complete `rawLog`. The spool is materialized only when constructing the normative result, so live capture is bounded but the final `string` allocation and temporary file remain proportional to total engine output.
- **Blocked:** Only claiming a hard bound for final result materialization and spill-file growth under pathological engine output. UI scrollback, replayed native events, reader buffers, cancellation polling, process cleanup, and ordinary complete `rawLog` behavior are bounded or preserved independently. No complete log is silently truncated while this contract question remains open.

## Q-0023 — Open — 2026-07-10

- **Section:** §2.7/A-7 engine pin; M3 native/WASM parity
- **Question:** For the web target, must ScadMill build OpenSCAD WASM from source at commit `0a66508c67374febcfc814a73b5b948dd84a1ca3` as v0.6 explicitly requires, or may it use and validate the official exact-date `OpenSCAD-2026.06.12-WebAssembly-web.zip` artifact now present in the OpenSCAD snapshot manifest?
- **Evidence:** Section 2.7 says published prebuilt WASM snapshots stalled in August 2025 and mandates a source build. The official snapshot index accessed on 2026-07-10 lists exact-date web and node archives. The web archive SHA-256 is `509879dd6813f2c4e5cf2ce1da6420928ce9bb212cd08491ca5ec9d5bffc700b`; the node archive SHA-256 is `07c978bd06dd75a3baa8daff77483b4e9559351f11a6bc4e324e7bb34248a605`.
- **Blocked:** Only the M3 choice of WASM artifact provenance. The native 2026.06.12 pin, all M2 work, and source-build preparation continue.
