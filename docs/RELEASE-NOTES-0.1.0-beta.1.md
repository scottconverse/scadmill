# ScadMill 0.1.0-beta.1

ScadMill's first public beta is available for 64-bit Windows desktop.

Product site, manual, and architecture: <https://scadmill-beta.sconverse.chatgpt.site>

## Download and verify

Download `ScadMill_0.1.0-beta.1_x64-setup.exe` and its `.sha256` file from this release.

- Byte length: `208699552`
- SHA-256: `D196878A49804F852C49A81ACBB4AC5C232A88DA737F2D756F9B6376E435A588`
- Windows signer: `CN=Scott Converse, O=Scott Converse, L=Longmont, S=co, C=US`

Do not install a GitHub Actions artifact. Verify the downloaded file before running it; the complete commands are in the [Windows beta guide](https://github.com/scottconverse/scadmill/blob/main/docs/WINDOWS-BETA.md).

## Separate OpenSCAD requirement

ScadMill does not bundle or replace OpenSCAD. Rendering and export require the exact official OpenSCAD `2026.06.12` Windows snapshot and hashes listed in the Windows beta guide. Editing and project work remain available before the engine is configured.

## Included

- Source editor, project and file workflows, Customizer, and 2D/3D viewers
- Native preview and full-quality rendering, animation, render cache, and full-quality model export
- Geometry comparison, settings, recovery, AI assistance, local MCP bridge, and command history
- Current-user Windows installation, `.scad` association, and uninstall support

## Beta scope

This release is Windows desktop only. It does not publish a macOS or Linux installer, browser application, or OpenSCAD WebAssembly engine. Installed-library expansion, navigation/refactoring expansion, batch features, manufacturing and slicing estimates, color-preserving 3MF, and the headless CLI remain later M5/M6 work.

Report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/scottconverse/scadmill/security/advisories/new), not a public issue.
