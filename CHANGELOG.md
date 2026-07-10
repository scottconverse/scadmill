# Changelog

All notable changes to ScadMill are documented here. The format follows Keep a Changelog, and the project will adopt semantic versioning before its first public release.

## [Unreleased]

### Added

- M0 repository and clean-room provenance foundation.
- Owner-supplied isolated independence-gate workflow.
- Strict provenance schema, immutable per-pull-request ledger enforcement, and split npm/Rust license-policy checks.
- Reproducible Rust 1.96.0 toolchain with rustfmt and warning-free clippy gates for both native crates.
- Pinned OpenSCAD 2021.01 native subprocess integration behind the typed engine boundary.
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

### Changed

- Strengthened the component color-literal CI gate across product source to catch CSS functions and fallbacks, gradients, numeric and named colors, SVG/canvas attributes, and Three.js color forms while ignoring comments, fragments, and token references.
- Removed the legacy CSS palette and enforced an exact repository-wide allowlist of the 64 generated Appendix C custom properties.

### Known policy block

- Q-0001 asks the owner to decide how Unicode-3.0 transitive Rust dependencies fit the §6 license allowlist; the Rust license-policy CI job remains deliberately failing until amended.
