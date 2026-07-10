# ScadMill

ScadMill is a source-first OpenSCAD workbench for desktop and web. It combines an OpenSCAD code editor with a live, interactive model viewer while keeping the unmodified OpenSCAD engine out of process.

The project is being delivered milestone by milestone from the clean-room functional specification in [`spec/scadmill-spec-v0.4.md`](spec/scadmill-spec-v0.4.md). The M0 walking skeleton is implemented and M1 capability slices are in progress; formal milestone advancement remains subject to the open owner decisions in [`spec/QUESTIONS.md`](spec/QUESTIONS.md).

## Current capabilities

- Edit OpenSCAD source in a CodeMirror-based workbench and render it through the out-of-process native engine adapter.
- Highlight OpenSCAD keywords, built-ins, literals, special variables, comments, operators, and statement modifiers through a fresh version-labeled Lezer grammar.
- Offer context-aware completion for the version-labeled provisional built-in corpus and lexically visible current-file symbols, with signatures, paraphrased descriptions, and a provisional deterministic `cube` call skeleton while Q-0013 remains open.
- Work across reorderable, keyboard-accessible document tabs with isolated edit/undo sessions, dirty-state announcements, clean close/reopen commands, and render results bound to the exact source snapshot; save and unsafe/final close behavior remain explicitly parked in `spec/QUESTIONS.md`.
- Apply typed native-engine parameter overrides without rewriting source, including validated numbers, booleans, strings, and numeric vectors.
- Capture native engine output, parse pinned OpenSCAD error/warning/echo/trace shapes into structured diagnostics, and show structured items alongside the raw run log; diagnostic navigation, interleaved streaming controls, and inline editor markers remain in progress for M1.
- Inspect real STL geometry in an orbitable Three.js viewer, with an editor-only fallback when the engine is unavailable.
- Arrange the editor, viewer, parameters, diagnostics, and activity destinations in a resizable, collapsible workspace with keyboard commands, web-profile persistence, and a single-column layout below 900 px or by default on mobile web.
- Follow the OS Light/Dark preference or switch among Light, Dark, and High Contrast themes without reloading the editor or viewer.
- Validate complete Appendix C custom-theme JSON files and register them for the later settings import flow.

## Requirements

- Node.js 24 or newer
- pnpm 11.7.0
- Rust 1.96.0 (pinned by `rust-toolchain.toml`) for the desktop shell
- OpenSCAD 2021.01 for the current M0 engine pin

## Quick start

1. Clone the repository.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm test`.
4. Run `pnpm dev` for the browser-hosted UI shell.
5. Run `pnpm desktop dev` for the native engine path.

The browser-hosted shell intentionally enters editor-only mode because the native OpenSCAD subprocess is available only through the desktop platform adapter.

## Basic use

Open the desktop shell, enter a model such as `cube([10, 20, 30]);` in the active `.scad` document, and choose **Render preview**. ScadMill renders real geometry through the pinned native OpenSCAD engine, shows the measured model in the orbitable viewer, and places structured diagnostics alongside the captured engine log.

## Engine configuration

For the M0 desktop shell, engine discovery checks `SCADMILL_OPENSCAD` and then `PATH`. If a normal Windows OpenSCAD installation is not on `PATH`, set `SCADMILL_OPENSCAD` to the full path of the direct `openscad.exe` executable. Do not point it at a `.com` or shell wrapper; direct process control is required for reliable cancellation in the complete native path.

## Verification

`pnpm check:generated`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm check:provenance`, `pnpm check:licenses npm`, `cargo fmt -- --check`, `cargo clippy -- -D warnings`, and the Rust test suite form the local quality gate. After changing `src/ui/editor/openscad.grammar`, run `pnpm generate:openscad-parser` and commit both generated TypeScript files. Install the acceptance-test browser once with `pnpm exec playwright install chromium`. Run the Rust commands with `--manifest-path` for both manifests under `src/native-engine` and `src/desktop-shell/src-tauri`. The Rust license-policy CI step remains deliberately red on the open Unicode-3.0 policy question Q-0001. The owner-supplied independence gate runs only in isolated GitHub Actions and must never be executed locally.

## Provenance and privacy

Every coherent change carries a machine-readable entry under `provenance/entries/`. See [`PROVENANCE.md`](PROVENANCE.md) and [`PRIVACY.md`](PRIVACY.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the clean-room rules, setup, and verification expectations.

## License

No public reuse license has been selected yet. Until the owner makes the M3 licensing decision, all rights are reserved; see [`LICENSE`](LICENSE).
