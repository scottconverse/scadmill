# ScadMill FAQ

## Why can I edit in the browser but not render?

The editor and browser project store do not require OpenSCAD. Rendering requires the separately fetched, version-pinned JavaScript/WASM engine pair. The public repository does not distribute that pair while Q-0033 remains unresolved. A load failure preserves editing and local projects.

## Why does ScadMill reject my installed OpenSCAD?

Reproducible geometry requires the exact version in `ENGINE_VERSION`. Configure that executable explicitly; ScadMill leaves other installations untouched.

## What is the difference between Preview and Full?

Preview uses the fastest available backend, the preview timeout, and preview-only quality limits. Full applies no preview overrides and is the only source used for exports.

## Where are my projects stored?

Desktop projects remain in the folder you selected. Browser workspaces live in IndexedDB under the browser profile. Browser ZIP export is the portable backup/transfer path.

## Does ScadMill upload my models or collect telemetry?

No telemetry is included, and ScadMill does not send model source to a ScadMill service. The web target requests only the same-origin engine assets described in [PRIVACY.md](../PRIVACY.md).

## What happens to unsaved work when I open another project?

ScadMill blocks silent replacement when documents are dirty or recovery is pending. Save or resolve the current state, then complete the requested open, or keep the current workspace.

## Why is Move to trash absent in the browser?

IndexedDB cannot provide real OS-trash semantics. The browser omits the action instead of permanently deleting while calling it trash. Desktop projects retain OS trash.

## Can I recover after a crash?

ScadMill records recoverable unsaved buffers and presents them on restart. Retained release evidence also exercises normal restart and forced-process recovery for the packaged Windows path.

## Why do native and browser SVG results not yet pass parity?

The pinned native engine currently emits CRLF while the WebAssembly path emits LF for the same SVG. The specification requires byte equality and forbids silent normalization, so Q-0034 asks the owner for the governing rule. STL parity is exact.

## Are MCP, AI generation, libraries, slicing, and a CLI available?

Not yet. Those capabilities are scheduled for M4–M6. The current M3 candidate does not claim them as shipped.
