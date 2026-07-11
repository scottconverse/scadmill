# ScadMill

ScadMill is a source-first OpenSCAD workbench for desktop and web. It combines an OpenSCAD code editor with a live, interactive model viewer while keeping the unmodified OpenSCAD engine out of process.

The project is being delivered milestone by milestone from the clean-room functional specification in [`spec/scadmill-spec-v0.6.md`](spec/scadmill-spec-v0.6.md). M0 and M1 are accepted; M2 is undergoing residual closure and has not reached its advancement boundary. This is not owner acceptance or authorization to begin M3. Open decisions remain isolated in [`spec/QUESTIONS.md`](spec/QUESTIONS.md) without retroactively invalidating accepted milestones.

## Current capabilities

- Edit OpenSCAD source in a CodeMirror-based workbench and render it through the out-of-process native engine adapter.
- Highlight OpenSCAD keywords, built-ins, literals, special variables, comments, operators, and statement modifiers through a fresh version-labeled Lezer grammar.
- Offer context-aware completion for the version-labeled provisional built-in corpus, lexically visible current-file symbols, and declarations pulled recursively from project files referenced by `include`/`use`. Uncached structural project indexing runs in a dedicated worker, while the workerless fallback yields cooperatively; both retain lazy source lookup, bounded exact-source caching, textual replay semantics, and support for individual project files up to 2.1 million code units within an 8-million-code-unit traversal budget. Signatures identify their project-relative source; the deterministic `cube` skeleton remains provisional while Q-0013 is open.
- Work across reorderable, keyboard-accessible document tabs with isolated edit/undo sessions, dirty-state announcements, project-backed save, clean close/reopen commands, and render results bound to the exact source snapshot. Dirty-close and final-tab policy remain explicitly parked in `spec/QUESTIONS.md`.
- Apply typed native-engine parameter overrides without rewriting source, including validated numbers, booleans, strings, and numeric vectors. Preview and full renders use separate timeouts and quality policies; F5 requests preview and F6 requests full geometry.
- Stage complete multi-file projects with byte-preserving binary assets, resolve `include`/`use` from the project root, select 3D STL or 2D SVG from engine output, and export every Appendix A native format at full quality. PNG currently uses the engine's default camera; explicit `CameraPose` requests are rejected rather than losing `up` while Q-0021 is open.
- Stream interleaved, timestamped native stdout/stderr into per-run console history with quality, duration, exit state, geometry statistics, severity filtering, search, copy-all, clear, and a global 10,000-line cap. Parsed diagnostics are clickable, appear as themed editor squiggles and gutter markers, and can open an unloaded project file through the C6 source port.
- Debounce automatic renders at the configured default quality, cancel superseded or timed-out process trees, retain cancelled runs in console history, and keep the UI responsive while native work runs off the UI thread.
- Inspect real STL geometry in a demand-driven Three.js viewer with orbit/pan/zoom, axis views, fit, perspective/orthographic projection, themed scene furniture, large-mesh degradation, point-to-point measurement, durable per-project/file pinned annotations, exact bounds, last-good error presentation, and PNG capture. Failed annotation metadata loads and saves stay visibly marked, preserve the current in-memory notes, and offer retry plus exact version-1 JSON export. STL decoding runs off the UI thread in the browser.
- Switch automatically between the 3D viewer and an allowlist-sanitized engine-produced SVG pane with exact model-space dimensions, cursor-centered pan/zoom, fit, and scale readout. An incompatible pinned mode shows an empty pane and notice while Q-0024 remains open.
- Extract stock OpenSCAD Customizer parameters structurally into grouped controls, apply non-destructive render and export overrides, write explicit values back into the original assignments, and exchange named sets in the stock JSON format.
- Choose folder-backed desktop projects with a native dialog or create/open named IndexedDB-backed browser workspaces without handling internal IDs. Edit text and preserve binary assets, create/rename/move/trash/reveal files, reconcile external edits per hunk in side-by-side or inline views, recover unsaved buffers, and retain reopenable recent projects.
- Export full-quality 3MF, STL, OFF, AMF, SVG, DXF, or PNG artifacts with exact mesh summaries; web projects also import/export byte-preserving ZIP archives through a cancellable worker-backed path and create serverless single-file share links.
- Configure and persist all editor, rendering, engine, viewer, formatter, theme, AI, keybinding, and privacy settings. Desktop secrets use the OS keychain; browser secrets remain session-only unless the warning-labeled persistence option is enabled.
- Enforce the recorded OpenSCAD 2026.06.12 pin at runtime; an older PATH installation is left untouched and cannot enable rendering or export.
- Arrange the editor, viewer, parameters, diagnostics, and activity destinations in a resizable, collapsible workspace with keyboard commands, browser-profile persistence, provisional opaque per-project desktop persistence behind a storage-neutral port, and a single-column layout below 900 px or by default on mobile web. Native folder snapshots return their files, canonical project ID, and layout-identity material together; the validated canonical ID then drives later project operations.
- Follow the OS Light/Dark preference or switch among Light, Dark, High Contrast, and imported Appendix C custom themes without reloading the editor or viewer. Custom themes use the conservative opaque-sRGB and AA-contrast policy while Q-0005/Q-0006 remain open.

