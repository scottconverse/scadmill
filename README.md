# ScadMill

ScadMill is a source-first OpenSCAD workbench for desktop and web. It combines an OpenSCAD code editor with a live, interactive model viewer while keeping the unmodified OpenSCAD engine out of process.

The project is being delivered milestone by milestone from the clean-room functional specification in [`spec/scadmill-spec-v0.6.md`](spec/scadmill-spec-v0.6.md). M0 and M1 are accepted; M2 is in progress. Open decisions remain isolated in [`spec/QUESTIONS.md`](spec/QUESTIONS.md) without retroactively invalidating accepted milestones.

## Current capabilities

- Edit OpenSCAD source in a CodeMirror-based workbench and render it through the out-of-process native engine adapter.
- Highlight OpenSCAD keywords, built-ins, literals, special variables, comments, operators, and statement modifiers through a fresh version-labeled Lezer grammar.
- Offer context-aware completion for the version-labeled provisional built-in corpus and lexically visible current-file symbols, with signatures, paraphrased descriptions, and a provisional deterministic `cube` call skeleton while Q-0013 remains open.
- Work across reorderable, keyboard-accessible document tabs with isolated edit/undo sessions, dirty-state announcements, clean close/reopen commands, and render results bound to the exact source snapshot; save and unsafe/final close behavior remain explicitly parked in `spec/QUESTIONS.md`.
- Apply typed native-engine parameter overrides without rewriting source, including validated numbers, booleans, strings, and numeric vectors. Preview and full renders use separate timeouts and quality policies; F5 requests preview and F6 requests full geometry.
- Stage complete multi-file projects with byte-preserving binary assets, resolve `include`/`use` from the project root, select 3D STL or 2D SVG from engine output, and export every Appendix A native format at full quality. PNG currently uses the engine's default camera; explicit `CameraPose` requests are rejected rather than losing `up` while Q-0021 is open.
- Stream interleaved, timestamped native stdout/stderr into per-run console history with quality, duration, exit state, geometry statistics, severity filtering, search, copy-all, clear, and a global 10,000-line cap. Parsed diagnostics remain clickable for current or already-open files and appear as themed editor squiggles and gutter markers; loading a diagnostic path that is not yet open remains parked under Q-0020 until C6 supplies the project-file loader.
- Debounce automatic preview renders, cancel superseded or timed-out process trees, retain cancelled runs in console history, and keep the UI responsive while native work runs off the UI thread.
- Inspect real STL geometry in an orbitable Three.js viewer, with an editor-only fallback when the engine is unavailable.
- Arrange the editor, viewer, parameters, diagnostics, and activity destinations in a resizable, collapsible workspace with keyboard commands, web-profile persistence, and a single-column layout below 900 px or by default on mobile web.
- Follow the OS Light/Dark preference or switch among Light, Dark, and High Contrast themes without reloading the editor or viewer.
- Validate complete Appendix C custom-theme JSON files and register them for the later settings import flow.

## Accepted M1 boundary record

| Slice | Verified boundary | Still parked beyond accepted M1 |
|---|---|---|
| C0 layout | Default/narrow layouts, splitters, keyboard access, web-profile persistence, and console auto-open have automated coverage. | Final desktop per-project storage ownership is Q-0008. |
| C1 editor | Tabs, dirty tracking, language support, completion infrastructure, diagnostics, editor settings, and C1-owned commands are implemented. | Save/retention blocks AC-1.d and AC-4.d under Q-0012; final command, corpus, and cross-file completion claims remain Q-0010/Q-0013/Q-0014. |
| C4 native engine | Real 2D/3D geometry, typed parameters, multi-file staging, exports, streaming, timeout/cancel cleanup, debounce, and supersession are covered. | A true preview facet cap is Q-0003; explicit-camera PNG is Q-0021; native/WASM parity is the M3 gate. |
| C8 diagnostics | Ordered run history, raw output, structured diagnostics, filters, retention, inline markers, and navigation to current/open files are covered. | Loading a reported file not already open is Q-0020. |
| C12 theming | Complete shipped token sets, contrast checks, no component color literals, and live editor/viewer/console switching are covered. | Import-control ownership and final custom-color/contrast policy are Q-0004/Q-0005/Q-0006. |
| Quality gates | TypeScript, browser, native, desktop-shell, npm-license, build, and provenance checks are green locally. | The Rust license-policy check remains deliberately red pending Q-0001; the owner similarity gate is CI-only and is never run locally. |

## Requirements

- Node.js 24 or newer
- pnpm 11.7.0
- Rust 1.96.0 (pinned by `rust-toolchain.toml`) for the desktop shell
- OpenSCAD development snapshot 2026.06.12 for the A-7 engine pin

## Quick start

1. Clone the repository.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm test`.
4. Run `pnpm dev` for the browser-hosted UI shell.
5. Run `pnpm desktop dev` for the native engine path.

The browser-hosted shell intentionally enters editor-only mode because the native OpenSCAD subprocess is available only through the desktop platform adapter.

## Basic use

Open the desktop shell, enter a model such as `cube([10, 20, 30]);` in the active `.scad` document, and choose **Render preview** or press F5. Press F6 for a full render. ScadMill renders real geometry through the pinned native OpenSCAD engine, shows the measured model in the orbitable viewer, and streams structured diagnostics alongside the captured engine log.

## Engine configuration

The desktop path checks a bundled engine candidate first, then the user-configured executable path, `SCADMILL_OPENSCAD`, and finally `PATH`. If discovery fails, use the in-app **Configure engine** fix-it to save the full executable path and retry. Direct process control is retained for reliable cancellation and timeout cleanup.

## Verification

`pnpm check:generated`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm check:provenance`, `pnpm check:licenses npm`, `cargo fmt -- --check`, `cargo clippy -- -D warnings`, and the Rust test suite form the local quality gate. After changing `src/ui/editor/openscad.grammar`, run `pnpm generate:openscad-parser` and commit both generated TypeScript files. Install the acceptance-test browser once with `pnpm exec playwright install chromium`. Run the Rust commands with `--manifest-path` for both manifests under `src/native-engine` and `src/desktop-shell/src-tauri`. The Rust license-policy CI step remains deliberately red on the open Unicode-3.0 policy question Q-0001. The owner-supplied independence gate runs only in isolated GitHub Actions and must never be executed locally.

## Provenance and privacy

Every coherent change carries a machine-readable entry under `provenance/entries/`. See [`PROVENANCE.md`](PROVENANCE.md) and [`PRIVACY.md`](PRIVACY.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the clean-room rules, setup, and verification expectations.

## License

No public reuse license has been selected yet. Until the owner makes the M3 licensing decision, all rights are reserved; see [`LICENSE`](LICENSE).
