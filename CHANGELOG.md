# Changelog

All notable changes to ScadMill are documented here. The format follows Keep a Changelog, and the project will adopt semantic versioning before its first public release.

## [Unreleased]

### Added

- M0 repository and clean-room provenance foundation.
- Owner-supplied isolated independence-gate workflow.
- Strict provenance schema, immutable per-pull-request ledger enforcement, and split npm/Rust license-policy checks.
- Reproducible Rust 1.96.0 toolchain with rustfmt and warning-free clippy gates for both native crates.
- Pinned OpenSCAD 2026.06.12 development-snapshot subprocess integration behind the typed engine boundary, including checksummed Windows, Linux, and macOS artifacts and the embedded upstream commit.
- The owner-provided v0.6 specification, including amendments A-7 and A-8 and the accepted M1 boundary.
- Tauri walking skeleton with a CodeMirror editor, real STL model viewer, and measured cube bounds.
- Single command bus and typed document, render, and history stores prepared for all M0–M6 consumers.
- Editor-only fallback when the native engine is absent or its version probe fails.
- Complete Light, Dark, and High Contrast Appendix C token sets, checked by exact-schema and conservative WCAG AA contrast tests.
- A strict custom-theme JSON parser with structured schema and color-validation diagnostics, forming the foundation for the settings import flow.
- Runtime theme selection that follows the OS by default, supports manual Light, Dark, and High Contrast overrides through the status bar, and applies all 64 Appendix C color variables without reload.
- A custom-theme runtime registry with stable preferences and deterministic same-name re-import replacement.
- CodeMirror theme and syntax-palette adapters for every Appendix C editor token, including selected-text foreground normalization.
- Live Three.js background and mesh recoloring that preserves the existing scene, camera, controls, geometry, and material.
- The C0 workspace shell with a three-region desktop layout, four live-preview splitters, collapsible and maximizable panels, badge-ready activity destinations, a web menu row, and an always-visible status bar.
- Responsive Code/Model switching below 900 px and by default on mobile web, left-dock overlays, parameter and console bottom sheets, and body-overflow-safe behavior at the 800 px acceptance viewport.
- Versioned, strictly validated layout persistence with browser-profile storage, a storage-neutral identity port, provisional restart-safe scratch and opaque per-project desktop profile keys derived from native-canonical paths while Q-0008 remains owner-governed, reset-to-default behavior, and once-per-non-cancelled-failed-job console auto-opening.
- Global C0 layout shortcuts and keyboard-operable separators routed through the shared command bus.
- A pinned Playwright browser-acceptance lane in local scripts and CI for the normative 800 px responsive flow.
- A fresh Lezer OpenSCAD grammar with context-sensitive modifier/operator highlighting, the version-labeled 2021.01 built-in corpus, and a generated-parser freshness gate.
- Context-aware OpenSCAD completion for the version-labeled built-in corpus, lexically visible current-file declarations, and recursively referenced project `include`/`use` files, including source-labeled signatures, OpenSCAD-accurate `use` visibility, cycle/unsafe-path bounds, user-over-project-over-built-in shadowing, and a provisional `cube` call skeleton.
- Multi-document editor tabs with stable buffer identity, accessible dirty markers, clean close/reopen, pointer and keyboard reordering, tab cycling, per-document CodeMirror session restoration, source-snapshot-aware render identity, and truthfully disabled save/unsafe-close paths while Q-0012/Q-0018/Q-0019 remain open.
- Native `-D` parameter overrides for numbers, booleans, strings, and numeric vectors, with deterministic argument ordering, identifier validation, safe string escaping, and a real-engine geometry acceptance test.
- Pinned-engine diagnostic fixtures and a tolerant raw-log parser for errors, warnings, echo output, traces, and reported source locations, wired through typed native failures into the structured and raw console views.
- Clickable error and warning diagnostics whose paths have been resolved to current or already-open files, with tab activation, exact line navigation, editor focus, token-themed CodeMirror squiggles, and gutter markers that disappear when the render snapshot is no longer current.
- Complete native project staging for normalized project-relative text and binary files, project-root `include`/`use` resolution, Windows collision safety, and project-relative cross-file diagnostic paths.
- Engine-selected 3D binary STL or 2D SVG render results, plus full-quality STL, 3MF, OFF, AMF, SVG, DXF, and default-camera PNG exports through the normative service boundary.
- Concurrent native stdout/stderr streaming with one ordered event sequence, elapsed timestamps, exact raw-log reconstruction, timeout and explicit-cancellation process-tree cleanup, and idempotent Tauri job management.
- Per-run diagnostic console history with run separators, exit state, duration and geometry metadata, severity filters, case-insensitive search, filter-independent copy-all, clear-during-run behavior, and oldest-dropped notices at the 10,000-line cap.
- Configurable render debounce, automatic rendering at the configured default quality, in-flight supersession, separate preview/full timeouts, preview-only quality override plumbing, F5/F6 shortcuts, visible preview/full controls, and the disclosed **Preview quality** badge.
- Bundled/configured/environment/PATH engine discovery and a functional missing-engine executable-path fix-it that retries discovery without blocking editing.
- Explicit checking, unavailable, invalid-config, and ready engine-health states with deduplicated retry progress and actionable rejected-path feedback.
- A keyboard-navigable Edit menu for the implemented find, replace, go-to-line, comment-toggle, undo, and redo commands, showing each active runtime binding.
- Native integration coverage for real multi-file includes, imported binary STL assets, cross-file parser errors, parameter overrides, 2D bounds, ASCII STL/SVG/PNG exports, and post-timeout render recovery.
- A complete M2 Customizer surface with structural top-level parameter extraction, stock annotation controls, grouped/hidden sections, debounced overrides, exact source rewriting, named sets, and stock OpenSCAD JSON interchange.
- A demand-driven 3D viewer with controlled cameras, axis views, fit and projection controls, configurable mouse mapping and scene furniture, off-thread STL decoding, large-mesh degradation, point-to-point measurements, bounded per-project/file annotation persistence, last-good error presentation, and scene PNG capture.
- Persistent annotation-storage recovery: honest load/save failure alerts, session-safe in-memory changes, explicit retry, and deterministic version-1 JSON export through the configured artifact destination.
- An exact 2D SVG pane with an allowlist sanitizer, engine-bounds normalization, automatic or pinned 2D/3D routing, cursor-centered pan/zoom, fit, dimensions, and millimeters-per-pixel scale.
- Folder-backed desktop and IndexedDB-backed web project storage with text/binary fidelity, a functional file tree, durable saves, create/rename/move/trash/reveal operations, unloaded-file navigation, external-change handling, crash recovery, and durable recent projects.
- Full-quality 3MF, binary/ASCII STL, OFF, AMF, SVG, DXF, and PNG export with awaited artifact destinations, cancellation, and exact mesh file-size/triangle/bounds summaries.
- Byte-preserving web project ZIP import/export and compressed URL-fragment share links that keep source out of server requests and identify the shared source origin.
- A searchable, versioned settings dialog covering all nine sections, per-section restore, strict import/export, immediate durable persistence with rollback on failure, OS-keychain desktop secrets, and warning-gated browser secret persistence.
- A reproducible network-disabled Windows Sandbox lane for the release executable: exact pinned-engine first use, real cube render and binary-STL export, normal restart, forced-process recovery, native Windows Credential Manager save/load/clear, recursive secret-byte exclusion, and exact guest-process plus host-session cleanup.
- A fail-closed AC-0.b extension to that packaged lane: resize a real project's Files panel through the production keyboard path, retain only the opaque workspace identity and exact validated layout value, close the exact app and WebView2 processes, relaunch fresh processes, reopen the same project, and require exact layout restoration. The final combined rebuild and Sandbox rerun remain required before this new oracle is called green.
- Visible custom-theme import, persistence, selection, exact-schema validation, conservative opaque-sRGB validation, and the existing AA contrast audit applied before activation.
- Real Chromium WebGL acceptance evidence that viewport capture produces a decodable PNG dominated by the active theme background.
- Functional File menu and Appendix D Save, Save All, New, Open Project, and Export commands, including caught failures and conservative multi-scratch persistence behavior.
- Exact runtime enforcement of the OpenSCAD 2026.06.12 engine pin, with a version-mismatch fix-it instead of silently accepting an older PATH installation.
- Discoverable browser **Create workspace** and existing/recent **Open** actions backed by opaque, exclusive IndexedDB identities, plus a native **Choose folder…** action routed through the typed platform boundary and the exact-pinned official Tauri dialog plugin 2.7.1. Manual desktop path entry remains an advanced fallback.

