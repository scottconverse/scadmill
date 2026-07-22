# ScadMill Windows beta guide

ScadMill `0.1.0-beta.1` is a public beta for 64-bit Windows desktop. Use only the setup executable and checksum attached to the [official GitHub release](https://github.com/scottconverse/scadmill/releases/tag/v0.1.0-beta.1). GitHub Actions artifacts are verification inputs and are not supported downloads.

- Filename: `ScadMill_0.1.0-beta.1_x64-setup.exe`
- Byte length: `208699552`
- SHA-256: `D196878A49804F852C49A81ACBB4AC5C232A88DA737F2D756F9B6376E435A588`
- Windows signer: `CN=Scott Converse, O=Scott Converse, L=Longmont, S=co, C=US`

## What the setup will install

The Windows candidate uses an NSIS current-user setup with normal uninstall support, a `.scad` file association, and the offline WebView2 installer required by the desktop interface. It does not bundle or replace OpenSCAD. Rendering and model export remain disabled until ScadMill finds the exact supported OpenSCAD executable described below; editing and local project work remain available.

The first public beta does not include macOS or Linux installers and does not publish the browser application or OpenSCAD WebAssembly engine.

## Verify the published ScadMill setup

Download the setup and its published checksum from the release page. In PowerShell, run:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\the-downloaded-setup.exe
Get-AuthenticodeSignature -LiteralPath .\the-downloaded-setup.exe |
  Format-List Status, StatusMessage, SignerCertificate
```

Continue only when the SHA-256 exactly matches the value above and `Status` is `Valid` with the signer shown above. An unsigned CI artifact is not a public beta installer.

## Install the required OpenSCAD engine

ScadMill requires the exact official OpenSCAD development snapshot recorded in [`ENGINE_VERSION`](../ENGINE_VERSION):

- Version: `2026.06.12`
- Windows archive: [`OpenSCAD-2026.06.12-x86-64.zip`](https://files.openscad.org/snapshots/OpenSCAD-2026.06.12-x86-64.zip)
- Archive SHA-256: `3AA51474EA66609FB3FAFA4AA7F2AB4B6FE3FF50C130184F11BBE3818F3EF5AA`
- Extracted `openscad.exe` SHA-256: `DE9A0C732C23C3FEB0B49CF938777AA0AEE3E206DB9E98571672CACC4816C524`

Download the ZIP from the official link, then verify it before extraction:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\OpenSCAD-2026.06.12-x86-64.zip
```

If the hash matches, extract it to a folder you control. For example:

```powershell
Expand-Archive -LiteralPath .\OpenSCAD-2026.06.12-x86-64.zip -DestinationPath C:\Tools\OpenSCAD-2026.06.12
Get-ChildItem -LiteralPath C:\Tools\OpenSCAD-2026.06.12 -Filter openscad.exe -Recurse -File
```

Verify the extracted executable too, substituting its real path:

```powershell
$engine = Get-ChildItem -LiteralPath C:\Tools\OpenSCAD-2026.06.12 -Filter openscad.exe -Recurse -File |
  Select-Object -First 1
Get-FileHash -Algorithm SHA256 -LiteralPath $engine.FullName
```

Do not continue if either hash differs. ScadMill will also reject an executable that reports another OpenSCAD version. Existing stable or older OpenSCAD installations are left untouched.

## Configure OpenSCAD in ScadMill

1. Start ScadMill.
2. If OpenSCAD is unavailable, choose **Configure engine** in the status banner.
3. Enter the full path to the verified `openscad.exe`.
4. Choose **Save and retry**.
5. Confirm the status reports **OpenSCAD 2026.06.12** before rendering or exporting.

You can also edit the **Engine executable path** in Settings. A missing path, an unreadable executable, or another version leaves editing available but keeps rendering and model export disabled.

Use **Render preview** or F5 for preview-quality geometry. Use **Full render** or F6 for final geometry. Only full-quality results are export sources.

## Beta limitations

- This release target is Windows desktop only. macOS, Linux, and public web distribution remain future release work.
- The Radeon 780M is the owner-designated performance-evidence host, not a minimum supported GPU.
- The exact OpenSCAD snapshot is a separate required download and is not managed or updated by ScadMill.
- The development branch's M5 features plus M6 printability, slicer handoff, engine management, headless CLI, color/multipart preview, and color-preserving 3MF export are not included in this beta. Manufacturing estimates remain M6 work.
- AI assistance sends only the conversation and context you select to the provider endpoint you configure. ScadMill does not operate an AI proxy. See [`PRIVACY.md`](../PRIVACY.md).
- The local MCP bridge is off by default. Mutation tools remain denied unless you grant a session permission, and accepted requests still require review before changing a project.
- Durable desktop render caching is off by default and enabled separately for each project.

Report suspected vulnerabilities through the private channel described in [`SECURITY.md`](../SECURITY.md). Do not disclose sensitive security details in a public issue.

## Uninstall and retained data

After publication, uninstall ScadMill through **Windows Settings → Apps → Installed apps → ScadMill → Uninstall**. The installer lifecycle removes the installed application and ScadMill's `.scad` association. User-selected project folders and `.scad` files remain outside the application install directory.

Uninstall is not an all-data-erasure promise. Before uninstalling, clear every configured AI key from **Settings → AI** and clear each project's durable render cache from **Settings → Rendering** if you do not want those records retained. Settings, recovery information, cache records, or operating-system credential records may otherwise remain in the Windows user profile. ScadMill does not yet provide one command that erases every desktop store.

Back up project folders before installation, upgrade, uninstall, or recovery work. The first public beta has no earlier supported ScadMill release to reinstall; its withdrawal and forward-replacement procedure is in [`RELEASE-ROLLBACK.md`](RELEASE-ROLLBACK.md).

## Release qualification

The published setup passed the literal one-hour N-2 soak, clean Windows Sandbox newcomer walkthrough, Radeon 780M qualification, valid signed-installer lifecycle, exact-head hosted CI, and isolated similarity gate. The public asset is supported only when its byte length, SHA-256, and Windows signature match this guide.
