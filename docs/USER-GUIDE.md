# ScadMill user guide

This guide describes the current Windows desktop beta candidate, including completed M3 behavior and the M4 surfaces already present. Later M5/M6 work is identified explicitly.

## Start a model

On first launch, choose a blank file, open a project, reopen a recent project, or load one of the three sample models. ScadMill asks before a sample replaces non-empty work. Reopen the welcome surface from the application when you need it again.

Enter OpenSCAD source such as `cube([10, 20, 30]);`. Use **Render preview** or F5 for the faster preview policy. Use **Render full** or F6 for final-quality geometry and exports. A **Preview quality** label identifies preview-only overrides.

## Work with projects and files

Desktop projects are folders you choose. Browser projects are named workspaces stored locally in IndexedDB. The Files surface creates, renames, moves, and opens text or binary project assets. Desktop-only OS trash and reveal actions are omitted in the browser.

Save the current document with the File command or configured shortcut; use Save All for every dirty document. A desktop `.scad` file opened through the OS is forwarded to the existing ScadMill instance. ScadMill opens it immediately only when replacing the current workspace is safe.

## Recover and reconcile work

ScadMill records recoverable unsaved buffers. If recovery data exists, review it before replacing the workspace. External disk edits use a per-hunk reconciliation view instead of silently overwriting either side. Failed annotation loads or saves keep in-memory annotations visible and provide retry or export recovery.

## Inspect geometry

3D results support orbit, pan, zoom, axis views, fit, projection choice, scene furniture, measurement, and pinned annotations. Engine-produced 2D SVG uses a separate sanitized pane with pan, zoom, fit, dimensions, and scale. An incompatible pinned viewer mode shows an explicit empty state.

## Use Customizer parameters

Top-level stock OpenSCAD Customizer declarations become typed controls. Overrides affect render and export requests without rewriting source. Choose the write action when you intentionally want explicit values written into the assignments. Named sets import and export using the stock JSON form.

## Export and share

Full-quality export supports 3MF, STL, OFF, AMF, SVG, DXF, and PNG where the engine supports the model. Browser workspaces can import and export byte-preserving ZIP archives and create a serverless single-file share link. A full export, not preview, is the only export source.

## Configure the desktop engine

ScadMill accepts only the OpenSCAD version recorded in `ENGINE_VERSION`. It tries the bundled candidate, saved executable, `SCADMILL_OPENSCAD`, and `PATH`. If the found executable is missing or has another version, select the exact pinned executable in **Configure engine** and retry. ScadMill does not replace older system installations.

## Browser rendering

Browser editing and project features work without an engine. Rendering requires the separately distributed, version-pinned OpenSCAD JavaScript/WASM pair. Q-0033 permits publication only with the exact corresponding source, GPL-2.0-or-later materials, reproducible build recipe, and checksums. A missing or failed engine load leaves editing available and offers Retry when retry can help. Native/browser SVG parity converts only CRLF to LF for comparison under Q-0034 while retaining the raw artifacts and hashes.

## Connect a local MCP client on Windows

The MCP bridge is desktop-only and off by default. Keep the ScadMill GUI open. In **Settings**, search for **AI**, choose the `write_file` and `set_parameters` permissions you want, then enable **local MCP server (stdio)**. Configure the client to run the exact same installed executable with one argument:

```text
"C:\\Program Files\\ScadMill\\scadmill.exe" --mcp-stdio
```

Replace the path if ScadMill is installed elsewhere. A connected client appears in the status bar. Read-only tools operate immediately. Mutation tools are denied by default; **Allow once** grants exactly one request and **Allow for this session** lasts only until the GUI session ends or you change it. Accepted mutation requests still enter the History review surface and do not alter the project until you approve the displayed file diff or parameter values. Denial leaves project state unchanged.

The History rail also records ordinary workspace commands. Entries are newest first and identify whether a command came from you, the AI panel, an external agent, or ScadMill itself. Select an entry to inspect its time, kind, undoability, and exact before/after source when the command edited a document. Use the shared Edit menu or shortcuts to undo and redo applicable commands in chronological order.

Turn the toggle off to close the authenticated local relay and its client process. For a connection failure, verify that the GUI is still open, the MCP toggle is enabled, and the client command uses that exact installed `scadmill.exe`, not a copied or older build.

## Settings and privacy

Settings cover editor, rendering, engine, viewer, formatter, theme, AI, keybindings, and privacy behavior. On desktop, open a project and use **Rendering -> Persist render cache for this project** to opt only that project into durable render caching; it is off by default and unavailable for scratch work. The adjacent disclosure lists the stored geometry, logs, diagnostics, and statistics. Turning the option off stops disk-cache use without deleting existing records. Choose **Clear this project's disk render cache** to delete that project's durable records.

Desktop secrets use the OS credential store. Browser secrets remain session-only unless you explicitly enable the warning-labeled persistence option. ScadMill has no telemetry; see [PRIVACY.md](../PRIVACY.md).

## Current milestone limits

Q-0033 and Q-0034 are resolved, but their exact compliance-package and parity execution evidence must still pass before the web engine is published. The Windows beta includes the current AI, MCP, and complete command-history surfaces. Animation, installed libraries, navigation and refactoring expansion, batch features, printability and slicing estimates, color-preserving 3MF, and the headless CLI remain release-gated M4-M6 work unless their milestone evidence is recorded.
