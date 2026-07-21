# ScadMill FAQ

## Where can I download the Windows beta?

Download `0.1.0-beta.1` from the [official GitHub release](https://github.com/scottconverse/scadmill/releases/tag/v0.1.0-beta.1). It is a 64-bit Windows desktop beta. Verify the exact byte length, SHA-256, and Windows signer in the [Windows beta guide](WINDOWS-BETA.md); GitHub Actions artifacts are not supported installers.

## Why can I edit in the browser but not render?

The implemented editor and browser project store do not require OpenSCAD, but there is no public ScadMill web application or WebAssembly engine today. Rendering in that source target requires the separately fetched, version-pinned JavaScript/WASM engine pair. Q-0033 permits a future public distribution only with the exact corresponding source, GPL-2.0-or-later materials, reproducible build recipe, and checksums. The historical M3 package passed verification but remains unpublished and is not part of the Windows-first beta. A load failure preserves editing and local projects.

## Why does ScadMill reject my installed OpenSCAD?

Reproducible geometry requires the exact version in `ENGINE_VERSION`. Configure that executable explicitly; ScadMill leaves other installations untouched.

The Windows setup does not bundle OpenSCAD. Follow the [exact download, SHA-256, extraction, and configuration steps](WINDOWS-BETA.md#install-the-required-openscad-engine) for OpenSCAD `2026.06.12`.

## What is the difference between Preview and Full?

Preview uses the fastest available backend, the preview timeout, and preview-only quality limits. Full applies no preview overrides and is the only source used for exports.

## How does `$t` animation render?

An executable `$t` reference in the active OpenSCAD file shows a 100-frame animation bar below the viewer. Frames map to `$t` values from 0.00 through 0.99 and use the normal preview pipeline. FPS is a target: ScadMill waits for each real geometry render, so slow models reduce playback speed instead of building a render queue. Pause cancels the in-flight animation request and stops future frames; the render overlay's Cancel action remains available for any current engine request.

## Where are my projects stored?

Desktop projects remain in the folder you selected. Browser workspaces live in IndexedDB under the browser profile. Browser ZIP export is the portable backup and transfer path.

## Does ScadMill upload my models or collect telemetry?

No telemetry is included, and ScadMill does not send model source to a ScadMill service. The web target requests only the same-origin engine assets described in [PRIVACY.md](../PRIVACY.md).

## What happens to unsaved work when I open another project?

ScadMill blocks silent replacement when documents are dirty or recovery is pending. Save or resolve the current state, then complete the requested open, or keep the current workspace.

## Why is Move to trash absent in the browser?

IndexedDB cannot provide real OS-trash semantics. The browser omits the action instead of permanently deleting while calling it trash. Desktop projects retain OS trash.

## Can I recover after a crash?

ScadMill records recoverable unsaved buffers and presents them on restart. The published `0.1.0-beta.1` package passed normal restart and forced-process recovery in its isolated installer lifecycle evidence.

## How is native/browser SVG parity checked?

STL parity remains exact byte-for-byte. Q-0034 permits SVG comparison to convert only CRLF line endings to LF before comparison. The gate still retains both raw artifacts, lengths, and hashes, and permits no other normalization or semantic fallback.

## How do I connect an MCP client on Windows?

MCP is a desktop-only, local beta feature and is off by default. Keep the ScadMill GUI open, open **Settings**, search for **AI**, configure the mutation permissions, and enable **local MCP server (stdio)**. Configure your MCP client to launch the exact installed executable:

```text
C:\Users\YOUR_USER\AppData\Local\ScadMill\scadmill.exe --mcp-stdio
```

Replace `YOUR_USER` with the current Windows profile name, or select the exact installed path if you chose another location. The status bar reports when an external agent is connected. Read tools run directly; `write_file` and `set_parameters` are denied by default and require **Allow once** or **Allow for this session**. Even then, each proposed mutation appears in History for explicit approval or denial before it changes the project. Turning the MCP toggle off closes the relay, removes its session endpoint, and exits the client process.

If a client cannot connect, confirm the GUI is running, the toggle is on, the command points to that same installed executable, and no older relay process remains.

## Where do AI messages and keys go?

Messages and selected context go only to the provider/model you choose for that project conversation. ScadMill does not proxy them through a ScadMill service. Named provider configurations have separate secrets; desktop stores them in the OS credential store, while the browser uses session storage unless you explicitly opt into the warning-labeled persistent storage setting. Settings export and saved conversations exclude exact configured secret values.

## Which later capabilities are not in this beta?

AI assistance and the local MCP bridge are present in the current M4 workbench. Installed-library expansion, navigation and refactoring expansion, slicing and manufacturing estimates, and the headless CLI remain later M5/M6 work and are not claimed by this beta.
