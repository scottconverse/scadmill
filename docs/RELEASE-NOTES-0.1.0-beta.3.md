# ScadMill 0.1.0-beta.3

**Status:** Published Windows prerelease. Download only from the [official GitHub release](https://github.com/scottconverse/scadmill/releases/tag/v0.1.0-beta.3). The product site and current manual are at [scadmill-beta.sconverse.chatgpt.site](https://scadmill-beta.sconverse.chatgpt.site).

ScadMill 0.1.0-beta.3 is a maintenance release of the complete M0-M6 Windows desktop beta. It does not add a new product milestone.

## Maintenance changes

- Corrects the first-run instruction so it names the visible **Open project** action instead of a recents-only reopen action.
- Runs ordinary CI for release-tag pushes, adds a clean website build/test job, and rejects Git LFS pointer files or accidental oversized tracked blobs.
- Corrects packaged-desktop editor targeting so history and workbench flows act on the focused editor.
- Persists window state before teardown and includes packaged-lifecycle reliability fixes.

## Resolved specification correction

Amendment A-11 resolves Q-0042. The normative multi-object 3MF requirement now consistently describes the OpenSCAD Color path ScadMill implements, requires `<m:colorgroup>` and `<m:color>` references, and rejects the contradictory Base Material wording.

## Platform and scope

- Platform: 64-bit Windows 10 or 11.
- Required rendering engine: the separate official OpenSCAD 2026.06.12 snapshot recorded in `ENGINE_VERSION`.
- Product license: Apache-2.0. Third-party and separately distributed components retain their own licenses.
- No public browser application, macOS installer, or Linux installer is included in this Windows-first release.

## Download and verification

- Filename: `ScadMill_0.1.0-beta.3_x64-setup.exe`
- Byte length: `211578856`
- SHA-256: `7F79FF060F76A3272E42821C7781A87E776EE7742BC9A503BF2F8A95D59EA87E`
- Authenticode signer: `CN=Scott Converse, O=Scott Converse, L=Longmont, S=co, C=US`
- Source/tag commit: `179ef30eaeb6061acdf814477d8302a81b864788`

The tag, installer build source, and source commit are identical. All nine required hosted checks and the isolated similarity gate passed on that source. Do not substitute an unsigned CI artifact or a local build for the supported installer.

The final exact-main clean-environment rerun was not completed. The owner accepted publication without it, so beta.3 must not be described as fully release-proven.

## Previous release and rollback

The previous public version is `0.1.0-beta.2`. See [RELEASE-ROLLBACK-0.1.0-beta.3.md](RELEASE-ROLLBACK-0.1.0-beta.3.md) for the beta.3 withdrawal and replacement boundary.
