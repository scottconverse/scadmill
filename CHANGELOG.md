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

### Known policy block

- Q-0001 asks the owner to decide how Unicode-3.0 transitive Rust dependencies fit the §6 license allowlist; the Rust license-policy CI job remains deliberately failing until amended.
