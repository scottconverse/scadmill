# Privacy

ScadMill has no telemetry and does not send model source, project files, settings, engine output,
diagnostics, or secrets to a ScadMill service.

ScadMill `0.1.0-beta.1` is currently an unpublished Windows desktop candidate. There is no public
ScadMill download or hosted web application yet. The web sections below document implemented
source behavior for a future, separately qualified web publication; they are not claims about a
currently operated ScadMill service.

On the web target, ScadMill requests the pinned, versioned `openscad.js` and `openscad.wasm`
assets from the same static origin as the application. It validates the exact expected byte
length and SHA-256 of both files before execution, then commits the verified pair atomically to
a versioned IndexedDB cache. A failed or partial download is not cached; Retry starts a new
verified load. These requests contain no model source, project files, settings, diagnostics, or
secret values. Q-0033 is resolved and its exact compliance package passed the historical M3 gate,
but the engine bytes remain unpublished and are not part of the Windows-first beta.

AI-provider requests are explicitly user-initiated and go only to the selected OpenAI-compatible,
Anthropic, or local endpoint. On desktop, a bounded native HTTP broker authorizes that request
against the exact provider endpoint already persisted in ScadMill settings, applies request and
response limits, and refuses redirects. Each request contains the conversation plus only
the source, diagnostics, parameters, or viewer screenshot context selected in the panel. ScadMill
does not proxy these requests through a ScadMill service. Other reserved network paths are an
opt-in desktop update check and explicit library or engine-version downloads. Enabling the current
update-check preference does not start a network request because the updater itself arrives in a
later milestone.

Web share links gzip the active single-file source into the URL fragment. Browsers do not send
fragments in HTTP requests, so the source does not touch the hosting server. The source is still
part of the link: treat the complete URL as a copy of the source. Anyone who receives it can
decode it, and it may remain with recipients or in browser history and history sync, bookmarks,
clipboard managers, or other applications that receive the link. Project ZIP import, project ZIP
export, and model exports are local browser file operations.

The desktop OpenSCAD engine runs as a local subprocess. Desktop projects, settings, recovery
buffers, exports, and rendered geometry stay on the user's machine. AI keys use independently
scoped operating-system credential-store records and are excluded from settings files and saved
conversations.

Uninstall removes the installed application and its ScadMill `.scad` association; it is not an
all-data-erasure promise. User-selected projects remain outside the installation directory.
Settings, recovery data, cache records, and operating-system credential records may remain in the
Windows user profile unless they are cleared separately. Before uninstalling, clear each AI key
from **Settings → AI** and clear any enabled project disk cache from **Settings → Rendering** if
you do not want those records retained. See the [Windows beta guide](docs/WINDOWS-BETA.md).

The desktop render cache is off by default and can be enabled independently for each opened
project; scratch work is never eligible. When enabled, ScadMill stores rendered SVG or mesh
geometry together with engine logs, diagnostics, statistics, and integrity/LRU metadata under
the operating system's ScadMill app-cache directory, not in the project folder. Individual
records are capped at 4 MiB and the disk tier evicts least-recently-used records to its configured
budget. The preference is keyed only by the project's opaque local identity and is not included
in settings export. Turning the preference off stops future disk-cache reads and writes but does
not delete records already stored. Use **Settings → Rendering → Clear this project's disk render
cache** while that project is open to delete its durable cache records; clearing does not remove
the current in-memory render result.

On the web target, complete project files use IndexedDB. Browser-local storage holds settings,
layout and recent-project metadata, the complete autosaved original scratch source, and crash-
recovery snapshots containing the complete saved and unsaved source of every recoverable buffer.
It also holds pinned annotation text and 3D coordinates keyed by project identity and file path;
transient measurements are not persisted.
Those records remain in the browser profile until ScadMill replaces or clears them, or the user
clears site data. AI keys use session storage by default. ScadMill writes an AI key to persistent
browser-local storage only after the user explicitly opts in from the warning-labeled setting;
the choice migrates each named provider key together. Settings export and saved conversations
never include exact configured key values.

To remove all web data, clear ScadMill's site data in the browser. The current product does not
provide a single in-app command that clears every local store.
