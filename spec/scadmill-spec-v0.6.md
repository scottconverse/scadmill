# ScadMill — Functional Specification

**Product name:** **ScadMill** (owner-selected 2026-07-09; scadmill.com/.org/.dev, GitHub org,
npm, PyPI, and crates.io all verified free at registry level that day)
**Version:** v0.6 · 2026-07-10
**Status:** Implementer handoff — this document is the complete brief. No other project
context should accompany it; if you received anything else alongside it, do not read it.
**Author role:** This specification was written by an author who knows existing OpenSCAD editor
products. It describes **behavior only** — what the software must do, never how any existing
product's source code does it. Implementers build **from this document alone** under the
provenance rules in §2. The result is a legally independent work, owned outright by its owner,
licensable however the owner chooses.

**Changes from v0.1:** added §4.0 workspace layout with wireframes; added §4.15 (C15
"beyond-parity" capabilities — things existing tools lack that this product should have); added
architecture rule A-6 (modularity caps); added N-7 (UI honesty); typed `EngineService`
interface (Appendix A); MCP tool schemas (Appendix B); theme token schema (Appendix C); default
keybinding table (Appendix D); 15 formatter golden fixtures (Appendix E); three sample models
(Appendix F, render-verified against OpenSCAD); milestone table extended to M6.
**Changes from v0.2 (autonomous-implementer hardening):** permitted inputs are now a whitelist
with a near-miss rule (§2.2/2.3); the similarity gate is isolated so implementers never touch
the comparison repos (§2.5); async question/amendment protocol and decide-and-record discretion
for implementers working without a live spec author (§2.7); engine version pinning via
`ENGINE_VERSION` at M0 (§2.7).
**Changes from v0.3 (amendments A-1…A-5, answering the implementer's first question round):**
AC-4.a fixed for 2D models (A-1); preview/full render semantics corrected — the engine CLI has
no orbitable preview mesh, both quality levels produce real geometry (A-2); `RenderRequest.files`
accepts binary assets (A-3); the similarity-gate harness is owner-supplied and now exists —
`owner-gate/similarity_gate.py` + CI job, delivered with this spec (A-4); engine pin may be a
vetted official-repo commit/nightly when parity or color support requires it, and building the
engine/WASM artifact from official source is a permitted activity (A-5).
**Changes from v0.4 (amendment A-7 — the engine pin is now a named snapshot, and multi-material
export is a first-class requirement):** the "official stable release by default" default in §2.7
is **deleted** — it contradicted FR-6.4 and FR-15.14, because the 2021.01 stable cannot export
color or multiple objects in 3MF at all; the pin is now the **2026.06.12 development snapshot**
with recorded rationale and checksums (§2.7); FR-15.14 gains explicit engine-mode requirements;
new FR-15.15 (multi-object colored 3MF export) with machine-checkable AC-15.k and honesty rules
about what slicers actually do with color metadata (they do not auto-map filaments — the UI must
never claim otherwise); FR-15.10's slicer handoff copy requirement updated to match.
**Changes from v0.5 (amendment A-8 — verified open-source leverage, from an owner-run
120-candidate scan with every license read from primary sources):** the approved dependency
list (§6) gains the OpenSCAD organization's official tree-sitter grammar (MIT) — usable
directly for structural features and as a licensed reference for the fresh CodeMirror grammar
the spec already requires; the Leathong openscad-LSP language server (effectively Apache-2.0 —
see the license caution in §6) with a one-formatter-authority rule; and, optionally, the
Kiri:Moto slicing engine (MIT) powering a new design-time manufacturing-estimates capability
(FR-15.16). New FR-15.17 adds library-aware editor completions. §2.2's reading whitelist gains
a safety-classified reference list (permissive projects implementers may read; GPL-family
projects that remain strictly off-limits). Scan-confirmed gaps are recorded so implementers
don't burn search time: no CodeMirror-6 OpenSCAD mode, no permissively-licensed highlighting
grammar, and no OpenSCAD grammar file for constrained AI decoding exist anywhere — those
remain original work as the spec already assumed.
**Amendment A-9 (owner benchmark update):** FR-2.5 no longer names a 2020-class integrated
GPU as minimum hardware. Performance evidence remains hardware-disclosing and must still prove
two-million-triangle orbit at ≥ 30 fps; the owner-designated benchmark baseline is AMD Radeon
780M. This benchmark is an acceptance-evidence baseline, not a minimum supported-hardware
claim. An earlier unbound Radeon checkpoint is diagnostic only.
Per-candidate qualification is accepted only from retained external evidence bound to the exact
candidate source tree and profiler harness. Static specification text does not predeclare a run
verdict.

---

## Plain-English summary (read this first)

This document tells a build team — human or AI agents — exactly what to build: a desktop and
web application for writing OpenSCAD code and seeing the 3D result live, similar in capability
to existing OpenSCAD editors, but written entirely fresh — plus a set of improvements none of
the existing tools have. The implementers never look at any existing editor's source code; they
read only this spec and public documentation. Every file they write gets a provenance record
saying who wrote it and what they consulted. At the end, an automated similarity measurement
proves the code is original. The result is a codebase the owner fully controls: it can be MIT,
commercial, dual-licensed — anything.

What it does for a user: you type OpenSCAD code on the left, a 3D model appears on the right.
Sliders and dropdowns appear automatically for the parameters in your code. You can measure the
model, export it for printing, format your code, see errors inline, and optionally ask an AI
assistant to write or fix code for you. Beyond that baseline it adds what today's tools miss:
render caching so nothing re-computes twice, a history timeline you can scrub back through,
batch export of every saved parameter set, a library manager for the big OpenSCAD libraries,
printability checks that say honestly what they did and didn't verify, and one-click handoff
to your slicer. It runs as a native Windows/macOS/Linux app and as a web page.

---

## 1. Scope and product definition

### 1.1 What this is

A source-first parametric CAD workbench for the OpenSCAD language:

- A **code editor** with full OpenSCAD language support.
- A **live 3D preview** and a **2D/SVG preview** of the model the code describes.
- The **OpenSCAD engine** (the unmodified upstream program) does all geometry evaluation,
  invoked at arm's length on two paths: a WebAssembly build in the browser, a native binary on
  desktop.
- A **parameter panel** generated automatically from annotated variables in the source.
- **Project/file management**, a **source formatter**, **diagnostics**, **settings**,
  **theming**, an optional **AI assist panel**, and (desktop) a **command/history layer** exposed
  to external agents as an MCP tool server.
- A **beyond-parity layer** (§4.15): render cache, model history, batch export, library
  manager, project search/navigation, printability report, slicer handoff, engine version
  manager, headless CLI, thumbnails, color preview.

### 1.2 What this is not

- Not a fork, port, or translation of any existing editor. No code, comments, file layout,
  identifier names, CSS, or assets from any existing OpenSCAD editor may enter this codebase.
- Not a geometry kernel. All geometry evaluation is delegated to the stock OpenSCAD engine.
- Not a modification of OpenSCAD itself. The engine is consumed as an unmodified, separately
  delivered artifact.

### 1.3 Platforms

| Target | Delivery | Engine path |
|---|---|---|
| Desktop (Windows, macOS, Linux) | Native app shell wrapping the web UI | OpenSCAD native binary, invoked as a subprocess |
| Web | Static site, no server-side compute | OpenSCAD WebAssembly build, executed in a Web Worker |

The UI codebase is shared across both targets behind a platform abstraction (§4.13). Desktop is
the primary target; the web target must never block a desktop capability.

---

## 2. Provenance rules (non-negotiable)

These rules exist so the finished codebase is independently owned. They bind every contributor,
human or AI, for the life of the project.

### 2.1 Roles

- **Spec author** — knows existing products; writes and amends this document. Never writes
  product code.
- **Implementers** — write all product code. Must not have read, and must not read, the source
  code of any existing OpenSCAD editor (including `openscad-studio`, TinkerQuarry's UI, or any
  fork of either). Fresh AI agents with no such material in context satisfy this by construction
  when their inputs are controlled per §2.3.
- **Reviewers** — review code for spec compliance and originality. Same reading restrictions as
  implementers.

### 2.2 Permitted inputs for implementers

**This list is a whitelist.** Anything not on it is out of bounds until the spec author adds it
by amendment.

1. This specification, its appendices, and its numbered amendments.
2. Public documentation of the OpenSCAD **language and CLI** (openscad.org manual, wiki, cheat
   sheet) — these document the engine being consumed, not any editor. Running the engine and
   observing its inputs/outputs is likewise permitted.
3. Public documentation and APIs of the approved dependencies in §6 — *(A-8)* including the
   **source code** of the approved permissively-licensed dependencies themselves (they are MIT/
   Apache; reading them is normal dependency use, recorded like any input).
4. General programming knowledge and public standards (W3C, MDN, MCP spec, file-format specs).
5. *(A-8)* **Named safe references** (permissively licensed; may be read for prior art, each
   read recorded in the ledger): the `thijsdaniels/vscode-openscad-preview` VS Code extension
   (MIT — customizer/preview/error-panel behavior reference; it is a preview plugin, not an
   editor reimplementation); OpenJSCAD's `getParameterDefinitions()` documentation and code
   (MIT — parameter-schema prior art); `scadm` and the OpenSCAD org's `openscad-library-manager`
   (both MIT — library-manager format alignment for FR-15.5); `alufers/openscad-parser` (MIT,
   unmaintained — parser reference only).
   **Explicitly still prohibited despite appearing related** (GPL family or unclear provenance;
   §2.3 applies in full): every OpenSCAD editor/GUI/IDE and its forks, the openscad-LSP **VS
   Code companion extension**, all GPL-licensed OpenSCAD formatters and linters (one linter's
   *documented rule list* may be transcribed as behavior requirements — its code may not be
   opened), and any unscoped/unofficial npm packages claiming OpenSCAD editor functionality
   (a family of such packages has unverifiable provenance — a recorded supply-chain risk).

**Web-access rule for autonomous implementers:** browse or search only in service of items 2–4
(the engine's docs, approved-dependency docs, public standards). Never search for, open, or
skim any OpenSCAD editor, GUI, or IDE project — not for "inspiration", not to check a detail,
not via a search-result snippet. If a search result or link turns out to be such a project,
close it immediately and record the near-miss in the provenance ledger (URL, what was sought,
confirmation that no content was used). A recorded near-miss is normal hygiene, not a
violation; an unrecorded one is.

### 2.3 Prohibited inputs

1. Source code, commit history, issues, PRs, or documentation of any existing OpenSCAD editor
   or its forks.
2. Screenshots or recordings of existing editors, except those the spec author has already
   reduced to behavioral text in this document.
3. Any TinkerQuarry repository content other than public OpenSCAD engine documentation it may
   mirror.

When an implementer needs behavior detail this spec lacks, they **ask the spec author** via
the protocol in §2.7. The answer is added to this document as a numbered amendment and only
then implemented. Questions and answers flow through the spec; never through code or
prohibited sources.

### 2.4 Provenance ledger

- The repo carries `PROVENANCE.md` plus a machine-readable `provenance/` directory.
- Every PR appends a ledger entry: files touched, author identity (agent/model or human),
  spec sections implemented, every external input consulted (URLs), and the attestation:
  *"No prohibited source was consulted in producing this change."*
- CI refuses merge of any PR without a well-formed ledger entry.

### 2.5 Independence gate (automated, isolated from implementers)

- A similarity measurement (file-level, whitespace-normalized line matching, LOC-weighted — the
  same method used for the July 2026 derivation measurement) runs against the current HEAD
  of `zacharyfmarion/openscad-studio` and against TinkerQuarry's `apps/ui`.
- **Isolation rule:** implementers never run this gate, never write its harness, and never
  clone or download the comparison repositories — doing so would place prohibited source on
  their machine and defeat the separation. The gate runs only in an isolated CI job (or on the
  spec-author/owner side); the comparison checkout lives solely inside that job and is
  discarded with it. Implementers see **scores and file names only**, never compared content.
  The gate harness itself is authored by the spec-author side, not by implementers.
- **The harness is delivered with this spec** *(amended A-4)*: `owner-gate/similarity_gate.py`
  (stdlib-only Python, thresholds embedded, scores-only output, exit 2 on breach — verified on
  synthetic breach/pass fixtures 2026-07-09) plus `owner-gate/ci-similarity-gate.yml`. At M0,
  copy both into the repo verbatim and wire the workflow; that satisfies the "similarity gate
  live" exit criterion. Other owner-side external dependencies, so they are never mistaken for
  implementer scope: signing/notarization credentials (FR-13.4 already tolerates their lag)
  and the web-target license counsel decision (§9.2, needed by M3, blocks nothing earlier).
- **Release-blocking thresholds:** zero files ≥ 0.60 similarity (excluding files < 20 normalized
  LOC and generated lockfiles); LOC-weighted mean similarity ≤ 0.25.
- Threshold breaches block release until the affected files are rewritten and the ledger records
  the rewrite. The breach report gives the implementer the flagged file's name and score only;
  the rewrite is done from this spec, not from a diff.

### 2.6 Naming and expression hygiene

- Do not reuse another product's component names, store names, CSS class names, or string
  literals where any reasonable alternative exists. Names must fall out of this spec's
  vocabulary (e.g., "Parameter Panel", "Console", "Model Viewer") or the implementer's own.
- Where identical wording is forced by an external standard (OpenSCAD CLI flags, customizer
  annotation syntax, MCP field names), that is fine — the standard, not another editor, is the
  source, and the ledger cites the standard.

### 2.7 Working protocol for autonomous implementers (async, no live spec author)

The implementer may be an autonomous coding agent on its own machine, with the spec author
reachable only through the repository. The loop:

- **Questions:** `spec/QUESTIONS.md` is a numbered queue. When behavior detail is missing,
  append an entry (number, date, spec section, the question, what is blocked). **Park only the
  blocked work item and continue with the next item** — never idle on an open question. The
  spec author answers by appending a numbered amendment to this document and marking the
  question resolved; only then is the parked item implemented.
- **Discretion:** anything this spec does not pin — internal naming, module boundaries within
  the A-6 caps, control sizing, copy tone, choice among approved dependencies — is the
  implementer's decision. Decide, record it in the PR's ledger entry under a `decisions:`
  field, and move on. A recorded decision the spec author later overrides by amendment is
  reworked without ceremony; an unrecorded decision is a review finding.
- **Unit of work:** one PR per coherent FR cluster (a capability slice, not a milestone).
  Every PR carries: the ledger entry (§2.4), tests written and observed failing first (V-1),
  and green CI. No PR mixes two capabilities.
- **Engine pin** *(amended A-5, A-7)*: at M0, record the chosen engine build in an
  `ENGINE_VERSION` file at the repo root. **The pinned engine is the official OpenSCAD
  development snapshot `2026.06.12`** (downloads at
  `https://files.openscad.org/snapshots/OpenSCAD-2026.06.12-x86-64.zip` for Windows; the
  same-date macOS artifact exists — the openscad.org snapshot manifest pointed at it as of
  2026-07-10; use the nearest same-week build where a platform lacks an exact-date artifact,
  recording the substitution). At M0, run `openscad --version` on the pinned binary — snapshot
  builds embed their exact source commit — and record that commit hash plus the SHA-256 of
  every platform artifact in `ENGINE_VERSION`.
  **Why this build (record this rationale in the file):** (1) the capabilities this spec
  requires — color-preserving render via the Manifold backend (upstream PR #5185), 3MF color
  export (PR #5527), the 3MF export options CLI/dialog (PR #5577) — exist **only** in the
  snapshot line; the last stable release (2021.01) has none of them, which is why no "stable
  by default" rule can exist in this spec. (2) `2026.06.12` is the first cross-platform
  snapshot after upstream PR #6857 (merged 2026-06-06) fixed multi-mesh 3MF color export
  against lib3mf 1.x (issue #6813: every object after the first took the first object's
  color) — earlier 2026 snapshots may carry that defect.
  The WASM artifact for the web target is **built from the recorded source commit** (the
  `openscad/openscad-wasm` build tooling — Emscripten 4.0.10, `-DEXPERIMENTAL=ON
  -DSNAPSHOT=ON` — is the reference path; note that officially published prebuilt WASM
  snapshots stalled in August 2025, so building from source is the reliable route). Building
  the engine/WASM from official source at the pinned commit is a permitted activity under
  §2.2 item 2; modifying engine source is not (§1.2). All golden-geometry hashes (V-3) pin to
  this build. Changing the pin is a spec-author-approved amendment, never a drive-by.
- **Escalation:** external blockers the implementer cannot clear (signing certificates, repo
  permissions, a broken upstream engine release) go in `spec/QUESTIONS.md` flagged `BLOCKER`,
  with everything not dependent on them continuing meanwhile.

---

## 3. Architecture requirements (behavioral)

- **A-1** The UI is a single web codebase. A thin platform layer (§4.13) isolates everything
  that differs between web and desktop: engine invocation, file system, dialogs, menus,
  persistence, MCP.
- **A-2** The OpenSCAD engine is always out-of-process:
  - Desktop: a subprocess speaking only via command-line arguments, files, stdin/stdout/stderr.
  - Web: a WASM instance inside a dedicated Web Worker, communicating only via structured
    messages and a virtual file system. The engine artifact is fetched as a separate file at
    runtime, never bundled into the application's own JS.
  - Rationale: OpenSCAD is GPL-2.0-or-later. The subprocess boundary on desktop is plain
    aggregation. The worker/message boundary on web is the strongest available isolation short
    of a server; the owner should confirm this boundary with counsel before any non-GPL license
    is applied to the web distribution. The application must remain fully functional as a pure
    editor (no preview) if the engine artifact is absent, which demonstrates separability.
- **A-3** All state mutations flow through a single command bus (§4.11) so that undo/redo,
  history, and external agent actions are uniform.
- **A-4** Long operations (render, export, format) are cancellable and never block the UI
  thread.
- **A-5** No telemetry. No network calls at all except: (a) user-configured AI providers,
  (b) fetching the engine WASM artifact on the web target, (c) an explicit user-triggered
  update check on desktop (off by default), (d) user-initiated library and engine-version
  downloads (§4.15).
- **A-6 Modularity caps (hard, CI-enforced).** No UI source file may exceed **400 physical
  lines** (generated code and test fixtures exempt). Application state lives in typed stores
  from day one — components subscribe to stores and dispatch commands; they do not own shared
  state. One store per domain (documents, render, parameters, files, settings, history, AI).
  This rule exists because the measured cost of a single-file UI (a 5,000-line root component
  in a prior product) was an entire release's worth of merge pain; the cap makes that class of
  decay impossible rather than discouraged.

---

## 4. Capabilities

Each capability lists functional requirements (FR) and acceptance criteria (AC). ACs are the
test list; every AC becomes at least one automated test unless marked *manual*.

### 4.0 C0 — Workspace layout and interaction model

The default desktop workspace (≥ 1200 px wide):

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Menu bar (native on desktop; in-window menu row on web)                    │
├────┬───────────────────────────────────┬───────────────────────────────────┤
│ A  │ Editor tabs: ▸ box.scad ● lid.scad│ Viewer toolbar: fit·views·⚙·📷    │
│ c  ├───────────────────────────────────┼───────────────────────────────────┤
│ t  │                                   │                                   │
│ i  │                                   │                                   │
│ v  │        CODE EDITOR                │        MODEL VIEWER               │
│ i  │        (C1)                       │        3D (C2) or 2D (C3)         │
│ t  │                                   │                                   │
│ y  │                                   │                                   │
│    │                                   ├───────────────────────────────────┤
│ r  │                                   │ ▾ PARAMETER PANEL (C5)            │
│ a  │                                   │   [Section: Dimensions]           │
│ i  │                                   │   width ─────●───── 40            │
│ l  │                                   │   style  [rounded ▼]  lid ☑       │
├────┴───────────────────────────────────┴───────────────────────────────────┤
│ ▾ CONSOLE / DIAGNOSTICS (C8) — collapsible, full width                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ Status: engine 2025.03 · ✓ rendered 1.2s · ⚠ 2 ✖ 0 · Ln 14, Col 8 · UTF-8  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**FR**

- FR-0.1 **Three-region core:** left dock, center editor group, right viewer column. All
  splitters are draggable; sizes persist per workspace. Any dock/panel is collapsible to
  nothing; the editor and viewer can each be maximized (toggle command).
- FR-0.2 **Activity rail** (far left, icon column) selects what the left dock shows, one at a
  time: **Files** (C6 tree), **Search** (FR-15.6), **History** (C11), **AI** (C10),
  **Libraries** (FR-15.5). Badge dots on icons signal activity (e.g., pending AI diff).
  Clicking the active icon collapses the dock.
- FR-0.3 **Viewer column** stacks the model viewer (top) and the parameter panel (bottom,
  collapsible, resizable). The 2D pane (C3) replaces the 3D canvas in the same slot.
- FR-0.4 **Console** spans the window bottom, collapsible to the status-bar chip (FR-8.5).
  It auto-opens on the first error of a render and never auto-opens otherwise.
- FR-0.5 **Status bar** (always visible): engine version + engine-path health, render state
  (idle/spinner/time), error-warning chips, cursor position, encoding, active theme toggle.
- FR-0.6 **Narrow layout** (< 900 px, and the default on mobile web): single column with a
  two-way view switcher `[ Code | Model ]` in a top bar; the activity-rail panels open as
  full-height overlays from the left; the parameter panel opens as a bottom sheet over the
  model view; console as a bottom sheet over either.
- FR-0.7 **Panel-layout persistence:** dock sizes, collapsed states, and the active
  rail selection persist per project (desktop) / per browser profile (web); "reset layout"
  command restores the default above.
- FR-0.8 Every panel is reachable by keyboard (Appendix D) and announces itself to screen
  readers as a labeled landmark region.

**AC**

- AC-0.a Fresh profile shows exactly the default layout above (snapshot of layout state, not
  pixels).
- AC-0.b Drag each splitter, restart, sizes retained (AC-9.a covers the persistence path).
- AC-0.c At 800 px width the narrow layout engages; the view switcher toggles code/model; no
  horizontal scroll of the window body.
- AC-0.d A render error auto-opens the console once; fixing and re-rendering does not
  auto-close or re-open it.

### 4.1 C1 — Code editor with OpenSCAD language support

**FR**

- FR-1.1 Multi-tab text editor. Tabs show file name, a dirty marker on unsaved changes, close
  buttons, and reorder by drag. Middle-click closes a tab.
- FR-1.2 OpenSCAD syntax highlighting: keywords (`module`, `function`, `if`, `else`, `for`,
  `let`, `each`, `include`, `use`, etc.), built-in modules/functions, numbers, strings,
  booleans, special variables (`$fn`, `$fa`, `$fs`, `$t`, `$vpr`, `$vpt`, `$vpd`, `$preview`),
  comments (line and block), modifier characters (`*`, `!`, `#`, `%`) when prefixed to a
  statement.
- FR-1.3 Autocomplete for all built-in modules, functions, and special variables per the public
  OpenSCAD language reference, with signature hints (parameter names and defaults) and a short
  description sourced from the public manual (paraphrased by the spec author or implementer,
  not copied verbatim from any editor).
- FR-1.4 Completion of user-defined modules, functions, and variables declared in the open file
  and in files pulled in via `include`/`use` within the project.
- FR-1.5 Bracket/paren matching and auto-closing; comment-toggle command; indent/outdent;
  multi-cursor; find/replace with regex; go-to-line.
- FR-1.6 Inline diagnostics: squiggles and gutter markers at lines the engine reports errors or
  warnings for (§4.8), with hover text showing the message.
- FR-1.7 Standard keybindings per the default table in **Appendix D** — all rebindable in
  settings.
- FR-1.8 Editor font, font size, tab width, word wrap, line numbers, and minimap toggle are
  settings.
- FR-1.9 A read-only **diff view** used by the AI panel (§4.10) and file-restore flows: shows
  side-by-side or inline diff of proposed vs current content with per-hunk accept/reject.

**AC**

- AC-1.a Opening a `.scad` file containing every construct in the OpenSCAD cheat sheet
  highlights each token class distinctly (snapshot test on highlight classification, not pixels).
- AC-1.b Typing `cub` offers `cube` with its signature; accepting inserts a correct call
  skeleton.
- AC-1.c A file with a syntax error shows a squiggle on the line the engine reports within one
  render cycle.
- AC-1.d Unsaved-changes marker appears on first edit and clears on save.
- AC-1.e All Appendix D keybindings fire their commands (integration test through the command
  bus).

### 4.2 C2 — 3D model viewer

**FR**

- FR-2.1 Displays the mesh produced by the engine (§4.5) with orbit (left-drag), pan
  (right-drag or Shift+drag), zoom (wheel/pinch); configurable mouse mapping.
- FR-2.2 Camera preserves position/target/zoom across re-renders of the same document.
- FR-2.3 View controls: reset view, axis-aligned views (top/bottom/front/back/left/right),
  perspective/orthographic toggle, zoom-to-fit.
- FR-2.4 Scene furniture, each independently toggleable: XY grid with adaptive spacing, RGB
  axis triad, edge overlay on the mesh, ground shadow (optional).
- FR-2.5 Renders meshes up to 2 M triangles at interactive frame rates (≥ 30 fps orbit in a
  disclosed hardware-accelerated run). The owner-designated benchmark baseline is AMD Radeon
  780M; this is an acceptance-evidence baseline, not a minimum supported-hardware claim. The
  viewer degrades gracefully (auto-disables edges/shadow) beyond that triangle count.
- FR-2.6 **Measurement tools:** point-to-point distance; edge length; face-to-face distance;
  bounding-box dimensions readout. Measurements render as labeled overlays, survive camera
  moves, clear on model change, and are individually deletable.
- FR-2.7 **Annotations:** user can pin a short text note to a point on the model; notes persist
  per file (in workspace state, not in the `.scad` source), are listed in a side panel, and are
  deletable.
- FR-2.8 Viewer background, mesh color, and edge color come from the active theme (§4.12);
  mesh color user-overridable.
- FR-2.9 A render-status indicator overlays the viewer while the engine runs: spinner, elapsed
  time, cancel button. On failure the last good mesh stays visible, dimmed, with an error badge
  linking to the console.
- FR-2.10 Screenshot command: captures the current viewport to PNG (file on desktop, download
  on web) and is available to the MCP surface (§4.11).

**AC**

- AC-2.a Render of a known cube: bounding-box readout equals 10×10×10 within float tolerance.
- AC-2.b Camera state (position/target) is bit-identical before and after a re-render triggered
  by an edit that does not change geometry.
- AC-2.c Distance measured between two opposite cube corners equals √300 within 0.1%.
- AC-2.d Cancel during a deliberately slow render (`$fn=400` minkowski) stops the engine
  process/worker within 2 s and the UI stays responsive throughout (*manual on CI-less GPUs,
  automated where headless GL is available*).
- AC-2.e Screenshot produces a decodable PNG whose dominant color matches the theme background.

### 4.3 C3 — 2D/SVG preview

**FR**

- FR-3.1 When the document's output is 2D (the engine emits 2D geometry), the preview pane
  shows an SVG rendering instead of the 3D viewer, with pan/zoom, fit-to-view, and a dimension
  readout of the drawing's bounding box.
- FR-3.2 Mode selection is automatic per render result; the user can also pin either mode.
- FR-3.3 SVG preview supports export to `.svg` and `.dxf` via the export flow (§4.6).
- FR-3.4 Zoom is cursor-centered; a scale indicator shows current mm-per-pixel.

**AC**

- AC-3.a A document whose root is `square(10);` renders in the 2D pane automatically; changing
  it to `cube(10);` switches back to 3D on the next render.
- AC-3.b Bounding-box readout for `square([30,20]);` reads 30 × 20 mm.

### 4.4 C4 — Engine invocation, dual path

**FR**

- FR-4.1 A single `EngineService` interface with two implementations (native subprocess, WASM
  worker). Callers cannot tell which is active. **The interface, request, and result types are
  normative and defined in Appendix A.**
- FR-4.2 Operations: `render`, `export`, `version`, `cancel` per Appendix A.
- FR-4.3 *(amended A-2)* Two quality levels: *preview* (fast feedback) and *full*
  (export-grade). **Both produce real geometry via the engine's render pipeline** — the
  engine's interactive OpenGL preview is neither used nor required (the CLI does not expose an
  orbitable preview mesh; the viewer always receives genuinely rendered geometry). *Preview*
  runs favor speed: the fastest available geometry backend, the FR-4.9 preview timeout, and a
  configurable capped facet-resolution override (default on) applied **only** to preview runs
  and disclosed in the viewer as "preview quality" per N-7. *Full* runs never apply overrides
  and are the only source of exports. The F5/F6 keybindings map to these two levels
  behaviorally; no claim is made that they reuse the stock GUI's preview mechanism. Parameter
  values (§4.5) are passed as `-D` definitions (native) or their WASM equivalent.
- FR-4.4 Renders are debounced on edit (default 800 ms after last keystroke, configurable;
  auto-render toggleable off). A new render request supersedes and cancels an in-flight one.
- FR-4.5 Multi-file projects: `include`/`use` resolve against the project directory. Native:
  engine runs with the project dir as CWD. Web: the worker's virtual FS is populated with all
  project files before each render.
- FR-4.6 Native path discovers the engine: bundled copy first, then user-configured path, then
  PATH. Missing engine → a clear banner with a fix-it link to settings, and editor-only mode.
- FR-4.7 Web path fetches the engine WASM artifact once, caches it (HTTP + IndexedDB), shows
  download progress, and works offline thereafter.
- FR-4.8 Stderr/console output from every run is captured verbatim and fed to diagnostics
  (§4.8). Exit code, wall time, and geometry stats (vertices, facets, volume if reported) are
  recorded per run.
- FR-4.9 Timeouts: preview 30 s, full render 10 min (both configurable). Timeout kills the
  process/worker and reports it as a diagnosed failure, never a hang.
- FR-4.10 Animation: if the source uses `$t`, an animation bar appears (play/pause, fps, frame
  scrubber); each frame is a preview render with `$t` set. (Deferred to M4 — see §8.)

**AC**

- AC-4.a *(amended A-1)* The same `.scad` source produces byte-identical output on native and
  web paths for a fixed engine build: **STL for 3D golden models, SVG for 2D ones** (golden-file
  test; Appendix F1/F2 → STL, F3 → SVG, plus three public OpenSCAD example files). If either
  format proves nondeterministic across paths, raise it in `spec/QUESTIONS.md` with the
  observed diff summary; any fallback to semantic geometry comparison requires an amendment.
- AC-4.b `-D` parameter overrides change the output mesh without editing source.
- AC-4.c Killing a hung render at timeout leaves no orphan process (native) / terminates the
  worker (web); next render succeeds.
- AC-4.d With no engine installed, the app opens, edits, and saves files; the banner appears;
  no crash.
- AC-4.e Two rapid edits produce exactly one completed render (supersession test).

### 4.5 C5 — Parameter panel (customizer)

Parameter extraction follows the **public OpenSCAD customizer specification** (the wiki's
"Customizer" page). That syntax is the engine's public contract, not another editor's design.

**FR**

- FR-5.1 Parse top-level assignments above the first module/function/geometry statement into
  parameters. Recognized annotations, per the public spec:
  - `/* [Section Name] */` groups following parameters; `/* [Hidden] */` hides them.
  - Trailing `// description` becomes the control's label/tooltip.
  - `// [min:max]` and `// [min:step:max]` → slider (numbers).
  - `// [a, b, c]` → dropdown; `// [value:Label, ...]` → labeled dropdown.
  - Booleans → checkbox; free numbers → numeric input with step; strings → text input;
    vectors → per-component numeric inputs.
- FR-5.2 The panel renders grouped, collapsible sections in source order; each control shows
  the description and resets individually; a "reset all" restores source defaults.
- FR-5.3 Changing a control triggers a debounced preview render with the override applied
  (FR-4.3); the source text is **not** rewritten. An explicit "write values into source" action
  updates the assignments in place, preserving comments and formatting.
- FR-5.4 **Parameter sets:** named sets of values, saved/loaded in the engine's own JSON
  parameter-set file format (public spec) so sets are interchangeable with the stock OpenSCAD
  GUI. Set picker + save/rename/delete in the panel.
- FR-5.5 Re-parse on every source change; controls preserve user-entered values for parameters
  whose names survive the edit.
- FR-5.6 Malformed annotations degrade gracefully to a plain input; never a parse crash.

**AC**

- AC-5.a A fixture file exercising every annotation form yields the exact expected control
  list, types, ranges, groups (unit test on the parser; Appendix F model 1 is the seed fixture).
- AC-5.b Slider drag re-renders with the new value; source text unchanged; "write into source"
  then updates exactly the one assignment line.
- AC-5.c A parameter-set JSON written by this app loads correctly in stock OpenSCAD (*manual,
  once per release*), and vice versa (automated fixture).
- AC-5.d Renaming a variable in source drops its old control and adds the new one on next parse.

### 4.6 C6 — Files, projects, import/export, sharing

**FR**

- FR-6.1 A file-tree panel rooted at an opened folder ("project"): expand/collapse, create,
  rename (inline edit), delete (to OS trash on desktop), reveal-in-OS, drag to move. `.scad`
  files open in tabs; other text files open read-write with plain highlighting; binary files
  show a placeholder.
- FR-6.2 Web target: projects live in an origin-private file system / IndexedDB workspace with
  the same tree UI; import/export of a project as a zip.
- FR-6.3 Single-file quick mode: the app opens with an untitled scratch document without
  requiring a project.
- FR-6.4 Export dialog: format picker (STL binary/ASCII, 3MF, OFF, AMF, SVG, DXF, PNG per
  engine support), destination, and for meshes a post-export summary (triangles, bounding box,
  file size). Export uses a *full* render. **3MF is the default mesh format** (it is the ISO
  standard and preserves units/color; STL remains one click away). *(A-7)* Color and
  multi-object fidelity in 3MF is real only on the pinned snapshot engine and under the
  engine-mode rules of FR-15.14/FR-15.15 — those FRs govern; this dialog just picks formats.
- FR-6.5 Recent files/projects list on the welcome screen (§4.14) and in the file menu.
- FR-6.6 External-change detection: if a file open in a tab changes on disk, offer
  reload/keep/diff (uses FR-1.9).
- FR-6.7 Autosave (optional, default on for the scratch document) and crash recovery: on
  restart after abnormal exit, offer to restore unsaved buffers.
- FR-6.8 **Sharing (web target):** "share link" encodes the current single-file source
  (compressed) into a URL fragment so nothing touches a server; opening such a link loads the
  source into a scratch tab with a banner naming the origin. Documents beyond a size cap
  (~50 KB compressed) report that a link is not possible.

**AC**

- AC-6.a Create → rename → move → delete a file via the tree, verifying disk state after each
  step.
- AC-6.b Export STL of a cube fixture: file starts with the STL binary header, triangle count
  is 12.
- AC-6.c Editing an open file externally raises the reload/keep/diff prompt.
- AC-6.d Kill the app with an unsaved buffer; relaunch offers recovery; recovered text matches.
- AC-6.e A share link round-trips: encode, open in a fresh session, byte-identical source.

### 4.7 C7 — Source formatter

**FR**

- FR-7.1 Format-document and format-selection commands producing the style defined by the
  golden fixtures in **Appendix E** (normative), summarized: configurable indent (default 4
  spaces), spaces around binary operators and `=`, space after commas, no space inside
  parens/brackets, attached braces, one statement per line, transform chains of ≥ 2 modifiers
  broken one-per-line with single-level hanging indent, at most one consecutive blank line.
- FR-7.2 Idempotent: formatting formatted code is a no-op.
- FR-7.3 Semantics-preserving: the formatter operates on a parse of the source; if the file
  does not parse, formatting is refused with a message (never a mangled file).
- FR-7.4 Customizer annotations (§4.5) and their positions are preserved exactly (a formatter
  that detaches a `// [min:max]` comment from its assignment breaks the parameter panel).
- FR-7.5 Format-on-save toggle in settings, off by default.

**AC**

- AC-7.a The 15 golden fixture pairs in Appendix E format exactly to their expected outputs.
- AC-7.b `format(format(x)) == format(x)` over the fixture corpus and a fuzzed mutation set.
- AC-7.c Engine renders of pre- and post-format sources produce identical geometry (STL hash)
  for all fixtures that render.
- AC-7.d A file with a syntax error is left untouched and a diagnostic explains why.

### 4.8 C8 — Diagnostics and console

**FR**

- FR-8.1 A console panel streams raw engine output per run (stdout/stderr interleaved,
  timestamped), with run separators showing quality level, duration, and exit status.
- FR-8.2 Engine messages are parsed into structured diagnostics: severity (error/warning/echo/
  trace), message, and source location when the engine reports file:line. Structured items
  render as a clickable list; clicking jumps the editor to the location (opening the file if
  needed). Implementers characterize the engine's message shapes empirically by running the
  pinned engine version (permitted input, §2.2) and encode them as fixtures.
- FR-8.3 `echo()` output is visually distinct from errors/warnings.
- FR-8.4 Console supports filter-by-severity, text search, copy-all, and clear; scrollback
  capped (10k lines) with oldest-dropped indication.
- FR-8.5 A status-bar chip shows current error/warning counts; clicking focuses the console.
- FR-8.6 Diagnostics feed the editor squiggles (FR-1.6) and the MCP surface (§4.11).

**AC**

- AC-8.a A fixture with one error and two warnings yields exactly those structured diagnostics
  with correct severities and line numbers.
- AC-8.b Clicking a diagnostic moves the editor cursor to its line.
- AC-8.c `echo("hi", 42);` appears in the console styled as echo, not as a warning.
- AC-8.d Parser tolerates unknown/garbled engine lines: they appear raw, nothing crashes
  (fuzz test over random stderr).

### 4.9 C9 — Settings

**FR**

- FR-9.1 A settings dialog with searchable sections: Editor (FR-1.8), Rendering (debounce,
  auto-render, timeouts, quality defaults), Engine (path/artifact, version display, version
  manager FR-15.11), Viewer (mouse mapping, furniture defaults), Formatter (§4.7), Theme
  (§4.12), AI (§4.10), Keybindings (Appendix D), Privacy (update-check toggle).
- FR-9.2 Settings persist per user (desktop: config file in the platform config dir; web:
  local storage), apply immediately, and carry a "restore defaults" per section.
- FR-9.3 Settings are export/importable as one JSON file.
- FR-9.4 Secrets (AI keys) are stored in the OS keychain on desktop; on web, session-only by
  default with an explicit opt-in to persisted local storage accompanied by a plain warning.

**AC**

- AC-9.a Every setting round-trips: change → restart → value retained.
- AC-9.b Import of an exported settings file reproduces all values on a fresh profile.
- AC-9.c AI key set on desktop is absent from every file the app writes (scan test), present
  in the keychain.

### 4.10 C10 — AI assist panel (optional feature)

**FR**

- FR-10.1 A dockable chat panel, disabled until a provider is configured. Provider support via
  **direct HTTP** to OpenAI-compatible, Anthropic, and local (Ollama-style) endpoints —
  implemented against the providers' public HTTP APIs with the project's own thin client (no
  provider SDK dependency; see §6 licensing rationale).
- FR-10.2 Model picker listing user-configured providers/models; per-conversation system
  prompt is fixed by the app and instructs the model to produce OpenSCAD.
- FR-10.3 Context sent with a message (each user-toggleable per send): current file source,
  current diagnostics, parameter list, and optionally a viewer screenshot (FR-2.10) for
  vision-capable models.
- FR-10.4 Assistant replies render as markdown; code blocks carry actions: **apply as edit**
  (opens the diff view FR-1.9 with accept/reject per hunk), copy, insert-at-cursor.
- FR-10.5 An "agent mode" loop (explicitly opt-in per conversation): the assistant may request
  tool calls — read source, propose edit, trigger render, read diagnostics, take screenshot —
  the same verbs as the MCP surface (§4.11); every mutation still lands as a reviewable diff
  unless the user enables auto-apply for the session. A hard cap (configurable, default 10)
  bounds tool-call rounds per user message.
- FR-10.6 Conversations persist per project; deletable; never transmitted anywhere except the
  configured provider.
- FR-10.7 Streaming responses with cancel; provider errors surface readably (status, message)
  without leaking the key.

**AC**

- AC-10.a With no provider configured the panel shows setup guidance; zero network calls occur
  (network-mock assertion).
- AC-10.b Against a mocked provider: a reply containing a code block yields a working
  apply-as-edit diff; accepting updates the buffer exactly.
- AC-10.c Agent mode against a scripted mock: model requests render → receives diagnostics →
  proposes a fix → diff appears; round cap halts a deliberately looping mock at the cap.
- AC-10.d Key never appears in logs, console, or persisted files (scan test).

### 4.11 C11 — Command/history layer and MCP tool surface (desktop)

**FR**

- FR-11.1 Every state mutation (edits, file ops, parameter changes, setting changes, AI
  applies) is a **command** dispatched on one bus, recorded in a session history with
  timestamp, origin (user | AI panel | external agent), and inverse where applicable.
- FR-11.2 Undo/redo operates on this history; editor-local undo integrates so one Ctrl+Z path
  behaves as the user expects.
- FR-11.3 A history panel lists the session's commands with origin badges; selecting an entry
  shows its detail (e.g., the diff of an applied edit).
- FR-11.4 The desktop app can run an **MCP server** (stdio transport, per the public Model
  Context Protocol spec; off by default, toggled in settings) exposing the ten tools whose
  **normative schemas are in Appendix B**: `list_files`, `read_file`, `write_file`,
  `render_preview`, `export_model`, `get_diagnostics`, `get_parameters`, `set_parameters`,
  `take_screenshot`, `get_history`. Mutating tools land as reviewable commands honoring the
  same diff-review gate as FR-10.5. Tool docs are authored fresh against the MCP spec.
- FR-11.5 External-agent commands are visibly badged in the history panel and status bar while
  an MCP client is connected.
- FR-11.6 A per-tool permission gate (allow once / allow for session / deny) guards mutating
  tools; read-only tools may be always-allowed via settings.

**AC**

- AC-11.a Every mutating UI action produces exactly one history entry; undo reverses it;
  redo reapplies it (property test across a scripted action sequence).
- AC-11.b An MCP client (test harness) lists tools, renders a preview, reads diagnostics, and
  writes a file that appears as a pending diff for review — request/response payloads validate
  against the Appendix B schemas.
- AC-11.c With the MCP toggle off, no server socket/pipe exists (process inspection test).
- AC-11.d Deny on the permission gate blocks the mutation and returns a structured MCP error.

### 4.12 C12 — Theming

**FR**

- FR-12.1 Ships with at least: Light, Dark, and High-contrast themes; follows the OS
  light/dark preference by default with manual override.
- FR-12.2 A theme defines every color used anywhere — UI chrome, editor syntax palette, viewer
  background/mesh/edges/grid, console severity colors — as one token set; no hardcoded colors
  in components (CI grep gate). **The token schema is normative and defined in Appendix C.**
- FR-12.3 Editor syntax palette and viewer colors switch with the theme without reload.
- FR-12.4 User-defined themes: a JSON token file per Appendix C, loadable from settings.
- FR-12.5 All themes meet WCAG AA contrast for text and UI controls (automated contrast check
  over the token sets).

**AC**

- AC-12.a Token-completeness test: every theme defines the full Appendix C schema.
- AC-12.b Zero hardcoded color literals in component source (lint rule in CI).
- AC-12.c Contrast check passes AA for all shipped themes.
- AC-12.d Switching theme mid-session restyles editor, viewer, and console with no reload.

### 4.13 C13 — Platform abstraction and desktop shell

**FR**

- FR-13.1 One typed interface covers: engine invocation, file system, dialogs (open/save/
  message), menus, clipboard, persistence, keychain, MCP availability, window controls. Web
  and desktop each implement it; UI code imports only the interface.
- FR-13.2 Desktop shell provides: native menu bar (File/Edit/View/Render/Help mirroring the
  command bus), file associations for `.scad`, single-instance behavior with
  open-file-in-existing-window, and OS-standard window state persistence.
- FR-13.3 Web target degrades declared-capability-wise: features unavailable on web (MCP
  server, OS trash, file associations, slicer handoff, engine version manager) are absent from
  the UI, not broken.
- FR-13.4 Installers: Windows signed setup executable, macOS notarized dmg, Linux AppImage —
  produced by CI (signing external dependencies may lag; unsigned artifacts still build).

**AC**

- AC-13.a UI package has zero direct imports of shell/browser-specific APIs (dependency-graph
  lint).
- AC-13.b Double-clicking a `.scad` file opens it in the running instance (*manual per
  release*).
- AC-13.c Web build serves from a static host with all features except the declared desktop-
  only list.

### 4.14 C14 — First-run and welcome surface

**FR**

- FR-14.1 A welcome screen on launch (suppressible): new file, open project, recent list (with
  thumbnails, FR-15.13), and the three built-in sample models of **Appendix F** demonstrating
  the parameter panel.
- FR-14.2 First render of a sample must succeed with zero configuration on a machine with the
  bundled engine (desktop) or after the WASM download (web).

**AC**

- AC-14.a Fresh-profile launch → click sample → model renders, parameter panel populated
  (end-to-end test).

### 4.15 C15 — Beyond parity (what current tools don't have)

These are deliberate improvements over every existing OpenSCAD editor the spec author has
used. Each FR carries its milestone tag (§8); nothing here may delay the parity milestones
M0–M3.

**FR**

- FR-15.1 **(M4) Render cache.** Every render result is cached keyed on
  hash(entry source + resolved include/use contents + parameter values + quality + engine
  version). A cache hit displays instantly with a subtle "cached" note in the status bar and
  no engine run. Switching tabs between rendered documents is instant. Cache is
  memory-bounded (default 512 MB, LRU) with a per-project disk tier on desktop (opt-in).
- FR-15.2 **(M4) Geometry delta readout.** After each successful render, the status area shows
  the change vs the previous render of the same document: Δvolume, Δbounding-box, Δtriangle
  count. "Geometry unchanged" is stated explicitly when hashes match — the user learns
  instantly whether an edit was cosmetic or real.
- FR-15.3 **(M5) Model history timeline.** Every successful render auto-snapshots (source +
  parameter values + a small thumbnail). A timeline strip lets the user scrub back, view any
  snapshot's thumbnail and source diff, and restore it (as a command, undoable). Session-scoped
  by default; per-project persistence opt-in with a size cap.
- FR-15.4 **(M5) Batch export.** From the export dialog: select any subset of saved parameter
  sets (FR-5.4) and export one file per set in one action, file names templated
  (`{model}-{set}.{ext}`), with a progress list and per-item success/failure. Runs sequential
  full renders; cancellable between items.
- FR-15.5 **(M5) Library manager.** A Libraries panel that installs well-known OpenSCAD
  libraries (at minimum BOSL2, MCAD, dotSCAD; list extensible by URL) **per project**: pinned
  release version, vendored copy inside the project (so projects are self-contained and
  reproducible), the library's license displayed at install time, and the include path wired
  automatically on both engine paths. Update = explicit re-pin, never silent.
- FR-15.6 **(M5) Project navigation.** Project-wide text search with replace (respecting
  ignore patterns); a symbol outline of the current file (modules, functions, top-level
  variables); go-to-definition and find-references for user symbols across `include`/`use`
  boundaries within the project.
- FR-15.7 **(M5) Split editor.** Two editor groups side by side (or stacked), each with its
  own tabs; drag a tab between groups; the render target follows the focused group.
- FR-15.8 **(M5) Section view and camera bookmarks.** A clipping plane (axis-aligned, draggable
  along its normal, toggleable) that cuts the rendered mesh visually to inspect interiors; and
  named camera bookmarks (save/recall/delete) per project.
- FR-15.9 **(M6) Printability report.** An on-demand check of the last full render:
  watertight/manifold status, bounding box vs a user-configured build volume, and a
  minimum-feature heuristic (thinnest detected wall vs a configurable nozzle width).
  **Honesty rule (normative):** every line of the report states what was actually computed and
  what was not checked (e.g., "Manifold: PASS (mesh topology check) · Overhangs: NOT CHECKED").
  The report never displays an aggregate "print-ready ✓" badge — a lesson from a prior
  product's audit where a mock-verified claim looked identical to a proven one.
- FR-15.10 **(M6) Slicer handoff** *(amended A-7)*. "Open in slicer": export 3MF to a temp
  path and launch a detected installed slicer (PrusaSlicer, OrcaSlicer, Cura, Bambu Studio) or
  a user-configured executable. Detection is passive (well-known install paths); nothing is
  bundled. Desktop only. When the exported model is multi-object (FR-15.15), the handoff
  toast/dialog carries the honesty copy from FR-15.15 ("assign filaments per object in your
  slicer").
- FR-15.11 **(M6) Engine version manager.** Settings-level management of multiple OpenSCAD
  versions: list installed, download an official release build (user-initiated, checksum
  displayed), and **pin an engine version per project** (recorded in the project file) so a
  project renders identically years later. The status bar shows the active version; a mismatch
  between pin and available versions yields a fix-it banner.
- FR-15.12 **(M6) Headless CLI.** The desktop artifact is also invocable as
  `scadmill render|export|params|check <file>` for CI and automation: render/export with
  parameter-set selection, print the extracted parameter schema as JSON, run the printability
  check — machine-readable output, exit codes reflect success. No window is opened.
- FR-15.13 **(M4) Thumbnails.** The last successful render of each document is captured as a
  small thumbnail shown in the welcome screen's recent list, the file tree (hover), and the
  history timeline. Thumbnails live in workspace state, never inside the project's source
  files unless the user exports them.
- FR-15.14 **(M6) Color and multi-part preview** *(amended A-7)*. When the source uses
  `color()`, the viewer shows those colors (via the engine's color-preserving output path,
  e.g. colored 3MF/OFF; on the pinned engine this requires the Manifold backend and, for
  multiple objects, the lazy-union option); a parts list panel enumerates top-level parts
  with per-part visibility toggles when the engine output distinguishes them.
  **Engine-mode requirements (normative):** color export uses the engine's "Color" encoding,
  **never** "Base Material" (upstream bug #6060: under lazy-union, Base Material assigns every
  object the first object's color; open as of 2026-07-10). Upstream has warned lazy-union "is
  not expected to survive in its current form" — therefore every engine flag involved in the
  color/multi-object path is set in exactly one place (the `EngineService` adapter, Appendix
  A), so an upstream rename is a one-file change.
- FR-15.15 **(M6) Multi-object colored 3MF export** *(new, A-7)*. Exporting a model whose
  source contains multiple top-level `color()`-tagged solids produces a single 3MF in which
  **each solid is a separate object with its own correct color** (standard 3MF
  Materials-extension `<m:colorgroup>` containing distinct `<m:color color="#RRGGBBAA">`
  entries referenced by each object's effective material/property indices). The export must
  not contain a `<basematerials>` group.
  **Slicer honesty rule (normative):** mainstream slicers (PrusaSlicer, OrcaSlicer, Bambu
  Studio) do **not** read standard 3MF color metadata for filament assignment — they use their
  own proprietary extensions (confirmed by the OpenSCAD maintainers, upstream issue #5849).
  What this export guarantees is that the slicer receives *separate, correctly-colored,
  correctly-positioned objects* the user assigns filaments to in the slicer. Every UI surface
  that touches this feature says so plainly (e.g. "Exports each color as a separate object —
  assign filaments per object in your slicer"). The product never claims automatic filament
  mapping, automatic AMS/multi-tool setup, or "multi-color print-ready" output.
- FR-15.16 **(M6) Design-time manufacturing estimates** *(new, A-8)*. On explicit user request
  (a panel or status-bar affordance — never automatically on every render), the app slices the
  last full render with the embedded Kiri:Moto engine (§6) against a user-selected generic
  machine profile and reports estimated print time and estimated filament use.
  **Honesty rules (normative, same family as FR-15.9/15.15):** every figure is labeled as an
  estimate from an embedded community slicer against a generic profile; the copy never implies
  a match to the user's real slicer settings or printer tuning; no aggregate "print-ready"
  badge; the panel names the engine and profile used. The estimate runs fully offline. FR-15.10
  (handoff to the user's real slicer) remains the manufacturing path — this feature is
  in-editor feedback only.
- FR-15.17 **(M5) Library-aware editor intelligence** *(new, A-8)*. Completions and signature
  help for the modules and functions of libraries installed via FR-15.5 (BOSL2 first),
  extending the existing cross-file navigation (FR-15.6/AC-15.f). Parsing the installed
  library's files for module/function signatures is sufficient; no semantic engine required.

**AC**

- AC-15.a Second render of unchanged source+params performs zero engine invocations
  (spy on EngineService) and paints in < 100 ms.
- AC-15.b A cosmetic edit (comment change) reports "geometry unchanged"; a real edit reports
  a non-zero Δvolume for a fixture designed to change volume.
- AC-15.c Timeline: after 5 renders, 5 snapshots exist; restoring #2 sets editor content to
  that source as an undoable command.
- AC-15.d Batch export of 3 parameter sets yields 3 files with templated names; killing item 2
  leaves item 1's file intact and marks 2/3 accordingly.
- AC-15.e Installing a pinned BOSL2 into a fixture project makes `include <BOSL2/std.scad>`
  render on both engine paths; the vendored copy carries its license file.
- AC-15.f Go-to-definition on a module used in `a.scad` but defined in `b.scad` (via `use`)
  opens `b.scad` at the definition.
- AC-15.g The printability report for a deliberately non-manifold fixture says FAIL on
  manifold and NOT CHECKED for every heuristic not run (string-exact assertions).
- AC-15.h `scadmill export --set thick fixture.scad -o out/` exits 0 and writes the expected
  3MF in CI (no display server).
- AC-15.i A `color("red")` cube renders red in the viewer (pixel-sample or material
  assertion).
- AC-15.j Per-project engine pin: fixture pinned to version X renders with X even when Y is
  the default engine (version() spy).
- AC-15.k *(A-7)* A fixture with two top-level solids, `color("red")` and `color("blue")`,
  exports a 3MF whose XML (unzip `3D/3dmodel.model`) contains **two** `<object>` meshes and
  one `<m:colorgroup>` with distinct red and blue `<m:color color="#RRGGBBAA">` entries;
  each object's triangle/effective-material references resolve to the correct color entry,
  and no `<basematerials>` group exists — machine-parsed assertion, no slicer required.
- AC-15.l *(A-7)* The same exported 3MF re-imported through the engine (or a 3MF library)
  reads back two meshes whose vertex counts match the originals — round-trip integrity, no
  object silently merged or dropped.
- AC-15.m *(A-7)* Every UI string attached to multi-object export matches the FR-15.15
  honesty rule (snapshot test on the strings; the phrase "assign filaments" present, the
  words "print-ready" absent).
- AC-15.n *(A-8)* The estimates panel for a fixture model shows a time figure, a filament
  figure, and the mandated labeling copy (string snapshot: "estimate" present, engine and
  profile named, "print-ready" absent); the run completes with network access disabled.
- AC-15.o *(A-8)* With BOSL2 installed via the library manager, typing a known BOSL2 module
  name offers a completion carrying its parameter list; with the library removed, it does not.

---

## 5. Non-functional requirements

- **N-1 Performance:** cold start to interactive editor < 3 s desktop / < 5 s web (excluding
  first WASM download); keystroke-to-highlight < 16 ms; preview render round-trip overhead
  (app-added, beyond engine time) < 150 ms; cached-render display < 100 ms (FR-15.1).
- **N-2 Reliability:** engine crash never crashes the app; the app runs 1 h of continuous
  edit/render cycling without memory growth beyond 1.5× baseline (soak test).
- **N-3 Accessibility:** full keyboard operability of every panel; ARIA roles on all controls;
  the high-contrast theme; honors reduced-motion.
- **N-4 Internationalization readiness:** all user-visible strings in one message catalog;
  English ships; no layout that breaks at +40% string length.
- **N-5 Security:** no eval of model-generated code outside the engine sandbox (the engine
  process/worker *is* the only interpreter of OpenSCAD source); MCP mutations gated (FR-11.6);
  AI keys per FR-9.4.
- **N-6 Privacy:** §A-5. A `PRIVACY.md` states the complete network behavior.
- **N-7 UI honesty (normative, product-wide):** the UI never displays a claim stronger than
  what was computed. Anything simulated, mocked, cached, or heuristic is labeled as such at
  the point of display (FR-15.1's "cached" note, FR-15.9's per-line method statements, and any
  future feature). A claim rendered identically for a verified and an unverified state is a
  release-blocking defect.

---

## 6. Dependency policy and approved list

**Policy:** every dependency (including transitive) must carry a permissive license
(MIT/BSD/Apache-2.0/ISC/PSF/Zlib/MPL-2.0-file-level). No GPL/LGPL/AGPL/SSPL/BUSL code may be
linked into the application bundle. The OpenSCAD engine is the sole copyleft component and
stays out-of-process per A-2. CI runs a license scan on every PR; an unknown or copyleft
license fails the build. (This policy exists because a prior product shipped three
Apache-2.0 packages inside a GPL-2.0-only bundle — the scan makes that class of error
impossible here, in either direction.)

**Approved (implementers may add within policy; ledger records each addition):**

| Purpose | Dependency | License |
|---|---|---|
| UI framework | React (or Svelte/SolidJS at implementers' choice, fixed at M0) | MIT |
| Editor component | CodeMirror 6 | MIT |
| 3D rendering | three.js | MIT |
| State management | zustand or equivalent | MIT |
| Desktop shell | Tauri | MIT/Apache-2.0 |
| Build tooling | Vite, TypeScript, Vitest, Playwright | MIT/Apache-2.0 |
| MCP server | @modelcontextprotocol/sdk | MIT |
| Markdown render (AI panel) | marked or micromark + sanitizer | MIT |
| Zip (web project export, library vendoring) | fflate | MIT |
| OpenSCAD structural parsing *(A-8)* | `@openscad/tree-sitter-openscad` (the OpenSCAD organization's official grammar; npm 0.6.1) + `web-tree-sitter` | MIT |
| Language server *(A-8, optional)* | Leathong/openscad-LSP — completion, hover, go-to-definition, symbols, rename | Apache-2.0 (see caution below) |
| Embedded slicing engine *(A-8, for FR-15.16 only)* | Kiri:Moto engine (GridSpace `grid-apps`) | MIT |
| Constrained AI decoding *(A-8, optional, FR-14.x lane)* | llguidance | MIT |
| Engine (out-of-process only) | OpenSCAD binary / WASM build | GPL-2.0-or-later (aggregated, never linked) |

**Notes:** The OpenSCAD **language grammar for CodeMirror must be written fresh** for this
project (a Lezer grammar authored from the public language reference) — do not import a grammar
from any editor project whose license or provenance is unknown. *(Amended A-8:)* the OpenSCAD
organization's own tree-sitter grammar is MIT-licensed and full-coverage — implementers **may
read and translate it** as a licensed reference for the fresh CodeMirror grammar (record the
attribution in the ledger), and **may use it directly** (via `web-tree-sitter`) for structural
features — formatting, customizer-parameter extraction, symbol indexing, go-to-definition.
Provenance note to record once at adoption: the npm package is published by a verified
organization collaborator, not the org account itself — verify the repository field once, then
pin an exact version. A predecessor npm package with the *unscoped* name `tree-sitter-openscad`
is superseded — use only the `@openscad/`-scoped package.
*(A-8)* **openscad-LSP license caution:** its Cargo.toml claims "MIT OR Apache-2.0" but only
the Apache license file actually exists in the repository — treat it as Apache-2.0, which is
fully acceptable here. **Its VS Code companion extension is GPL-3.0: never open or read it.**
**One-formatter-authority rule (normative):** the product has exactly one formatter. If the
LSP is adopted, either its formatting capability is disabled in favor of this spec's formatter
FRs (Appendix E fixtures govern), or its formatter becomes the implementation behind those FRs
and must pass the Appendix E golden fixtures unchanged. Never two formatters.
*(A-8)* **Scan-confirmed gaps (do not search — build):** no CodeMirror-6 OpenSCAD language
mode, no permissively-licensed TextMate/highlighting grammar, and no OpenSCAD error-diagnostics
mapping library exist anywhere; the only published OpenSCAD linter is GPL-licensed (its
documented *rule list* may be transcribed as behavior requirements; its code may not be read).
AI providers are reached with the platform's native `fetch`; **no provider SDK packages**.
Libraries installed via FR-15.5 are *user content in user projects*, not application
dependencies — their licenses are displayed, not restricted.

---

## 7. Build and verification plan

- **V-1 Method:** test-first per capability. The AC lists above are the seed test lists; each
  AC maps to at least one automated test before its feature merges. Every test is observed
  failing before the implementation makes it pass.
- **V-2 CI (every PR):** typecheck · lint (including the theming color-literal rule AC-12.b,
  the platform-import rule AC-13.a, and the A-6 file-length cap) · unit + integration tests ·
  license scan (§6) · provenance-ledger check (§2.4) · similarity gate (§2.5, nightly +
  release).
- **V-3 Golden-geometry suite:** the Appendix F models plus public OpenSCAD example files,
  with pinned engine version and expected STL hashes; runs on both engine paths (AC-4.a).
- **V-4 End-to-end:** Playwright flows for: welcome → sample → render; edit → error →
  diagnostic click; customizer slider → re-render; export; AI mock apply-diff; MCP harness
  session; batch export; headless CLI smoke. Run on Windows + Linux in CI, macOS at release.
- **V-5 Release gate:** all CI green · similarity gate pass · soak test (N-2) · manual ACs
  executed and logged · fresh-VM install test of each installer · signed/notarized artifacts
  where signing is available · a rollback plan naming the previous release.
- **V-6 Honesty rule:** no capability is claimed "done" without its ACs demonstrably passing
  in CI; partial features ship behind a flag or not at all. N-7 applies to the product's own
  UI claims.

---

## 8. Milestones

| M | Scope | Exit criteria |
|---|---|---|
| M0 | Repo, provenance rig (§2.4–2.5 in CI), platform choice, walking skeleton: editor pane + native engine render of a cube to the 3D viewer | AC-2.a; ledger + similarity + A-6 gates live |
| M1 | C0 layout · C1 editor (minus diff view) · C4 native path complete · C8 diagnostics · C12 theming core | Their ACs |
| M2 | C5 customizer · C6 files/projects/export · C2 viewer complete (measurements, screenshots) · C3 SVG pane · C9 settings | Their ACs |
| M3 | C4 web/WASM path · C13 web target + installers · C7 formatter · C14 welcome | AC-4.a both paths |
| M4 | C10 AI panel · C11 command bus/MCP · FR-4.10 animation · FR-15.1 render cache · FR-15.2 geometry delta · FR-15.13 thumbnails · N-2 soak · **first public release** through V-5 | Full gate |
| M5 | FR-15.3 history timeline · FR-15.4 batch export · FR-15.5 library manager · FR-15.6 navigation · FR-15.7 split editor · FR-15.8 section view/bookmarks · FR-15.17 library-aware completions *(A-8)* | Their ACs + V-5 |
| M6 | FR-15.9 printability report · FR-15.10 slicer handoff · FR-15.11 engine version manager · FR-15.12 headless CLI · FR-15.14 color preview · FR-15.15 multi-object colored 3MF *(A-7)* · FR-15.16 design-time estimates *(A-8)* | Their ACs + V-5 |

Sequencing rationale: the engine boundary and provenance rig come first because everything
else depends on them; the AI/MCP layer composes verbs the earlier milestones define; the
beyond-parity items that shape architecture (render cache, thumbnails, geometry delta) land
with the first release, while the rest follow in two post-1.0 waves.

**Commitment scope** *(amended A-6, owner decision 2026-07-09)*: the engagement is the
**complete product, M0 through M6**. Every capability in this document — C0–C15 in full — is
in scope from day one; architect for all of it and deliver it milestone by milestone through
each milestone's exit gate. The owner retains the normal right to stop, reprioritize, or
re-scope at any milestone boundary; that possibility reduces nothing about present scope.

---

## 9. Open questions for the owner

1. **Final license** of the new codebase (MIT vs Apache-2.0 vs proprietary vs dual) — affects
   nothing in the build, everything in the business model. Decide by M3.
2. **Web-path counsel check** (A-2): confirm the worker/message boundary supports a non-GPL
   app license for the web distribution, or accept GPL for the web target only.
3. ~~Name~~ **RESOLVED 2026-07-09: ScadMill.** Repo home still open (new `scadmill` org vs
   scottconverse) — register the org and scadmill.com promptly; availability was verified, not
   reserved.
4. Whether TinkerQuarry's *engine-side* components (KimCad pipeline, evidence panels — code
   that is already original per the derivation measurement) should be consumed by this project
   later, and under what internal license.

---

# Appendix A — `EngineService` interface (normative)

TypeScript. Implementers may extend, never narrow. All byte payloads are `Uint8Array`.

```ts
type Quality = "preview" | "full";
type MeshFormat = "stl-binary" | "stl-ascii" | "3mf" | "off" | "amf";
type FlatFormat = "svg" | "dxf";
type ImageFormat = "png";
type ExportFormat = MeshFormat | FlatFormat | ImageFormat;

/** A parameter override, matching customizer value types. */
type ParamValue = number | boolean | string | number[];

interface RenderRequest {
  /** Project-relative path of the entry document. */
  entryFile: string;
  /** Full project file map (path → content). Text sources as UTF-8 strings; binary assets
   *  (import()-ed STL/DXF/PNG, fonts) as bytes (amended A-3). Native impl may pass through
   *  to disk; web impl populates the worker FS from this map. */
  files: ReadonlyMap<string, string | Uint8Array>;
  /** Customizer overrides applied via -D / equivalent. Empty = source defaults. */
  parameters: Readonly<Record<string, ParamValue>>;
  quality: Quality;
  /** Milliseconds; service enforces (FR-4.9). */
  timeoutMs: number;
}

interface Diagnostic {
  severity: "error" | "warning" | "echo" | "trace" | "info";
  message: string;          // engine text, verbatim, minus the severity prefix
  file?: string;            // project-relative, when the engine reported one
  line?: number;            // 1-based
}

interface RenderStats {
  vertices?: number;
  triangles?: number;
  boundingBox?: { min: [number, number, number]; max: [number, number, number] };
  volumeMm3?: number;       // when the engine reports it
  engineTimeMs: number;     // wall time of the engine run itself
}

interface RenderSuccess3D {
  kind: "3d";
  mesh: { format: MeshFormat; bytes: Uint8Array };
  stats: RenderStats;
  diagnostics: Diagnostic[];
  rawLog: string;           // complete interleaved engine output
}

interface RenderSuccess2D {
  kind: "2d";
  svg: string;
  boundingBox: { min: [number, number]; max: [number, number] };
  diagnostics: Diagnostic[];
  rawLog: string;
}

interface RenderFailure {
  kind: "failure";
  reason: "engine-error" | "timeout" | "cancelled" | "engine-missing";
  exitCode?: number;
  diagnostics: Diagnostic[];
  rawLog: string;
}

type RenderResult = RenderSuccess3D | RenderSuccess2D | RenderFailure;

interface ExportRequest extends Omit<RenderRequest, "quality"> {
  format: ExportFormat;     // export always runs at "full" quality
  /** PNG only: viewport size and camera; ignored otherwise. */
  image?: { width: number; height: number; camera?: CameraPose };
}

interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

interface ExportResult {
  ok: boolean;
  bytes?: Uint8Array;       // present when ok
  fileExtension?: string;
  diagnostics: Diagnostic[];
  rawLog: string;
}

interface EngineInfo {
  version: string;          // e.g. "2025.03.15"
  path: "native" | "wasm";
  features: string[];       // engine-reported feature flags, verbatim
}

interface RenderJob<T> {
  jobId: string;
  done: Promise<T>;         // resolves with result OR a RenderFailure; never rejects
}

interface EngineService {
  render(req: RenderRequest): RenderJob<RenderResult>;
  export(req: ExportRequest): RenderJob<ExportResult>;
  version(): Promise<EngineInfo | null>;   // null = engine unavailable (FR-4.6/4.7)
  cancel(jobId: string): void;             // idempotent; unknown ids are no-ops
}
```

Contract notes: `done` never rejects — every failure is a `RenderFailure`/`ok:false` value, so
callers have exactly one error path. A superseding render (FR-4.4) causes the prior job to
resolve with `reason: "cancelled"`. The 2D/3D discriminator is decided by the engine output,
not by source inspection (FR-3.1).

---

# Appendix B — MCP tool schemas (normative)

Stdio transport per the public MCP spec. All paths are project-relative. Mutating tools
(`write_file`, `set_parameters`) return a `pending_review` status when the diff-review gate
(FR-11.6) is active; the mutation applies only after in-app approval.

```jsonc
[
  {
    "name": "list_files",
    "description": "List all files in the open project.",
    "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
    "output": { "files": [{ "path": "string", "sizeBytes": "number", "kind": "scad|text|binary" }] }
  },
  {
    "name": "read_file",
    "description": "Read a project file's current buffer content (unsaved edits included).",
    "inputSchema": { "type": "object", "required": ["path"],
      "properties": { "path": { "type": "string" } } },
    "output": { "path": "string", "content": "string", "dirty": "boolean" }
  },
  {
    "name": "write_file",
    "description": "Propose full new content for a file. Subject to in-app diff review.",
    "inputSchema": { "type": "object", "required": ["path", "content"],
      "properties": { "path": { "type": "string" }, "content": { "type": "string" },
                      "createIfMissing": { "type": "boolean", "default": false } } },
    "output": { "status": "applied|pending_review|denied", "commandId": "string" }
  },
  {
    "name": "render_preview",
    "description": "Render a file at preview quality; returns stats and diagnostics, not mesh bytes.",
    "inputSchema": { "type": "object", "required": ["path"],
      "properties": { "path": { "type": "string" },
                      "parameters": { "type": "object", "additionalProperties": true } } },
    "output": { "kind": "3d|2d|failure", "stats": "RenderStats|null",
                "diagnostics": [{ "severity": "string", "message": "string", "file": "string?", "line": "number?" }] }
  },
  {
    "name": "export_model",
    "description": "Full-quality export to a file inside the project's export directory.",
    "inputSchema": { "type": "object", "required": ["path", "format"],
      "properties": { "path": { "type": "string" },
                      "format": { "enum": ["stl-binary","stl-ascii","3mf","off","amf","svg","dxf","png"] },
                      "parameters": { "type": "object" }, "parameterSet": { "type": "string" } } },
    "output": { "status": "ok|failed", "outputPath": "string?", "sizeBytes": "number?",
                "diagnostics": "Diagnostic[]" }
  },
  {
    "name": "get_diagnostics",
    "description": "Structured diagnostics of the most recent render of a file (or the active file).",
    "inputSchema": { "type": "object",
      "properties": { "path": { "type": "string" } } },
    "output": { "renderId": "string?", "quality": "preview|full|null", "diagnostics": "Diagnostic[]" }
  },
  {
    "name": "get_parameters",
    "description": "Extracted customizer schema and current values for a file.",
    "inputSchema": { "type": "object", "required": ["path"],
      "properties": { "path": { "type": "string" } } },
    "output": { "parameters": [{ "name": "string", "type": "number|boolean|string|vector",
                 "default": "any", "current": "any", "section": "string?", "description": "string?",
                 "control": "slider|dropdown|checkbox|number|text|vector",
                 "min": "number?", "max": "number?", "step": "number?", "options": "array?" }],
                "activeSet": "string?" }
  },
  {
    "name": "set_parameters",
    "description": "Set customizer values (render-override, does not edit source). Triggers a preview render.",
    "inputSchema": { "type": "object", "required": ["path", "values"],
      "properties": { "path": { "type": "string" },
                      "values": { "type": "object", "additionalProperties": true } } },
    "output": { "status": "applied|pending_review|denied", "unknownNames": ["string"] }
  },
  {
    "name": "take_screenshot",
    "description": "Capture the current model viewport as PNG.",
    "inputSchema": { "type": "object",
      "properties": { "width": { "type": "number", "default": 1024 },
                      "height": { "type": "number", "default": 768 } } },
    "output": { "mimeType": "image/png", "data": "base64 string" }
  },
  {
    "name": "get_history",
    "description": "The session command history (most recent first).",
    "inputSchema": { "type": "object",
      "properties": { "limit": { "type": "number", "default": 50 } } },
    "output": { "entries": [{ "commandId": "string", "timestamp": "ISO-8601",
                 "origin": "user|ai-panel|external-agent", "kind": "string",
                 "summary": "string", "undoable": "boolean" }] }
  }
]
```

---

# Appendix C — Theme token schema (normative)

A theme is one JSON file. Every key below is **required**; AC-12.a enforces completeness.
Values are CSS colors. `meta.kind` drives the OS-preference match (FR-12.1).

```jsonc
{
  "meta": { "name": "string", "kind": "light|dark|high-contrast", "version": 1 },

  "chrome": {
    "background": "", "surface": "", "surfaceRaised": "", "border": "",
    "text": "", "textMuted": "", "textDisabled": "",
    "accent": "", "accentText": "", "focusRing": "",
    "hover": "", "active": "", "selection": "",
    "statusBarBackground": "", "statusBarText": "",
    "badgeInfo": "", "badgeWarning": "", "badgeError": ""
  },

  "editor": {
    "background": "", "text": "", "lineNumber": "", "activeLine": "",
    "cursor": "", "selection": "", "matchingBracket": "",
    "squiggleError": "", "squiggleWarning": "",
    "syntax": {
      "keyword": "", "builtin": "", "userModule": "", "number": "",
      "string": "", "boolean": "", "specialVariable": "", "comment": "",
      "operator": "", "modifierChar": "", "punctuation": ""
    }
  },

  "viewer": {
    "background": "", "mesh": "", "meshHighlight": "", "edges": "",
    "grid": "", "gridMajor": "",
    "axisX": "", "axisY": "", "axisZ": "",
    "measurement": "", "annotation": "", "clippingCap": ""
  },

  "console": {
    "background": "", "text": "",
    "error": "", "warning": "", "echo": "", "trace": "", "info": "",
    "runSeparator": "", "timestamp": ""
  },

  "diff": {
    "addedBackground": "", "addedText": "",
    "removedBackground": "", "removedText": "",
    "hunkHeader": ""
  }
}
```

---

# Appendix D — Default keybindings (normative defaults; all rebindable)

`Mod` = Ctrl on Windows/Linux, Cmd on macOS.

| Command | Binding |
|---|---|
| Save | Mod+S |
| Save all | Mod+Alt+S |
| New file | Mod+N |
| Open project/folder | Mod+O |
| Close tab | Mod+W |
| Reopen closed tab | Mod+Shift+T |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Find / Replace | Mod+F / Mod+H |
| Find in project | Mod+Shift+F |
| Go to line | Mod+G |
| Go to definition | F12 |
| Toggle comment | Mod+/ |
| Format document | Shift+Alt+F |
| Undo / Redo | Mod+Z / Mod+Y (and Mod+Shift+Z) |
| Multi-cursor add | Alt+Click |
| Render preview | F5 |
| Full render | F6 |
| Cancel render | Esc (while rendering, viewer focused) |
| Export… | Mod+E |
| Zoom viewer to fit | Mod+0 (viewer focused) |
| Axis views | Numpad 1/3/7 = front/right/top (viewer focused) |
| Toggle perspective/ortho | Numpad 5 (viewer focused) |
| Screenshot viewport | Mod+Shift+P |
| Toggle console | Mod+J |
| Toggle left dock | Mod+B |
| Toggle parameter panel | Mod+Shift+B |
| Maximize editor / viewer | Mod+Shift+E / Mod+Shift+V |
| Settings | Mod+, |
| Command palette (all commands searchable) | Mod+Shift+K |
| Switch code/model (narrow layout) | Mod+M |

Conflict rule: user rebinds are validated against collisions within the same focus scope;
collisions are refused with the conflicting command named.

---

# Appendix E — Formatter golden fixtures (normative)

Style constants for all fixtures: 4-space indent, `Mod` style per FR-7.1. Each pair is
INPUT → EXPECTED. These fixtures **are** the formatter's style definition; prose in FR-7.1 is
the summary.

**E1 — operator and comma spacing**
```
// INPUT
x=1+2*(3-4);v=[1,2 ,3];
// EXPECTED
x = 1 + 2 * (3 - 4);
v = [1, 2, 3];
```

**E2 — indentation normalization**
```
// INPUT
module a(){
      cube(1);
  sphere(2);
}
// EXPECTED
module a() {
    cube(1);
    sphere(2);
}
```

**E3 — attached braces**
```
// INPUT
module b()
{
    cube(1);
}
// EXPECTED
module b() {
    cube(1);
}
```

**E4 — one statement per line**
```
// INPUT
cube(1); sphere(2); cylinder(h = 3, r = 1);
// EXPECTED
cube(1);
sphere(2);
cylinder(h = 3, r = 1);
```

**E5 — blank-line collapse (max one)**
```
// INPUT
a = 1;



b = 2;
// EXPECTED
a = 1;

b = 2;
```

**E6 — customizer annotations preserved exactly**
```
// INPUT
/* [Dimensions] */
width=40; // [10:100]
style="round"; // [round:Rounded, square:Square]
/* [Hidden] */
eps=0.01;
// EXPECTED
/* [Dimensions] */
width = 40; // [10:100]
style = "round"; // [round:Rounded, square:Square]
/* [Hidden] */
eps = 0.01;
```

**E7 — transform chain (≥ 2 modifiers) breaks one-per-line, hanging indent**
```
// INPUT
translate([0,0,5]) rotate([0,90,0]) cylinder(h=10,r=2);
// EXPECTED
translate([0, 0, 5])
    rotate([0, 90, 0])
    cylinder(h = 10, r = 2);
```

**E8 — single transform stays inline when the line fits 100 columns**
```
// INPUT
translate([0,0,5])cube(10);
// EXPECTED
translate([0, 0, 5]) cube(10);
```

**E9 — list comprehension**
```
// INPUT
pts=[for(i=[0:10])[i,i*i]];
// EXPECTED
pts = [for (i = [0:10]) [i, i * i]];
```

**E10 — let and ternary**
```
// INPUT
r=let(a=2,b=3)a>b?a:b;
// EXPECTED
r = let (a = 2, b = 3) a > b ? a : b;
```

**E11 — modifier characters stay attached to their statement**
```
// INPUT
#  cube(5);
!translate([1,0,0]) sphere(2);
// EXPECTED
#cube(5);
!translate([1, 0, 0]) sphere(2);
```

**E12 — include/use lines untouched (no reordering, no spacing changes inside <>)**
```
// INPUT
include <BOSL2/std.scad>
use   <lib/gears.scad>
// EXPECTED
include <BOSL2/std.scad>
use <lib/gears.scad>
```

**E13 — function definition; long expression wraps after operators at +1 indent**
```
// INPUT
function vol(w,d,h)=w*d*h;
function big(a,b,c,d,e,f)=a*b*c+a*b*d+a*b*e+a*b*f+c*d*e+c*d*f+really_long_name(a,b)+another_long_name(c,d);
// EXPECTED
function vol(w, d, h) = w * d * h;
function big(a, b, c, d, e, f) = a * b * c + a * b * d + a * b * e + a * b * f +
    c * d * e + c * d * f + really_long_name(a, b) + another_long_name(c, d);
```

**E14 — vectors and nested brackets: no inner padding, space after commas only**
```
// INPUT
m = [ [1 ,0 ,0], [0,1, 0],[0,0,1] ];
// EXPECTED
m = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
```

**E15 — comments keep their positions (trailing stays trailing, own-line stays own-line)**
```
// INPUT
a=1;// answer
/* block
   comment */
b=2;
// EXPECTED
a = 1; // answer
/* block
   comment */
b = 2;
```

Idempotence (AC-7.b) applies to all fifteen EXPECTED outputs.

---

# Appendix F — Sample models (normative; ship as the welcome-screen samples)

Three original models written for this specification. Each renders with the stock OpenSCAD
engine and exercises the parameter panel. (Verified against OpenSCAD on 2026-07-09; see the
project's golden-geometry suite for pinned hashes.)

**F1 — `parametric_box.scad`** (3D; sections, sliders, dropdown, checkbox — the customizer
showcase and the seed fixture for AC-5.a)

```openscad
// Parametric storage box with optional lid.

/* [Size] */
width = 60;        // [20:200]
depth = 40;        // [20:200]
height = 30;       // [10:120]
wall = 2.4;        // [1.2:0.4:6]

/* [Style] */
corner = "round";  // [round:Rounded, square:Square]
corner_radius = 6; // [2:20]
with_lid = true;

/* [Hidden] */
eps = 0.01;
$fn = 48;

module shell(w, d, h, r) {
    if (corner == "round") {
        linear_extrude(h)
            offset(r = r)
            square([w - 2 * r, d - 2 * r], center = true);
    } else {
        linear_extrude(h) square([w, d], center = true);
    }
}

module box() {
    difference() {
        shell(width, depth, height, corner_radius);
        translate([0, 0, wall])
            shell(width - 2 * wall, depth - 2 * wall, height, corner_radius);
    }
}

module lid() {
    lip = wall * 0.8;
    union() {
        shell(width, depth, wall, corner_radius);
        translate([0, 0, wall - eps])
            difference() {
                shell(width - 2 * wall - 0.4, depth - 2 * wall - 0.4, lip, corner_radius);
                translate([0, 0, -eps])
                    shell(width - 2 * wall - 0.4 - 2 * lip,
                          depth - 2 * wall - 0.4 - 2 * lip, lip + 2 * eps, corner_radius);
            }
    }
}

box();
if (with_lid)
    translate([width + 15, 0, 0]) lid();
```

**F2 — `gear_knob.scad`** (3D; math, loops, modules — the "code power" showcase)

```openscad
// Knurled control knob with a D-shaft bore.

/* [Knob] */
knob_diameter = 32;  // [15:80]
knob_height = 14;    // [6:40]
ridges = 24;         // [8:60]
ridge_depth = 1.2;   // [0.4:0.2:3]

/* [Shaft] */
bore_diameter = 6;   // [2:12]
d_flat = true;

/* [Hidden] */
$fn = 96;
eps = 0.01;

module ridge_profile() {
    r = knob_diameter / 2;
    for (i = [0:ridges - 1])
        rotate([0, 0, i * 360 / ridges])
            translate([r, 0])
            circle(d = ridge_depth * 2, $fn = 24);
}

module knob_body() {
    difference() {
        linear_extrude(knob_height, convexity = 4)
            union() {
                circle(d = knob_diameter);
                ridge_profile();
            }
        // chamfer the top rim
        translate([0, 0, knob_height])
            rotate_extrude()
            translate([knob_diameter / 2 + ridge_depth, 0])
            circle(d = 4, $fn = 24);
    }
}

module bore() {
    flat_offset = bore_diameter * 0.35;
    difference() {
        translate([0, 0, -eps])
            cylinder(h = knob_height + 2 * eps, d = bore_diameter);
        if (d_flat)
            translate([flat_offset, -bore_diameter / 2, -2 * eps])
                cube([bore_diameter, bore_diameter, knob_height + 4 * eps]);
    }
}

difference() {
    knob_body();
    bore();
}
```

**F3 — `mounting_plate.scad`** (2D; the SVG-pane showcase, exports to SVG/DXF)

```openscad
// 2D mounting plate: laser-cut or CNC outline with a hole pattern.

/* [Plate] */
plate_width = 80;   // [30:200]
plate_height = 50;  // [20:150]
fillet = 5;         // [0:15]

/* [Holes] */
hole_diameter = 4.2;  // [2:0.1:10]
hole_margin = 6;      // [3:20]
center_slot = true;

/* [Hidden] */
$fn = 64;

module outline() {
    offset(r = fillet) offset(r = -fillet)
        square([plate_width, plate_height], center = true);
}

module corner_holes() {
    dx = plate_width / 2 - hole_margin;
    dy = plate_height / 2 - hole_margin;
    for (x = [-dx, dx], y = [-dy, dy])
        translate([x, y]) circle(d = hole_diameter);
}

module slot() {
    hull()
        for (x = [-plate_width / 6, plate_width / 6])
            translate([x, 0]) circle(d = hole_diameter + 1);
}

difference() {
    outline();
    corner_holes();
    if (center_slot) slot();
}
```

---

## Amendment log

| # | Date | Section | Change |
|---|---|---|---|
| — | 2026-07-09 | — | v0.1 initial draft |
| — | 2026-07-09 | all | v0.2: §4.0 layout, §4.15 beyond-parity (15 FRs), A-6 modularity caps, N-7 UI honesty, Appendices A–F, milestones M4–M6 |
| — | 2026-07-09 | §2 | v0.3: whitelist + web-access near-miss rule (2.2), similarity-gate isolation from implementers (2.5), async question/amendment + decide-and-record protocol, engine pin (2.7) |
| — | 2026-07-09 | header, §9.3, FR-15.12 | Name resolved: **ScadMill** (clearance sweep passed: domains/GitHub/npm/PyPI/crates free, no product or trademark hits); CLI command renamed `scadmill` |
| A-1 | 2026-07-09 | AC-4.a | Cross-path parity for 2D models compares SVG, not STL (implementer finding: F3 is 2D by design) |
| A-2 | 2026-07-09 | FR-4.3 | Preview/full semantics corrected: engine CLI exposes no orbitable preview mesh; both levels render real geometry, preview uses disclosed speed settings (implementer finding) |
| A-3 | 2026-07-09 | Appendix A | `RenderRequest.files` accepts `string \| Uint8Array` — projects may import binary assets (implementer finding) |
| A-4 | 2026-07-09 | §2.5, M0 | Similarity-gate harness delivered owner-side (`owner-gate/`); implementers wire verbatim, never author/run; signing + counsel enumerated as owner-side dependencies |
| A-5 | 2026-07-09 | §2.7 | Engine pin may be a vetted official-repo commit/nightly (rationale + checksums recorded); building engine/WASM from official source is a permitted activity |
| A-6 | 2026-07-09 | §8 | Owner decision: commitment scope = the complete product, M0–M6, architected for from day one |
| A-7 | 2026-07-10 | §2.7, FR-6.4, FR-15.10, FR-15.14, FR-15.15 (new), AC-15.k/l/m (new) | Engine pin is the **2026.06.12 development snapshot** (first cross-platform build after upstream PR #6857 fixed multi-mesh 3MF color export; the 2021.01 stable has no color/multi-object 3MF export at all — the "stable by default" sentence is deleted as self-contradictory). Multi-object colored 3MF export is a first-class requirement with machine-checkable ACs; "Color" encoding mandated over "Base Material" (open upstream bug #6060); all engine color/multi-object flags isolated behind the EngineService adapter; UI must state plainly that slicers require per-object filament assignment (slicers ignore standard 3MF color metadata — upstream #5849) and never claim automatic filament mapping |
| A-8 | 2026-07-10 | §2.2 (items 3/5 new), §6 (approved list + notes), FR-15.16 (new), FR-15.17 (new), AC-15.n/o (new), milestones M5/M6 | Verified open-source leverage from an owner-run 120-candidate scan (every license read from primary sources). Approved: the OpenSCAD org's official tree-sitter grammar (MIT — direct structural use permitted and licensed reference for the fresh CodeMirror grammar; use only the `@openscad/`-scoped npm package), Leathong openscad-LSP (treat as Apache-2.0 — its MIT license file is missing upstream; its GPL-3 VS Code companion stays prohibited; one-formatter-authority rule), Kiri:Moto engine (MIT) for new FR-15.16 design-time estimates with strict estimate-labeling honesty rules, llguidance (MIT, optional constrained-decode lane). New FR-15.17 library-aware completions. §2.2 gains a safety-classified reference reading list; scan-confirmed gaps recorded (no CodeMirror-6 mode, no permissive highlighting grammar, no OpenSCAD constrained-decode grammar file exists anywhere — original work as assumed). Decisions already recorded under §2.7 for M0–M1 stand; nothing in A-8 retroactively invalidates merged work |
| A-9 | 2026-07-14 | FR-2.5, M2-R04 | Removed the obsolete 2020-class integrated-GPU minimum. The hardware-disclosing two-million-triangle orbit gate remains ≥ 30 fps; AMD Radeon 780M is the owner-designated benchmark baseline, not a minimum supported-hardware claim. Per-candidate qualification is accepted only from retained external evidence bound to the exact candidate source tree and profiler harness. |
| A-10 | 2026-07-19 | N-2, V-5, M4 | The Windows public-beta reliability soak is one continuous hour rather than eight. The hobbyist-oriented beta retains the 30-second edit/render cadence, midpoint verified engine-kill recovery, exact process-memory accounting, and 1.5× baseline ceiling; only the required duration is reduced. |
| A-11 | 2026-07-22 | FR-15.15, AC-15.k, Q-0042 | Owner resolution: the multi-object 3MF requirement uses the same standard Materials-extension Color encoding mandated by FR-15.14: one `<m:colorgroup>` with distinct `<m:color>` entries referenced by the objects' triangles/effective material properties. The contradictory `<basematerials>`/`displaycolor` wording is removed and Base Material remains prohibited. Q-0042 is resolved. |
