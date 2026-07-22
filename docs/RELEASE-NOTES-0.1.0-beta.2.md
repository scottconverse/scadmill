# ScadMill 0.1.0-beta.2

**Status:** Release candidate preparation. This version is not the supported public download until the signed GitHub release is published and this notice is updated with its exact verified installer facts.

ScadMill 0.1.0-beta.2 brings the completed M5 and M6 capability set into the next Windows desktop beta candidate. It remains a source-first OpenSCAD workbench: projects stay ordinary files, OpenSCAD remains a separate unmodified engine, and preview output is never used for export.

## What is new since 0.1.0-beta.1

- Model-history timeline with source diffs and undoable restore.
- Sequential batch export for selected Customizer parameter sets.
- Pinned per-project library installation with license display and library-aware completions.
- Project-wide search, confirmed replace, symbols, references, and go-to-definition.
- Two independent editor groups with side-by-side or stacked layouts.
- Real section-plane inspection and named per-project camera bookmarks.
- On-demand printability reporting with explicit `NOT CHECKED` results.
- Fresh full-quality 3MF handoff to a configured or detected desktop slicer.
- Checksummed OpenSCAD engine inventory, managed installation, and strict project pins.
- Machine-readable headless `render`, `export`, `params`, and `check` commands.
- Color and multipart 3MF rendering, per-part visibility, and color-preserving multi-object export.
- Fully offline Kiri:Moto 4.7.1 design-time print-time and filament estimates using clearly labeled generic profiles. Generated G-code is discarded; use a real slicer and printer profile for manufacturing.

## Platform and engine

- Candidate platform: 64-bit Windows 10 or 11.
- Required rendering engine: the separate official OpenSCAD 2026.06.12 snapshot recorded in `ENGINE_VERSION`.
- Product license: Apache-2.0. Third-party and separately distributed components retain their own licenses.
- No public browser application, macOS installer, or Linux installer is included in this Windows-first candidate.

## Candidate verification

The source candidate must pass hosted CI, the isolated similarity gate, the literal one-hour reliability soak, the owner-designated Radeon 780M viewer profile, exact signed-installer hash and Authenticode verification, and a clean Windows Sandbox install-to-uninstall walkthrough before publication. GitHub Actions artifacts are evidence inputs, not supported downloads.

The exact installer filename, byte length, SHA-256, signer, source commit, and evidence links will be added only after those checks pass.

## Known specification question

Q-0042 records a literal XML-tag contradiction between the required OpenSCAD Color mode and AC-15.k's Base Material tag names. The candidate uses the normative Color encoding, preserves two separately colored and positioned objects, round-trips both meshes, and tells users to assign filaments per object. It does not claim that the contradictory Base Material tag wording is satisfied without an owner amendment.

## Previous release and rollback

The previous public version is `0.1.0-beta.1`. See [RELEASE-ROLLBACK-0.1.0-beta.2.md](RELEASE-ROLLBACK-0.1.0-beta.2.md) for the candidate withdrawal and downgrade boundary.
