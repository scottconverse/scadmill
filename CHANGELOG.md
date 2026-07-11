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
- Versioned, strictly validated layout persistence with browser-profile storage, an injected desktop persistence seam, reset-to-default behavior, and once-per-non-cancelled-failed-job console auto-opening.
- Global C0 layout shortcuts and keyboard-operable separators routed through the shared command bus.
- A pinned Playwright browser-acceptance lane in local scripts and CI for the normative 800 px responsive flow.
- A fresh Lezer OpenSCAD grammar with context-sensitive modifier/operator highlighting, the version-labeled 2021.01 built-in corpus, and a generated-parser freshness gate.
- Context-aware OpenSCAD completion for the version-labeled built-in corpus and lexically visible current-file declarations, including signature metadata, paraphrased help, special variables, user-over-built-in shadowing, and a provisional `cube` call skeleton.
- Multi-document editor tabs with stable buffer identity, accessible dirty markers, clean close/reopen, pointer and keyboard reordering, tab cycling, per-document CodeMirror session restoration, source-snapshot-aware render identity, and truthfully disabled save/unsafe-close paths while Q-0012/Q-0018/Q-0019 remain open.
- Native `-D` parameter overrides for numbers, booleans, strings, and numeric vectors, with deterministic argument ordering, identifier validation, safe string escaping, and a real-engine geometry acceptance test.
- Pinned-engine diagnostic fixtures and a tolerant raw-log parser for errors, warnings, echo output, traces, and reported source locations, wired through typed native failures into the structured and raw console views.
- Clickable error and warning diagnostics whose paths have been resolved to current or already-open files, with tab activation, exact line navigation, editor focus, token-themed CodeMirror squiggles, and gutter markers that disappear when the render snapshot is no longer current.
- Complete native project staging for normalized project-relative text and binary files, project-root `include`/`use` resolution, Windows collision safety, and project-relative cross-file diagnostic paths.
- Engine-selected 3D binary STL or 2D SVG render results, plus full-quality STL, 3MF, OFF, AMF, SVG, DXF, and default-camera PNG exports through the normative service boundary.
- Concurrent native stdout/stderr streaming with one ordered event sequence, elapsed timestamps, exact raw-log reconstruction, timeout and explicit-cancellation process-tree cleanup, and idempotent Tauri job management.
- Per-run diagnostic console history with run separators, exit state, duration and geometry metadata, severity filters, case-insensitive search, filter-independent copy-all, clear-during-run behavior, and oldest-dropped notices at the 10,000-line cap.
- Configurable render debounce, automatic preview, in-flight supersession, separate preview/full timeouts, preview-only quality override plumbing, F5/F6 shortcuts, visible preview/full controls, and the disclosed **Preview quality** badge.
- Bundled/configured/environment/PATH engine discovery and a functional missing-engine executable-path fix-it that retries discovery without blocking editing.
- Explicit checking, unavailable, invalid-config, and ready engine-health states with deduplicated retry progress and actionable rejected-path feedback.
- A keyboard-navigable Edit menu for the implemented find, replace, go-to-line, comment-toggle, undo, and redo commands, showing each active runtime binding.
- Native integration coverage for real multi-file includes, imported binary STL assets, cross-file parser errors, parameter overrides, 2D bounds, ASCII STL/SVG/PNG exports, and post-timeout render recovery.

### Changed

- Replaced SVG-viewBox-derived 2D bounds with the pinned engine's machine-readable geometry summary because the 2026.06.12 SVG exporter adds presentation margins around exact model geometry.
- Updated the native CI lane from the 2021.01 stable AppImage to the checksummed 2026.06.12 snapshot required by A-7.
- Editor commands now report typed handled/unavailable outcomes; F12 visibly explains that go-to-definition is parked instead of recording a silent success.
- Rebindable shortcuts now share one platform-aware Control/Command policy, and handled editor shortcuts no longer fall through to global layout or render actions.
- Appendix D Alt+Click now adds a real CodeMirror cursor alongside the editor's native Control/Command-click behavior; allowed viewer/global rebinds fall through when the viewer command is inactive.
- Cancelled runs now retain cancelled status copy, configured-engine drafts survive unrelated rerenders, and hidden-editor Edit actions reveal and focus their target before execution.
- Native output capture now reads fixed chunks, spools each subprocess's complete interleaved log to an anonymous temporary file, bounds its live IPC/display replay to 1 MiB or 4,096 records with an explicit marker, and keeps cancellation responsive under slow consumers.
- Strengthened the component color-literal CI gate across product source to catch CSS functions and fallbacks, gradients, numeric and named colors, SVG/canvas attributes, and Three.js color forms while ignoring comments, fragments, and token references.
- Removed the legacy CSS palette and enforced an exact repository-wide allowlist of the 64 generated Appendix C custom properties.
- Replaced the latest-run-only console with retained streaming run history while keeping current-snapshot diagnostics as the sole source of status counts and inline editor markers.

### Known policy block

- Q-0001 asks the owner to decide how Unicode-3.0 transitive Rust dependencies fit the §6 license allowlist; the Rust license-policy CI job remains deliberately failing until amended.
- Q-0003 leaves the final preview facet-cap algorithm open; the preview-only configuration seam is implemented without claiming that a global `$fn` override is a true cap.
- Q-0021 parks only explicit-camera PNG exports because the pinned snapshot CLI cannot preserve Appendix A's `CameraPose.up`; default-camera PNG and all non-PNG exports continue.
- Q-0023 asks whether the exact-date official WebAssembly archives now visible in the snapshot manifest may replace v0.6's mandated same-commit source build; M2 native work is unaffected.
- Q-0022 asks whether Appendix A may replace its complete in-memory `rawLog: string` with a bounded/file-backed contract; live capture is bounded without truncating the normative result, but final string materialization and spill-file growth remain size-proportional.
