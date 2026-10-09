# ScadMill commands and release reference

Moved verbatim from CLAUDE.md. Read before running tests, building or touching release files.

## Commands

pnpm 11.7, Node >= 24. Rust toolchain is pinned to **1.96.0** (CI asserts the exact version).

```bash
pnpm install --frozen-lockfile
pnpm dev                  # vite dev server
pnpm typecheck            # tsc --noEmit
pnpm lint                 # biome + architectural source policy
pnpm test                 # vitest run
pnpm build                # tsc --noEmit && vite build
```

Single test / focused runs:

```bash
pnpm exec vitest run tests/integration/colored-3mf-engine.test.ts
pnpm exec vitest run path/to/file.test.ts -t "name of the case"
pnpm test:watch
```

End-to-end and parity (Playwright; two separate configs):

```bash
pnpm exec playwright install chromium
pnpm test:e2e                      # playwright.config.ts
pnpm test:parity                   # playwright.ac4.config.ts — native vs WASM byte parity
pnpm test:e2e:production-static    # acceptance against a built static dist
pnpm test:e2e:m4-hosted
pnpm exec playwright test path/to/spec.ts -g "case name"
```

Rust (three separate crates/manifests — none are workspace members of each other):

```bash
cargo test  --locked --manifest-path src/native-engine/Cargo.toml
cargo check --locked --manifest-path src/desktop-shell/src-tauri/Cargo.toml
cargo test  --locked --manifest-path src/desktop-shell/src-tauri/Cargo.toml
```

Native engine tests need a display server in CI (`xvfb-run -a`). The headless CLI smoke is
`#[ignore]`d and must be named explicitly:

```bash
cargo test --locked --manifest-path src/desktop-shell/src-tauri/Cargo.toml --test headless_cli exports_a_named_parameter_set_to_3mf_without_a_display_server -- --ignored --nocapture
```

Supply-chain and release gates:

```bash
pnpm check:generated        # regenerated Lezer parser must match what is committed
pnpm check:blobs            # tracked blob / Git LFS policy
pnpm check:licenses npm
node scripts/check-licenses.mjs rust
pnpm check:provenance       # append-only ledger under provenance/entries
pnpm check:notices          # THIRD-PARTY-NOTICES.txt is current (required before desktop build)
pnpm check:wasm-workflow
pnpm check:public-surfaces
```

Desktop build:

```bash
pnpm build:desktop
pnpm build:desktop:tauri-prebuild   # check:notices, then build:desktop
pnpm desktop                        # tauri CLI inside src/desktop-shell
```

## Release qualification

- A package is not release-qualified until its exact public bytes pass signature/hash verification
  *and* the required isolated lifecycle walkthrough (install, launch, verify file association,
  upgrade from the previous public beta, repair, uninstall, reinstall).
