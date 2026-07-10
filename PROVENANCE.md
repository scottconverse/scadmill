# Provenance ledger

ScadMill is an independent clean-room implementation governed by specification §2.

Each coherent capability slice adds one immutable JSON entry under `provenance/entries/`. Entries identify the author, specification basis, files touched, permitted inputs, recorded implementation decisions, observed test evidence, near misses, and the required attestation.

Entries conform to the strict Draft 2020-12 schema in `provenance/schema.json`. The ledger checker validates every entry in CI; on pull requests it also requires at least one newly added entry. Historical entries are not rewritten; corrections are new entries that identify the corrected record. Push and manual-workflow runs use baseline mode, which validates the complete ledger without demanding a synthetic entry.

Required attestation:

> No prohibited source was consulted in producing this change.

The owner-supplied independence gate is copied verbatim under `owner-gate/` and runs only in its isolated GitHub Actions workflow. Implementers must not execute or modify it locally.
