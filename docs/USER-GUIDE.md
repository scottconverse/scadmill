# ScadMill user guide

This guide describes behavior implemented through the current M3 candidate. Items scheduled for M4–M6 are not presented as available.

## Start a model

On first launch, choose a blank file, open a project, reopen a recent project, or load one of the three sample models. ScadMill asks before a sample replaces non-empty work. Reopen the welcome surface from the application when you need it again.

Enter OpenSCAD source such as `cube([10, 20, 30]);`. Use **Render preview** or F5 for the faster preview policy. Use **Render full** or F6 for final-quality geometry and exports. A **Preview quality** label identifies preview-only overrides.

## Work with projects and files

Desktop projects are folders you choose. Browser projects are named workspaces stored locally in IndexedDB. The Files surface creates, renames, moves, and opens text or binary project assets. Desktop-only OS trash and reveal actions are omitted in the browser.

Save the current document with the File command or configured shortcut; use Save All for every dirty document. A desktop `.scad` file opened through the OS is forwarded to the existing ScadMill instance. ScadMill opens it immediately only when replacing the current workspace is safe.

## Recover and reconcile work

ScadMill records recoverable unsaved buffers. If recovery data exists, review it before replacing the workspace. External disk edits use a per-hunk reconciliation view instead of silently overwriting either side. Failed annotation loads or saves keep in-memory annotations visible and provide retry/export recovery.

## Inspect geometry

3D results support orbit, pan, zoom, axis views, fit, projection choice, scene furniture, measurement, and pinned annotations. Engine-produced 2D SVG uses a separate sanitized pane with pan, zoom, fit, dimensions, and scale. An incompatible pinned viewer mode shows an explicit empty state.

## Use Customizer parameters

Top-level stock OpenSCAD Customizer declarations become typed controls. Overrides affect render/export requests without rewriting source. Choose the write action when you intentionally want explicit values written into the assignments. Named sets import and export using the stock JSON form.

## Export and share

Full-quality export supports 3MF, STL, OFF, AMF, SVG, DXF, and PNG where the engine supports the model. Browser workspaces can import/export byte-preserving ZIP archives and create a serverless single-file share link. A full export—not preview—is the only export source.

## Configure the desktop engine

ScadMill accepts only the OpenSCAD version recorded in `ENGINE_VERSION`. It tries the bundled candidate, saved executable, `SCADMILL_OPENSCAD`, and `PATH`. If the found executable is missing or has another version, select the exact pinned executable in **Configure engine** and retry. ScadMill does not replace older system installations.

## Browser rendering

Browser editing and project features work without an engine. Rendering requires the separately distributed, version-pinned OpenSCAD JavaScript/WASM pair. The public repository does not currently distribute those bytes while Q-0033 is unresolved. A missing or failed engine load leaves editing available and offers Retry when retry can help.

## Settings and privacy

Settings cover editor, rendering, engine, viewer, formatter, theme, AI, keybindings, and privacy behavior. On desktop, open a project and use **Rendering → Persist render cache for this project** to opt only that project into durable render caching; it is off by default and unavailable for scratch work. The adjacent disclosure lists the stored geometry, logs, diagnostics, and statistics. Turning the option off stops disk-cache use without deleting existing records. Choose **Clear this project's disk render cache** to delete that project's durable records.

Desktop secrets use the OS credential store. Browser secrets remain session-only unless you explicitly enable the warning-labeled persistence option. ScadMill has no telemetry; see [PRIVACY.md](../PRIVACY.md).

## Current milestone limits

Native/WASM SVG byte parity awaits Q-0034. Public web-engine distribution awaits Q-0033. MCP/AI workflows, installed libraries, navigation/refactoring expansion, history/batch features, printability/slicing estimates, color-preserving 3MF, and the headless CLI belong to M4–M6.
