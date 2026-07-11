# Contributing

Contributions must follow the clean-room rules in specification §2. Do not consult source code, screenshots, issues, pull requests, or documentation from an existing OpenSCAD editor.

Before proposing a change:

1. Read `spec/scadmill-spec-v0.6.md` and `PROVENANCE.md`.
2. Write and observe a failing test before changing behavior.
3. Run `pnpm check:generated`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:provenance`, and `pnpm check:licenses all` plus Rust format, clippy, engine tests, and the desktop-shell check for both Cargo manifests.
4. Add one machine-readable provenance entry for the coherent capability slice.

Changes to `src/ui/editor/openscad.grammar` must be followed by `pnpm generate:openscad-parser`; commit both generated TypeScript outputs with the grammar.

The complete npm and Rust dependency-license policy is required and green after the owner's Q-0001 decision added the OSI-approved permissive `Unicode-3.0` license used transitively by ICU4X and `unicode-ident`.

Never run `owner-gate/similarity_gate.py` locally. That owner-supplied gate is isolated in CI because its runner alone receives the prohibited comparison repositories.
