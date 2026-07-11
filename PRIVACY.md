# Privacy

ScadMill has no telemetry.

Through M2, ScadMill does not implement any application-initiated network request. The future,
explicitly user-initiated or user-configured paths reserved by specification A-5 are AI-provider
requests, the web engine artifact, an opt-in desktop update check, and explicit library or
engine-version downloads. Enabling the current update-check preference does not start a network
request because the updater itself arrives in a later milestone.

Web share links gzip the active single-file source into the URL fragment. Browsers do not send
fragments in HTTP requests, so the source does not touch the hosting server. The source is still
part of the link: treat the complete URL as a copy of the source. Anyone who receives it can
decode it, and it may remain with recipients or in browser history and history sync, bookmarks,
clipboard managers, or other applications that receive the link. Project ZIP import, project ZIP
export, and model exports are local browser file operations.

The desktop OpenSCAD engine runs as a local subprocess. Desktop projects, settings, recovery
buffers, exports, and rendered geometry stay on the user's machine. AI keys use the operating
system keychain and are excluded from settings files.

On the web target, complete project files use IndexedDB. Browser-local storage holds settings,
layout and recent-project metadata, the complete autosaved original scratch source, and crash-
recovery snapshots containing the complete saved and unsaved source of every recoverable buffer.
It also holds pinned annotation text and 3D coordinates keyed by project identity and file path;
transient measurements are not persisted.
Those records remain in the browser profile until ScadMill replaces or clears them, or the user
clears site data. AI keys use session storage by default. ScadMill writes an AI key to persistent
browser-local storage only after the user explicitly opts in from the warning-labeled setting;
settings export never includes the key.

To remove all web data, clear ScadMill's site data in the browser. M2 does not yet provide a
single in-app command that clears every local store.