### Changed

- Rejected native project child names that cannot be represented as Unicode before snapshot traversal or file reads, instead of lossily replacing their components and risking colliding portable paths or a partial snapshot response.
- Bound native project files, canonical project ID, and desktop layout-identity material to one validated snapshot response, with the returned canonical ID driving later project operations and malformed responses rejected as a unit.
- Replaced SVG-viewBox-derived 2D bounds with the pinned engine's machine-readable geometry summary because the 2026.06.12 SVG exporter adds presentation margins around exact model geometry.
- Updated the native CI lane from the 2021.01 stable AppImage to the checksummed 2026.06.12 snapshot required by A-7.
- Completed the regular CI platform contract by running desktop-shell Rust tests in V-2 and the Playwright V-4 lane on both Ubuntu and Windows, while retaining the exact pinned-engine checks and removing the obsolete Q-0001 blocker label. These workflow changes are locally contract- and syntax-validated; their hosted CI runs remain required evidence.
- Editor commands now report typed handled/unavailable outcomes; F12 visibly explains that go-to-definition is parked instead of recording a silent success.
- Rebindable shortcuts now share one platform-aware Control/Command policy, and handled editor shortcuts no longer fall through to global layout or render actions.
- Appendix D Alt+Click now adds a real CodeMirror cursor alongside the editor's native Control/Command-click behavior; allowed viewer/global rebinds fall through when the viewer command is inactive.
- Cancelled runs now retain cancelled status copy, configured-engine drafts survive unrelated rerenders, and hidden-editor Edit actions reveal and focus their target before execution.
- Native output capture now reads fixed chunks, spools each subprocess's complete interleaved log to an anonymous temporary file, bounds its live IPC/display replay to 1 MiB or 4,096 records with an explicit marker, and keeps cancellation responsive under slow consumers.
- Strengthened the component color-literal CI gate across product source to catch CSS functions and fallbacks, gradients, numeric and named colors, SVG/canvas attributes, and Three.js color forms while ignoring comments, fragments, and token references.
- Removed the legacy CSS palette and enforced an exact repository-wide allowlist of the 64 generated Appendix C custom properties.
- Replaced the latest-run-only console with retained streaming run history while keeping current-snapshot diagnostics as the sole source of status counts and inline editor markers.
- Used the A-8-approved scoped `@openscad/tree-sitter-openscad` 0.6.1 source as an attributed MIT structural reference while retaining the independently authored generated Lezer runtime grammar and adding no second parser dependency.
- Applied the persisted default render quality to initial and debounced automatic renders; explicit F5/F6 behavior and full-only exports remain unchanged.
- Corrected the settings modal selector collision and moved viewer resize work out of the observed layout cycle, eliminating the real-browser layout break and ResizeObserver loop errors.
- Changed the fresh workspace default to keep Console collapsed until a qualifying render failure opens it, preserving useful first-run viewer height and explicit persisted or user-open state.
- Replaced the stale M0 engine-unavailable save claim with M2-accurate editing, persistence, rendering, and export status copy.
- Web startup now degrades to the scratch editor when IndexedDB is absent or access is blocked instead of failing the entire application module.
- Made the persisted settings profile authoritative for editor, rendering, engine path, theme, AI, keybinding, and privacy preferences, including compatibility migration from the earlier engine-path slot.
- Pinned the desktop keychain boundary to `keyring` 4.1.4 and kept ordinary settings in a separate platform-config JSON file.
- Added a common UTF-8 mojibake source-policy check and corrected the remaining malformed loading-copy assertion.
- Added `Unicode-3.0` to the dependency-license allowlist after the owner's Q-0001 decision: it is an OSI-approved permissive license, approved in November 2023, and is required transitively by the ICU4X family and `unicode-ident`. This is a deliberate addition of a real open-source license, not a policy bypass; the license command no longer retains the obsolete Q-0001 blocker diagnostic.
- Made the empty model view name the available next step while OpenSCAD is checking or unavailable, grouped every rebindable command under localized Files/Editor/Render/Viewer/Layout labels, and replaced the unfocusable disabled Help control with a keyboard- and screen-reader-discoverable explanation.
- Preserved share-link copy and exact project-ZIP export when browser project storage is unavailable, while disabling only ZIP import and explaining that storage-specific limitation at the action surface.
- Corrected the production 2D viewer grid so the SVG canvas receives the flexible viewer row without a 3D toolbar, and moved wheel zoom to an explicitly non-passive listener so zoom no longer emits a browser console error or risks page scrolling.
- Moved project-ZIP compression and expansion into a dedicated worker with cooperative 1 MiB transferable copies, streamed import reads, progress and cancellation; a retained Chromium profile round-trips a 92 MiB asset in a 96,489,071-byte archive with no long task, a 18.7 ms maximum heartbeat gap, 13.2 ms cancellation, and a 192,395,630-byte peak main-heap delta.
- Bounded crash-recovery snapshots at 4 MiB of UTF-8 JSON and coalesced rapid edits into the latest durable capture after 300 ms, with visible persistence errors when the bound is exceeded.
- Replaced silent annotation metadata failures with a workspace-level saved/unsaved/load-error state. Failed add, delete, file move, Save As copy, and trash metadata updates now remain retryable in memory; the warning clears only after a successful durable load or save.
- Added a hardware-disclosing production-viewer profile for exactly two million triangles, real trusted orbit input, automatic edge/shadow degradation, frame pacing, long-task capture, and a strict hardware-renderer check. The current AMD Radeon 780M diagnostic records 59.95 fps, but does not qualify the newer GPU as the required 2020-class acceptance target.
- Reduced the binary-STL parser hot loop to scalar bounds and normal arithmetic while preserving exact validation and normalized geometry output.
- Replaced the external-file raw text blocks with bounded CodeMirror side-by-side and inline merge views, including explicit per-hunk disk/local choices before a mixed reconciliation can be applied.
- Removed the Customizer's arbitrary four-component ceiling so every finite numeric vector component remains editable and round-trippable.
- Routed keybinding rejection and rendered-mesh fallback copy through the English message catalog instead of displaying implementation-layer error strings.
- Routed the ready-engine version status through the English message catalog, closing the remaining N-4 inline status construction found by the final M2 preflight.
- Moved uncached structural cross-file completion indexing into a dedicated Vite worker with an asynchronous CodeMirror source, cooperative workerless fallback, safe cancellation/disposal/error recovery, a 2.1-million-code-unit per-file limit, an 8-million-code-unit traversal budget, and a bounded exact-source cache. Repeated textual includes now replay cached structural events, so `include A; include B; include A` correctly restores A's authority while recursion-stack and global work budgets still stop cycles and expansion.
- Kept WebView2 automation test-only: the packaged lane passes Microsoft's documented host-app remote-debugging switch through official `tauri-driver` and bridges EdgeDriver's `DevToolsActivePort` path mismatch without changing normal ScadMill launches.
- Bound packaged desktop evidence to its source by removing the arbitrary executable input, refusing dirty or changing worktrees, performing the frozen frontend and clean locked canonical release builds inside the wrapper, and retaining strict commit/tree, lockfile, tool, command, timestamp, and executable-hash provenance.

