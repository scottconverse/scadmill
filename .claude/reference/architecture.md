# Architecture (moved verbatim from CLAUDE.md, 2026-10-09)

**Dependency direction is the central invariant.** `src/application/platform` declares typed
capability records and ports. `src/platform-web` and `src/platform-desktop` construct them. Shared
UI (`src/ui`) and application code must **never** import browser globals, Tauri APIs, or
desktop-shell details — only adapters may. Unavailable capabilities are explicitly omitted, never
simulated.

```
src/ui              React workbench, CodeMirror editor, Three.js viewer
src/application     services + typed capability ports (platform-agnostic)
src/platform-web    IndexedDB, WASM engine worker
src/platform-desktop Tauri adapter
src/desktop-shell   Tauri 2 app (Rust, src-tauri/)
src/native-engine   Rust crate driving the OpenSCAD subprocess
src/language        OpenSCAD grammar (Lezer) + language tooling
```

**Engine boundary.** The desktop adapter discovers only the exact pin in `ENGINE_VERSION`, then runs
the unmodified executable out of process. Each request is immutable: bounded project map, typed
parameter overrides, quality, timeout; ordered output capture; process-tree termination on
timeout/cancel; geometry validation on return. **Preview uses preview-only policy; only a full
render may be exported.** A strict `scadmill.project.json` pin enters every native render and export
request, and a version mismatch is rejected.

`ENGINE_VERSION` is not a version string — it is a provenance record (URLs, SHA-256 of archives and
executables, WASM build/reproducibility run IDs, the Amendment A-7 rationale for the pin). Treat it
as evidence; do not casually edit it.

**Workers.** Native rendering is out of process. WASM execution, project indexing, STL decoding,
printability analysis, manufacturing-estimate preprocessing/slicing, and archive work all cross
validated worker boundaries. Automatic renders debounce, superseded work cancels, animation is
sequential and backpressured. Large printability/estimate inputs **fail closed rather than falling
back to the main thread**.

**Color path** is centralized at each EngineService adapter: Manifold, lazy-union, model-color, and
Color-material options are always used; Base Material is never selected.

**Privacy boundaries.** No telemetry, no cloud service. Optional AI requests pass through a bounded
native broker straight to the exact configured endpoint, refuse redirects, and carry only explicitly
selected context. Secrets live in Windows Credential Manager. The MCP bridge is loopback-only, off
by default, permissioned, and review-gated — mutations land in the History review surface first.
