# Privacy

ScadMill has no telemetry.

Through C6, ScadMill does not implement an application-initiated network request. The future,
explicitly user-initiated or user-configured paths reserved by specification A-5 are AI-provider
requests, the web engine artifact, an opt-in desktop update check, and explicit library or
engine-version downloads.

Web share links gzip the active single-file source into the URL fragment. Browsers do not send
fragments in HTTP requests, so the source does not touch the hosting server. The source is still
part of the link: anyone who receives the complete URL can decode it, and the URL may remain in
browser history, bookmarks, or a clipboard. Project ZIP import, project ZIP export, and model
exports are local browser file operations.

The desktop OpenSCAD engine runs as a local subprocess. Desktop projects, recovery buffers,
exports, and rendered geometry stay on the user's machine.

On the web target, complete project files use IndexedDB. Browser-local storage holds layout and
recent-project metadata, the complete autosaved original scratch source, and crash-recovery
snapshots containing the complete saved and unsaved source of every recoverable buffer. Those
records remain in the browser profile until ScadMill replaces or clears them, or the user clears
site data.