### Known policy block

- Q-0003 leaves the final preview facet-cap algorithm open; the preview-only configuration seam is implemented without claiming that a global `$fn` override is a true cap.
- Q-0021 parks only explicit-camera PNG exports because the pinned snapshot CLI cannot preserve Appendix A's `CameraPose.up`; default-camera PNG and all non-PNG exports continue.
- Q-0023 asks whether the exact-date official WebAssembly archives now visible in the snapshot manifest may replace v0.6's mandated same-commit source build; M2 native work is unaffected.
- Q-0022 asks whether Appendix A may replace its complete in-memory `rawLog: string` with a bounded/file-backed contract; live capture is bounded without truncating the normative result, but final string materialization and spill-file growth remain size-proportional.
- Q-0024/Q-0025/Q-0026/Q-0028 isolate incompatible pinned-viewer behavior, edge/face measurement topology, screenshot overlay composition, and keyboard geometry-picking semantics; the independent viewer behavior continues conservatively.
- Q-0027 records the settings-export/secret contradiction; the implementation follows the stronger AC-9.c rule and never writes the secret into settings files.
- Q-0029 parks only recent-project duplication on the M3 welcome screen.
- Q-0030 parks only the autosave-control and multi-untitled store semantics; default-on original-scratch autosave and multi-buffer recovery remain active without overwriting additional tabs.
- Q-0031 parks only an application-owned cross-platform destination picker; the dialog truthfully names the real browser or desktop destination and reports the saved location.
- Q-0006 keeps custom-theme values conservatively limited to opaque six-digit sRGB colors until the owner defines normalization for the complete CSS color grammar.

### Known verification gaps

- FR-2.5 now has a retained, reproducible two-million-triangle hardware profile and passes at 59.95 fps on this host's AMD Radeon 780M, but the claim remains unverified because that GPU is newer than the required 2020-class integrated target.
- `cargo audit` reports zero vulnerability failures but 17 pre-existing informational warnings in the current Tauri dependency graph, including the GTK3/glib unsoundness advisory and unmaintained GTK3, proc-macro-error, and UNIC families; current compatible upstream releases do not remove them.
