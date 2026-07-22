# ScadMill 0.1.0-beta.2

**Status:** Published Windows prerelease. Download only from the [official GitHub release](https://github.com/scottconverse/scadmill/releases/tag/v0.1.0-beta.2). The product site and current manual are at [scadmill-beta.sconverse.chatgpt.site](https://scadmill-beta.sconverse.chatgpt.site).

ScadMill 0.1.0-beta.2 brings the completed M5 and M6 capability set into the public Windows desktop beta. It remains a source-first OpenSCAD workbench: projects stay ordinary files, OpenSCAD remains a separate unmodified engine, and preview output is never used for export.

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

- Platform: 64-bit Windows 10 or 11.
- Required rendering engine: the separate official OpenSCAD 2026.06.12 snapshot recorded in `ENGINE_VERSION`.
- Product license: Apache-2.0. Third-party and separately distributed components retain their own licenses.
- No public browser application, macOS installer, or Linux installer is included in this Windows-first release.

## Download and verification

- Filename: `ScadMill_0.1.0-beta.2_x64-setup.exe`
- Byte length: `211574008`
- SHA-256: `49C107B1648D918B7DAF16B47B4F3BAD0500EDB160D8E734E6C400E7E2578A91`
- Windows signer: `CN=Scott Converse, O=Scott Converse, L=Longmont, S=co, C=US`
- Source commit: `14d8424784cc0ca24cdf8184098098cfaa136be4`

The exact signed setup passed a fresh hosted-Windows install, `.scad` association, active launch, normal and off-monitor window restoration, and uninstall lifecycle. The exact source-bound runtime separately passed hosted CI, the isolated similarity gate, the literal one-hour reliability soak, the Windows Sandbox newcomer walkthrough, crash recovery, orphan cleanup, and the owner-designated Radeon 780M viewer profile. GitHub Actions artifacts are evidence inputs, not supported downloads.

- [Hosted CI — eight jobs passed](https://github.com/scottconverse/scadmill/actions/runs/29922772987)
- [Isolated similarity gate — passed](https://github.com/scottconverse/scadmill/actions/runs/29922880821)

## Resolved specification correction

Amendment A-11 resolved Q-0042 by removing contradictory Base Material XML wording from AC-15.k. The specification now consistently requires the OpenSCAD Color encoding used by beta.2: two separately colored and positioned objects, distinct `<m:color>` entries in one `<m:colorgroup>`, successful mesh round-trip, and no `<basematerials>` group.

## Previous release and rollback

The previous public version is `0.1.0-beta.1`. See [RELEASE-ROLLBACK-0.1.0-beta.2.md](RELEASE-ROLLBACK-0.1.0-beta.2.md) for the release withdrawal and downgrade boundary.
