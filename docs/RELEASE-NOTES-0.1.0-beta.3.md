# ScadMill 0.1.0-beta.3

**Status:** Release candidate; not public yet. The supported public download remains [0.1.0-beta.2](https://github.com/scottconverse/scadmill/releases/tag/v0.1.0-beta.2) until beta.3 passes the exact signed-installer release gate.

ScadMill 0.1.0-beta.3 is a maintenance release of the complete M0-M6 Windows desktop beta. It does not add a new product milestone.

## Candidate changes

- Corrects the first-run instruction so it names the visible **Open project** action instead of a recents-only reopen action.
- Resolves specification question Q-0042 through amendment A-11. The normative 3MF requirement now consistently describes the OpenSCAD Color path ScadMill implements and rejects the contradictory Base Material wording.
- Runs ordinary CI for release-tag pushes, adds a clean website build/test job, and rejects Git LFS pointer files or accidental oversized tracked blobs.

## Platform and scope

- Platform: 64-bit Windows 10 or 11.
- Required rendering engine: the separate official OpenSCAD 2026.06.12 snapshot recorded in `ENGINE_VERSION`.
- Product license: Apache-2.0. Third-party and separately distributed components retain their own licenses.
- No public browser application, macOS installer, or Linux installer is included in this Windows-first release.

## Download and verification

The beta.3 filename, byte length, SHA-256, Windows signature, source commit, and release URL remain **pending** until one exact candidate passes the release gate. Do not substitute an unsigned CI artifact or a local build for the eventual supported installer.

## Previous release and rollback

The current public version is `0.1.0-beta.2`. See [RELEASE-ROLLBACK-0.1.0-beta.3.md](RELEASE-ROLLBACK-0.1.0-beta.3.md) for the beta.3 withdrawal and replacement boundary.
