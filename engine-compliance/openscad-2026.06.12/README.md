# OpenSCAD WebAssembly distribution materials

ScadMill uses an unmodified OpenSCAD WebAssembly build as a separately fetched engine. The engine is not part of ScadMill's original application-code license.

Every public distribution of the pinned `openscad.js` and `openscad.wasm` files must keep this complete set together:

- the exact engine files and their original source-build `manifest.json`;
- `openscad-0a66508c67374febcfc814a73b5b948dd84a1ca3-corresponding-source.tar.gz`, containing the exact official checkout and recursive submodule contents used by the build;
- `COPYING`, copied without modification from that exact OpenSCAD checkout;
- `build-openscad-wasm.yml`, the ScadMill reproducible build recipe;
- `ENGINE_VERSION`, which records the source, toolchain, container, and artifact pins;
- `source-provenance.txt`, which records the root and recursive submodule commits; and
- `SHA256SUMS`, generated only after every preceding file has been assembled.

The matching engine identity is:

- OpenSCAD version: `2026.06.12`
- official source commit: `0a66508c67374febcfc814a73b5b948dd84a1ca3`
- `openscad.js`: 100,027 bytes; SHA-256 `E458673D46D506D77B780C526D6E5492250F353D582057C6F912724A9586D86E`
- `openscad.wasm`: 10,760,714 bytes; SHA-256 `F908AAFA32FEBE9A3A20F76ACA6B8101051BF2FC7655F094F18C6D99B52683EA`
- source-build manifest: 599 bytes; SHA-256 `AB195992B8316002D07D7630AE33CE276EB86A06BE320BE9F1604CA81A8787C4`

The packaging workflow fails closed if the retained engine bytes, source commit, recursive submodules, or expected build metadata differ. Publication is a separate release action; a green packaging run alone does not claim that these materials are publicly reachable.
