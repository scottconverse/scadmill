# ScadMill

ScadMill is a source-first OpenSCAD workbench for desktop and web. It combines an OpenSCAD code editor with a live, interactive model viewer while keeping the unmodified OpenSCAD engine out of process.

The project is being delivered milestone by milestone from the clean-room functional specification in [`spec/scadmill-spec-v0.4.md`](spec/scadmill-spec-v0.4.md). M0 is currently in progress.

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

For the M0 desktop shell, engine discovery checks `SCADMILL_OPENSCAD` and then `PATH`. If a normal Windows OpenSCAD installation is not on `PATH`, set `SCADMILL_OPENSCAD` to the full path of the direct `openscad.exe` executable. Do not point it at a `.com` or shell wrapper; direct process control is required for reliable cancellation in the complete native path.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:provenance`, `pnpm check:licenses npm`, `cargo fmt -- --check`, `cargo clippy -- -D warnings`, and the Rust test suite form the local quality gate. Run the Rust commands with `--manifest-path` for both manifests under `src/native-engine` and `src/desktop-shell/src-tauri`. The Rust license-policy CI step remains deliberately red on the open Unicode-3.0 policy question Q-0001. The owner-supplied independence gate runs only in isolated GitHub Actions and must never be executed locally.

## Provenance and privacy

Every coherent change carries a machine-readable entry under `provenance/entries/`. See [`PROVENANCE.md`](PROVENANCE.md) and [`PRIVACY.md`](PRIVACY.md).

## License

No public reuse license has been selected yet. Until the owner makes the M3 licensing decision, all rights are reserved; see [`LICENSE`](LICENSE).