## Accepted M1 boundary record

| Slice | Verified boundary | Still parked beyond accepted M1 |
|---|---|---|
| C0 layout | Default/narrow layouts, splitters, keyboard access, web-profile persistence, and console auto-open have automated coverage. M2 now adds a provisional restart-safe scratch and per-project desktop adapter keyed by an opaque digest of canonical identity material returned atomically with the native project snapshot. | Final project-workspace versus per-user-profile storage ownership remains owner-governed under Q-0008. The runtime port is storage-location-neutral so the provisional adapter can be replaced without changing layout state or project commands. |
| C1 editor | Tabs, dirty tracking, language support, completion infrastructure, diagnostics, editor settings, and C1-owned commands are implemented. | Save/retention blocks AC-1.d and AC-4.d under Q-0012; final command and corpus claims remain Q-0010/Q-0013. Q-0014 now governs only the historical M1 scheduling interpretation. |
| C4 native engine | Real 2D/3D geometry, typed parameters, multi-file staging, exports, streaming, timeout/cancel cleanup, debounce, and supersession are covered. | A true preview facet cap is Q-0003; explicit-camera PNG is Q-0021; native/WASM parity is the M3 gate. |
| C8 diagnostics | Ordered run history, raw output, structured diagnostics, filters, retention, inline markers, and navigation to current/open files are covered. | Loading a reported file not already open is Q-0020. |
| C12 theming | Complete shipped token sets, contrast checks, no component color literals, and live editor/viewer/console switching are covered. | Import-control ownership and final custom-color/contrast policy are Q-0004/Q-0005/Q-0006. |
| Quality gates | TypeScript, browser, native, desktop-shell, npm- and Rust-license, build, and provenance checks are green locally. | The owner similarity gate is CI-only and is never run locally. |

That table preserves the accepted M1 boundary as historical evidence. M2 now supplies the project-backed save, unloaded-file navigation, and read-only cross-file completion source map that were unavailable at M1, plus the visible custom-theme settings flow.

## M2 boundary record

