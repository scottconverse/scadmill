# ScadMill user manual

**Applies to:** ScadMill `0.1.0-beta.1`, the public 64-bit Windows desktop beta.

**Published manual:** <https://scadmill-beta.sconverse.chatgpt.site/manual>

This is the canonical user manual. It starts without assuming CAD or programming experience, then provides the technical behavior and architecture needed by advanced users and contributors. For exact download hashes and installer lifecycle details, keep the [Windows beta guide](WINDOWS-BETA.md) beside this manual.

## Part I — Non-technical guide

### What ScadMill is

OpenSCAD models are readable text instructions. ScadMill gives you one place to edit those instructions, render the result, inspect the geometry, organize project files, adjust Customizer parameters, and export models. It does not lock the model into a private format: the `.scad` source remains ordinary OpenSCAD source.

### Install safely

1. Download `ScadMill_0.1.0-beta.1_x64-setup.exe` only from the [official release](https://github.com/scottconverse/scadmill/releases/tag/v0.1.0-beta.1).
2. Verify the installer SHA-256 is `D196878A49804F852C49A81ACBB4AC5C232A88DA737F2D756F9B6376E435A588` and that Windows reports a valid signature from Scott Converse.
3. Run the current-user installer. It includes uninstall support and the offline WebView2 runtime used by the interface.
4. Separately download and verify the exact official OpenSCAD `2026.06.12` Windows snapshot using [these engine instructions](WINDOWS-BETA.md#install-the-required-openscad-engine).
5. Start ScadMill, choose **Configure engine**, select the verified `openscad.exe`, and confirm the status reports OpenSCAD 2026.06.12.

Editing and project work remain available before the engine is configured. Rendering and export do not.

### Make a first model

1. Choose a sample or create a blank file.
2. Enter `cube([20, 20, 20]);`.
3. Press **F5** for preview geometry.
4. Orbit, pan, zoom, fit, change projection, or measure in the 3D viewer.
5. Press **F6** for full geometry before exporting.

Preview is optimized for iteration. Full applies no preview quality override and is the only source used for exports.

### Work with projects

Open or create a folder-backed project. Files remain in that folder and are not uploaded to a ScadMill service. Tabs have separate edit and undo state. ScadMill preserves binary assets, resolves project-relative `include` and `use` paths, warns about external changes, and can present recoverable unsaved buffers after interruption.

Save important work normally and keep backups. This is beta software.

### Adjust and export

Stock OpenSCAD Customizer declarations appear as typed controls. Temporary values affect rendering without changing source; use the explicit write action when you want assignments updated. Named sets use the stock JSON format.

Full-quality export supports 3MF, STL, OFF, AMF, SVG, DXF, and PNG where appropriate to the model. ScadMill will not export preview geometry.

### Understand what is not included

The public beta is Windows-only. It does not publish a browser app, Mac/Linux installers, or OpenSCAD WebAssembly engine. OpenSCAD is a separate required download. The development branch now contains the complete M5 scope: model history, batch parameter-set export, the project library manager, structural project navigation, split editing, section view, and per-project camera bookmarks. These are not part of the published beta. Manufacturing estimates and the headless CLI remain M6 work.

## Part II — Technical reference

### Editor and language features

The CodeMirror workbench provides a fresh OpenSCAD grammar, highlighting, parse-gated formatting, built-in and visible-symbol completions, project dependency indexing, diagnostics, search, tabs, configurable keybindings, themes, and format-on-save. Structural project indexing runs away from the UI thread when available and remains bounded.

### Project search and navigation (development builds)

Open **Search** or press `Ctrl+Shift+F` (`Cmd+Shift+F` on macOS) to search every text file in the project. Literal, case-sensitive, and whole-word modes are available. Search reads `.gitignore` and `.scadmillignore`; the displayed ignored-file count makes that boundary visible. Replacement is a two-step operation: preview the exact match count, then confirm. Open unsaved buffers remain editor changes, while closed project files are written through the project storage port with compensation if a later write fails.

The same panel lists top-level modules, functions, and variables in the current OpenSCAD file. Select a symbol or reference to open the correct file and select its exact source range. Press `F12` on a module/function/variable use to follow its structurally parsed definition through `include`/`use`; use each outline row's **refs** action to list project references. Comments and strings are not treated as code references.

### Split editor (development builds)

Choose **Split** above the editor to create a second editor group. Each group owns its own tabs and retains its own cursor, selection, undo, and scroll session. Drag a tab onto the other group's tab bar to move it. Choose **Stack** or **Side by side** to change orientation, and **Close split** to merge the unique tabs back into one group. Clicking or focusing a group activates that group's current document globally, so preview/full render and export always target the focused group.

### Render lifecycle

Every render binds to an immutable source snapshot. Preview and full have separate policies, timeouts, and visible labels. Automatic renders are debounced; superseded work is cancelled. Console history retains ordered stdout/stderr, status, timing, diagnostics, and geometry statistics. Stale, cancelled, failed, or unavailable results are reported honestly rather than replacing the last good geometry.

### 2D/3D viewing and geometry comparison

STL output drives a demand-rendered 3D viewer with camera controls, axis views, perspective/orthographic projection, exact bounds, measurement, durable pinned annotations, and PNG capture. Sanitized engine SVG drives the 2D viewer with model-space dimensions, pan/zoom, fit, and scale. Successful renders compare application-owned geometry identity plus available volume, bounds, and triangle changes.

### Animation

An executable `$t` reference enables a 100-frame loop from 0.00 through 0.99. Each frame uses the ordinary preview path. The target FPS is not a promise: ScadMill waits for real geometry, so slow models reduce playback rate rather than creating an unbounded queue. Pause cancels the in-flight animation request.

### AI assistance

Named OpenAI-compatible, Anthropic, or local provider configurations use separately scoped secrets. Desktop secrets live in Windows Credential Manager. Requests contain the conversation plus only the source, diagnostics, parameters, or viewer screenshot selected in the panel, and go directly to the configured endpoint. ScadMill operates no AI proxy. Proposed code can be reviewed per hunk; agent mode and session auto-apply are separate, explicit, bounded controls.

### Local MCP bridge

The bridge is desktop-only and off by default. Keep the GUI open, configure mutation permissions in **Settings → AI**, then enable **local MCP server (stdio)**. Point the client to:

```text
C:\Users\YOUR_USER\AppData\Local\ScadMill\scadmill.exe --mcp-stdio
```

Read-only tools can operate after connection. `write_file` and `set_parameters` are denied unless allowed once or for the session, and accepted requests still enter the History review surface before changing a project.

### Storage and privacy

ScadMill includes no telemetry. Desktop projects remain in user folders. Recovery, settings, layout, annotations, and optional cache data use local application stores. Render caching is off by default, enabled per project, bounded, integrity-checked, and unavailable for scratch work. Turning cache off stops future disk use but does not erase existing records; use the explicit clear command while the project is open.

### Uninstall

Use **Windows Settings → Apps → Installed apps → ScadMill → Uninstall**. The app and `.scad` association are removed; user projects remain. Uninstall is not an all-data-erasure promise. Clear AI keys and each enabled project cache first if you do not want those records retained.

## Part III — Architecture

### Composition

The React workbench owns interaction and application state. Capability-shaped ports separate shared product logic from platform adapters. The Tauri shell supplies Windows file, dialog, process, credential, menu, association, and window operations.

### Engine boundary

ScadMill runs the unmodified, exact-pinned OpenSCAD executable out of process. A render request contains the bounded project snapshot, typed parameter overrides, requested quality, and timeout. The adapter stages contained files, launches the subprocess, captures output, terminates cancelled process trees, and validates returned STL or SVG before presentation. OpenSCAD—not ScadMill—remains the geometry authority.

### Data flow and trust boundaries

1. The editor captures source, referenced project files, and byte-preserving binary assets.
2. A native adapter stages an isolated request without rewriting user files.
3. OpenSCAD produces geometry and logs in a separate process.
4. Validated geometry feeds the appropriate viewer; diagnostics and statistics stay bound to the originating source snapshot.
5. Only full results can feed an export.

User files, engine execution, OS services, and optional provider traffic are distinct trust boundaries. Secrets use the OS credential store. AI is provider-direct and context-selective. MCP is local, authenticated, permissioned, and review-gated.

### Responsiveness and failure behavior

Native engine work is out of process. Mesh parsing, project indexing, archive work, and the browser-source engine adapter cross bounded worker boundaries. Automatic rendering is debounced, animation is backpressured, and cancellation is explicit. The workbench preserves the last good result while presenting engine failure, load failure, or stale state.

### Release and extension architecture

The release pipeline checks provenance and licenses, builds from a clean pinned tree, signs the Windows installer, and binds retained evidence to exact hashes. The current beta passed hosted CI, isolated similarity review, a literal one-hour soak, Radeon 780M performance evidence, and a clean Windows Sandbox install-to-uninstall walkthrough.

Development builds expose **Libraries** on the activity rail. Choose BOSL2, MCAD, or dotSCAD, download the pinned package, read the license shown from that package, and confirm installation. ScadMill copies only bounded runtime files plus the license into the current project and records ownership in `scadmill.libraries.json`; it never updates a pin silently. A custom pinned HTTPS ZIP can be reviewed through the same flow. Once a project source imports a vendored file with `include` or `use`, its module/function signatures participate in completion and native/WASM renders receive the same file map. Removing a library removes only manifest-owned files and leaves ordinary project source intact.

For interior inspection in a development build, enable **Section** in the 3D viewer, select X, Y, or Z, and drag **Section position** through the model. The control applies a real local clipping plane to the rendered mesh; it does not alter source or export geometry. Enter a name under **Camera bookmarks** to save the current position, target, up vector, projection, and zoom. Selecting the name recalls it; **Delete** removes it. Names are unique without regard to case, and saving the same name replaces that project bookmark.

The architecture includes seams for a separately qualified web distribution, a headless CLI, and manufacturing estimates. These remain M6 or distribution work and are not beta claims.

## Troubleshooting and support

- **Rendering disabled:** select the exact OpenSCAD 2026.06.12 executable. Other versions are intentionally rejected.
- **Render failed:** inspect console history and linked diagnostics, correct the model, and retry once. Cancel a hung request.
- **Layout or window is wrong:** use the View menu to reveal/reset panels; off-screen saved window positions are rejected.
- **Security issue:** use [GitHub private vulnerability reporting](https://github.com/scottconverse/scadmill/security/advisories/new), never a public issue.
- **Release integrity or engine hashes:** use [WINDOWS-BETA.md](WINDOWS-BETA.md).
- **Privacy detail:** use [PRIVACY.md](../PRIVACY.md).
- **Runtime and source structure:** use [ARCHITECTURE.md](../ARCHITECTURE.md).