| Slice | Delivered candidate | Conservatively parked |
|---|---|---|
| C2/C3 viewers | Native-backed STL and allowlist-sanitized SVG presentation, controlled camera, point-to-point measurement, per-project/file durable annotations with visible load/save failure recovery and exact JSON export, exact bounds, screenshots, 2D routing, and real-browser capture evidence. | Incompatible pinned-mode presentation, edge/face semantics, screenshot overlay composition, and keyboard geometry picking remain Q-0024/Q-0025/Q-0026/Q-0028. |
| C5 Customizer | Structural stock-annotation extraction, typed controls, non-destructive overrides, explicit source writes, named sets, and stock JSON round-trip evidence. | No C5 behavior is parked. |
| C6 files/projects/export | Blank scratch mode, functional File commands and shortcuts, discoverable browser Create/Open workspace actions, a typed native folder chooser with advanced manual-path fallback, desktop/web storage, safe file operations, per-hunk external-change reconciliation, recovery, recent projects, ZIP/share portability, and full-quality exports. | Welcome-screen duplication, autosave-control semantics, and application-owned export-destination picking remain Q-0029/Q-0030/Q-0031. Dirty/final-tab close policy remains Q-0018/Q-0019. |
| C9 settings | Strict all-section persistence/import/export, per-section restore, immediate application with durable rollback, custom themes, OS-keychain desktop secrets, and warning-gated browser persistence. | Secret exclusion follows the stronger AC-9.c rule while Q-0027 remains open. |
| Automated gate evidence | Exact OpenSCAD 2026.06.12 enforcement, TypeScript/lint/build, unit/browser/native/desktop tests, npm- and Rust-license, generated-parser, and provenance gates. | The owner similarity gate remains isolated CI-only. |
| Packaged Windows evidence | A network-disabled fresh Windows Sandbox runs the release executable through official `tauri-driver`, configures exact OpenSCAD 2026.06.12, renders and exports a measured cube, verifies normal restart and forced-process recovery, round-trips a synthetic secret through Windows Credential Manager, scans app and evidence files both while stored and after clear, and checks every exact guest process plus exact host Sandbox-session and staging cleanup. The lane now also drives a real project's Files splitter from 260 to 300 through its production keyboard command, closes the exact app and WebView2 processes, launches fresh processes, reopens the same project, and requires the identical opaque storage key and exact serialized layout. | The added AC-0.b process-restart oracle is statically green but awaits the owner-coordinated final combined rebuild and Sandbox run; no new packaged PASS is claimed yet. FR-2.5's 2-million-triangle frame-rate measurement on disclosed 2020-class integrated graphics remains unverified. |

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

The desktop path checks a bundled engine candidate first, then the user-configured executable path, `SCADMILL_OPENSCAD`, and finally `PATH`. Only the recorded OpenSCAD 2026.06.12 snapshot is accepted. If discovery fails or finds another version, use the in-app **Configure engine** fix-it to save the full pinned executable path and retry. Direct process control is retained for reliable cancellation and timeout cleanup.

## Verification

`pnpm check:generated`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm check:provenance`, `pnpm check:licenses all`, `cargo fmt -- --check`, `cargo clippy -- -D warnings`, and the Rust test suite form the local quality gate. Run the retained M2 browser evidence lane with `pnpm.cmd exec playwright test --config tests/e2e/m2-gate.playwright.config.ts`; set `SCADMILL_GATE_ARTIFACT_DIR` to retain its attestations, screenshot, HTML, traces, JSON report, exact runner copies, and SHA-256 hashes outside the repository. Run `pnpm profile:viewer` for the hardware-disclosing two-million-triangle orbit profile; a passing run qualifies only when `SCADMILL_PERF_HARDWARE_QUALIFICATION=2020-class-integrated` truthfully describes the disclosed host, so the retained AMD Radeon 780M result remains diagnostic. The packaged Windows lane is `scripts/windows/run-packaged-desktop-evidence.ps1`; invoke it through `powershell.exe -NoProfile -ExecutionPolicy Bypass -File` with fresh output plus explicit release-engine, `tauri-driver`, Visual C++ runtime, matching EdgeDriver, and fixed WebView2 paths. Its fixed runtime and remote-debugging switch exist only inside the disposable evidence launch and are not product bundling. After changing `src/ui/editor/openscad.grammar`, run `pnpm generate:openscad-parser` and commit both generated TypeScript files. Install the acceptance-test browser once with `pnpm exec playwright install chromium`. Run the Rust commands with `--manifest-path` for both manifests under `src/native-engine` and `src/desktop-shell/src-tauri`. Both npm and Rust dependency-license lanes are green after the owner-approved Unicode-3.0 policy addition. The owner-supplied independence gate runs only in isolated GitHub Actions and must never be executed locally.

## Provenance and privacy

Every coherent change carries a machine-readable entry under `provenance/entries/`. See [`PROVENANCE.md`](PROVENANCE.md) and [`PRIVACY.md`](PRIVACY.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the clean-room rules, setup, and verification expectations.

## License

No public reuse license has been selected yet. Until the owner makes the M3 licensing decision, all rights are reserved; see [`LICENSE`](LICENSE).
