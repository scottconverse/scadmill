import { describe, expect, it, vi } from "vitest";

import type { EngineOutputEvent } from "../../src/application/engine/contracts";
import { PINNED_OPENSCAD_WASM_BUILD_IDENTITY } from "../../src/application/engine/engine-pin";
import {
  decodeOpenScadWasmModuleFactory,
  type OpenScadFileSystem,
  type OpenScadWasmModuleOptions,
} from "../../src/platform-web/openscad-wasm-module";
import { createOpenScadWasmRuntime } from "../../src/platform-web/openscad-wasm-runtime";
import type { WasmRenderRequest } from "../../src/platform-web/wasm-engine-protocol";

const DIRECTORY_MODE = 0x4000;
const FILE_MODE = 0x8000;
const THREE_D_FALLBACK_FIXTURE = "Current top level object is not a 3D object.";

function normalized(path: string, cwd: string): string {
  const absolute = path.startsWith("/") ? path : `${cwd}/${path}`;
  const parts: string[] = [];
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

class MemoryFs implements OpenScadFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set(["/"]);
  cwd = "/";
  failMkdirAfterCreate?: Error;
  failWriteAt?: { readonly call: number; readonly error: Error };
  private writeCalls = 0;

  mkdirTree(path: string): void {
    let current = "";
    for (const part of normalized(path, this.cwd).split("/").filter(Boolean)) {
      current += `/${part}`;
      this.directories.add(current);
    }
    if (this.failMkdirAfterCreate) {
      const failure = this.failMkdirAfterCreate;
      this.failMkdirAfterCreate = undefined;
      throw failure;
    }
  }

  writeFile(path: string, contents: string | Uint8Array): void {
    this.writeCalls += 1;
    if (this.failWriteAt?.call === this.writeCalls) throw this.failWriteAt.error;
    const destination = normalized(path, this.cwd);
    if (!this.directories.has(destination.slice(0, destination.lastIndexOf("/")) || "/")) {
      throw new Error(`missing parent for ${destination}`);
    }
    this.files.set(
      destination,
      typeof contents === "string" ? new TextEncoder().encode(contents) : contents.slice(),
    );
  }

  readFile(path: string, options?: { readonly encoding?: "binary" | "utf8" }): Uint8Array | string {
    const source = this.files.get(normalized(path, this.cwd));
    if (!source) throw new Error(`missing file ${path}`);
    return options?.encoding === "utf8" ? new TextDecoder().decode(source) : source.slice();
  }

  chdir(path: string): void {
    const destination = normalized(path, this.cwd);
    if (!this.directories.has(destination)) throw new Error(`missing directory ${destination}`);
    this.cwd = destination;
  }

  readdir(path: string): string[] {
    const directory = normalized(path, this.cwd);
    const prefix = directory === "/" ? "/" : `${directory}/`;
    const children = new Set([".", ".."]).add(".");
    for (const candidate of [...this.directories, ...this.files.keys()]) {
      if (!candidate.startsWith(prefix) || candidate === directory) continue;
      const child = candidate.slice(prefix.length).split("/")[0];
      if (child) children.add(child);
    }
    return [...children];
  }

  stat(path: string): { readonly mode: number } {
    const candidate = normalized(path, this.cwd);
    if (this.directories.has(candidate)) return { mode: DIRECTORY_MODE };
    if (this.files.has(candidate)) return { mode: FILE_MODE };
    throw new Error(`missing node ${candidate}`);
  }

  isDir(mode: number): boolean {
    return mode === DIRECTORY_MODE;
  }

  unlink(path: string): void {
    if (!this.files.delete(normalized(path, this.cwd))) throw new Error(`missing file ${path}`);
  }

  rmdir(path: string): void {
    const directory = normalized(path, this.cwd);
    if (this.readdir(directory).some((entry) => entry !== "." && entry !== "..")) {
      throw new Error(`directory not empty ${directory}`);
    }
    this.directories.delete(directory);
  }
}

function binaryStl(size: number): Uint8Array {
  const triangles = [
    [[0, 0, 0], [size, 0, 0], [0, size, size]],
  ];
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.flat(2).forEach((coordinate, index) => {
    view.setFloat32(84 + 12 + index * 4, coordinate, true);
  });
  return bytes;
}

interface Harness {
  readonly fs: MemoryFs;
  readonly options: OpenScadWasmModuleOptions;
  readonly calls: string[][];
}

function emit(callback: (byte: number) => void, text: string): void {
  for (const byte of new TextEncoder().encode(text)) callback(byte);
}

function moduleHarness(
  run: (arguments_: string[], harness: Harness) => number,
): { readonly namespace: unknown; readonly state: { current?: Harness } } {
  const state: { current?: Harness } = {};
  return {
    state,
    namespace: {
      default: vi.fn(async (options: OpenScadWasmModuleOptions) => {
        const harness: Harness = { fs: new MemoryFs(), options, calls: [] };
        state.current = harness;
        return {
          FS: harness.fs,
          callMain: (arguments_: string[]) => {
            harness.calls.push([...arguments_]);
            return run(arguments_, harness);
          },
        };
      }),
    },
  };
}

function renderRequest(quality: "preview" | "full" = "preview"): WasmRenderRequest {
  return {
    entryFile: "main.scad",
    files: [
      { path: "main.scad", contents: "import(\"assets/shape.stl\");" },
      { path: "assets/shape.stl", contents: new Uint8Array([0, 255, 7]) },
    ],
    parameters: { width: 12, label: "quoted \"text\"", enabled: true, point: [1, -2.5] },
    quality,
    timeoutMs: 1_000,
    previewFacetLimit: 24,
  };
}

describe("OpenSCAD WASM module boundary", () => {
  it("decodes only a factory that resolves a complete FS/callMain module", async () => {
    expect(() => decodeOpenScadWasmModuleFactory({ default: 3 })).toThrow(/factory/iu);
    const bad = decodeOpenScadWasmModuleFactory({ default: async () => ({ FS: {}, callMain() {} }) });
    await expect(bad({} as OpenScadWasmModuleOptions)).rejects.toThrow(/file system/iu);
  });
});

describe("OpenScadWasmRuntime", () => {
  it.each([
    [0, "OpenSCAD version 2026.06.12\n", {
      version: "2026.06.12",
      path: "wasm",
      features: [],
      buildIdentity: PINNED_OPENSCAD_WASM_BUILD_IDENTITY,
    }],
    [7, "OpenSCAD version 2026.06.12\n", null],
    [0, "not an OpenSCAD version\n", null],
  ] as const)(
    "returns exact WASM version information only for a successful parse (exit %s)",
    async (exitCode, text, expected) => {
      const harness = moduleHarness((arguments_, current) => {
        expect(arguments_).toEqual(["--version"]);
        emit(current.options.stderr, text);
        return exitCode;
      });
      const runtime = await createOpenScadWasmRuntime(harness.namespace, {
        locateFile: (path) => path,
      });

      await expect(runtime.version()).resolves.toEqual(expected);
    },
  );

  it("stages text and binary files, assembles deterministic preview CLI arguments, captures bytes, parses STL, and cleans the VFS", async () => {
    const harness = moduleHarness((arguments_, current) => {
      expect(new TextDecoder().decode(current.fs.files.get(`${current.fs.cwd}/main.scad`))).toBe(
        "import(\"assets/shape.stl\");",
      );
      expect(current.fs.files.get(`${current.fs.cwd}/assets/shape.stl`)).toEqual(
        new Uint8Array([0, 255, 7]),
      );
      emit(current.options.stdout, "ECHO: ready\n");
      emit(current.options.stderr, "WARNING: measured\n");
      const output = arguments_[arguments_.indexOf("-o") + 1];
      current.fs.writeFile(output, binaryStl(3));
      return 0;
    });
    let clock = 10;
    const runtime = await createOpenScadWasmRuntime(harness.namespace, {
      locateFile: (path) => `/engine/${path}`,
      wasmBinary: new Uint8Array([1, 2]),
      now: () => clock++,
    });
    const output: EngineOutputEvent[] = [];

    const result = await runtime.render(renderRequest(), (event) => output.push(event));

    expect(harness.state.current?.calls).toEqual([[
      "--export-format", "binstl",
      "-D", "enabled=true",
      "-D", "label=\"quoted \\\"text\\\"\"",
      "-D", "point=[1, -2.5]",
      "-D", "width=12",
      "-D", "$fn=24",
      "-o", expect.stringMatching(/\/output\/model\.stl$/u),
      "main.scad",
    ]]);
    expect(result).toMatchObject({
      kind: "3d",
      mesh: { format: "stl-binary", bytes: binaryStl(3) },
      stats: {
        triangles: 1,
        boundingBox: { min: [0, 0, 0], max: [3, 3, 3] },
      },
      diagnostics: [
        { severity: "echo", message: "ready" },
        { severity: "warning", message: "measured" },
      ],
      rawLog: "ECHO: ready\nWARNING: measured\n",
    });
    expect(output.map(({ sequence, stream, raw }) => ({ sequence, stream, raw }))).toEqual([
      { sequence: 0, stream: "stdout", raw: "ECHO: ready\n" },
      { sequence: 1, stream: "stderr", raw: "WARNING: measured\n" },
    ]);
    expect(harness.state.current?.fs.files.size).toBe(0);
    expect(harness.state.current?.fs.directories).toEqual(new Set(["/"]));
  });

  it("omits the facet override for full renders and falls back to SVG with exact summary arguments", async () => {
    let invocation = 0;
    const harness = moduleHarness((arguments_, current) => {
      invocation += 1;
      if (invocation === 1) {
        emit(current.options.stderr, "Current top level object is not a 3D object.\n");
        return 1;
      }
      const output = arguments_[arguments_.indexOf("-o") + 1];
      const summary = arguments_[arguments_.indexOf("--summary-file") + 1];
      current.fs.writeFile(output, '<svg xmlns="http://www.w3.org/2000/svg"/>');
      current.fs.writeFile(summary, JSON.stringify({
        geometry: { dimensions: 2, bounding_box: { min: [-5, -3], max: [5, 3] } },
      }));
      return 0;
    });
    const runtime = await createOpenScadWasmRuntime(harness.namespace, {
      locateFile: (path) => path,
    });

    const result = await runtime.render(renderRequest("full"));

    expect(harness.state.current?.calls[0]).not.toContain("$fn=24");
    expect(harness.state.current?.calls[1]).toEqual([
      "--export-format", "svg",
      "-D", "enabled=true",
      "-D", "label=\"quoted \\\"text\\\"\"",
      "-D", "point=[1, -2.5]",
      "-D", "width=12",
      "-o", expect.stringMatching(/\/output\/model\.svg$/u),
      "main.scad",
      "--summary", "geometry",
      "--summary", "bounding-box",
      "--summary-file", expect.stringMatching(/\/output\/model-summary\.json$/u),
    ]);
    expect(result).toMatchObject({
      kind: "2d",
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      boundingBox: { min: [-5, -3], max: [5, 3] },
    });
    expect(harness.state.current?.fs.directories).toEqual(new Set(["/"]));
  });

  it("assembles every export format as a full run and cleans successful artifacts", async () => {
    const harness = moduleHarness((arguments_, current) => {
      const output = arguments_[arguments_.indexOf("-o") + 1];
      current.fs.writeFile(output, new Uint8Array([9, 8, 7]));
      return 0;
    });
    const runtime = await createOpenScadWasmRuntime(harness.namespace, {
      locateFile: (path) => path,
    });
    const formats = [
      ["stl-binary", "binstl", "stl"],
      ["stl-ascii", "asciistl", "stl"],
      ["3mf", "3mf", "3mf"],
      ["off", "off", "off"],
      ["amf", "amf", "amf"],
      ["svg", "svg", "svg"],
      ["dxf", "dxf", "dxf"],
    ] as const;

    for (const [format, cli, extension] of formats) {
      const result = await runtime.export({ ...renderRequest(), format });
      expect(result).toMatchObject({ ok: true, bytes: new Uint8Array([9, 8, 7]), fileExtension: extension });
      const call = harness.state.current?.calls.at(-1) ?? [];
      expect(call.slice(0, 2)).toEqual(["--export-format", cli]);
      expect(call).not.toContain("$fn=24");
    }
    expect(harness.state.current?.fs.directories).toEqual(new Set(["/"]));
  });

  it("assembles native-aligned PNG arguments and refuses invalid dimensions or an explicit camera before callMain", async () => {
    const harness = moduleHarness((arguments_, current) => {
      const output = arguments_[arguments_.indexOf("-o") + 1];
      current.fs.writeFile(output, new Uint8Array([1, 2, 3]));
      return 0;
    });
    const runtime = await createOpenScadWasmRuntime(harness.namespace, {
      locateFile: (path) => path,
    });

    await expect(runtime.export({
      ...renderRequest(),
      format: "png",
      image: { width: 640, height: 480 },
    })).resolves.toMatchObject({ ok: true, bytes: new Uint8Array([1, 2, 3]), fileExtension: "png" });
    expect(harness.state.current?.calls[0]).toEqual([
      "--export-format", "png",
      "-D", "enabled=true",
      "-D", "label=\"quoted \\\"text\\\"\"",
      "-D", "point=[1, -2.5]",
      "-D", "width=12",
      "-o", expect.stringMatching(/\/output\/model\.png$/u),
      "main.scad",
      "--render=true",
      "--imgsize=640,480",
    ]);

    await expect(runtime.export({
      ...renderRequest(),
      format: "png",
      image: { width: 0, height: 480 },
    })).resolves.toMatchObject({ ok: false, rawLog: expect.stringMatching(/positive/iu) });
    await expect(runtime.export({
      ...renderRequest(),
      format: "png",
      image: {
        width: 640,
        height: 480,
        camera: {
          position: [10, 10, 10],
          target: [0, 0, 0],
          up: [0, 0, 1],
        },
      },
    })).resolves.toMatchObject({ ok: false, rawLog: expect.stringMatching(/Q-0021/u) });
    expect(harness.state.current?.calls).toHaveLength(1);
    expect(harness.state.current?.fs.directories).toEqual(new Set(["/"]));
  });

  it.each(["mkdir", "write"] as const)(
    "removes every partial VFS node and preserves the original %s staging failure",
    async (failureKind) => {
      const harness = moduleHarness(() => 0);
      const runtime = await createOpenScadWasmRuntime(harness.namespace, {
        locateFile: (path) => path,
      });
      const fs = harness.state.current?.fs;
      if (!fs) throw new Error("The fake module was not created.");
      const expected = `${failureKind} staging exploded`;
      if (failureKind === "mkdir") fs.failMkdirAfterCreate = new Error(expected);
      else fs.failWriteAt = { call: 2, error: new Error(expected) };

      await expect(runtime.render(renderRequest())).resolves.toMatchObject({
        kind: "failure",
        rawLog: expected,
      });
      expect(harness.state.current?.calls).toEqual([]);
      expect(fs.files.size).toBe(0);
      expect(fs.directories).toEqual(new Set(["/"]));
    },
  );

  it("preserves multibyte output across interleaved stdout and stderr callbacks", async () => {
    const harness = moduleHarness((arguments_, current) => {
      const encoded = new TextEncoder().encode("é\n");
      current.options.stdout(encoded[0] as number);
      emit(current.options.stderr, "WARNING: between\n");
      current.options.stdout(encoded[1] as number);
      current.options.stdout(encoded[2] as number);
      const output = arguments_[arguments_.indexOf("-o") + 1];
      current.fs.writeFile(output, binaryStl(1));
      return 0;
    });
    const runtime = await createOpenScadWasmRuntime(harness.namespace, {
      locateFile: (path) => path,
    });
    const events: EngineOutputEvent[] = [];

    const result = await runtime.render(
      { ...renderRequest("full"), parameters: {} },
      (event) => events.push(event),
    );

    expect(result.rawLog).toBe("WARNING: between\né\n");
    expect(events.map(({ stream, raw }) => ({ stream, raw }))).toEqual([
      { stream: "stderr", raw: "WARNING: between\n" },
      { stream: "stdout", raw: "é\n" },
    ]);
  });

  it("isolates complete-line and finish-time observer exceptions from render/export cleanup", async () => {
    const harness = moduleHarness((arguments_, current) => {
      const output = arguments_[arguments_.indexOf("-o") + 1];
      if (arguments_[1] === "binstl") {
        emit(current.options.stdout, "complete line\n");
        current.fs.writeFile(output, binaryStl(1));
      } else {
        emit(current.options.stderr, "unterminated export output");
        current.fs.writeFile(output, new Uint8Array([4, 5, 6]));
      }
      return 0;
    });
    const runtime = await createOpenScadWasmRuntime(harness.namespace, {
      locateFile: (path) => path,
    });
    const observerFailure = () => { throw new Error("observer exploded"); };

    await expect(runtime.render(
      { ...renderRequest("full"), parameters: {} },
      observerFailure,
    )).resolves.toMatchObject({ kind: "3d" });
    await expect(runtime.export(
      { ...renderRequest(), format: "3mf", parameters: {} },
      observerFailure,
    )).resolves.toMatchObject({ ok: true, bytes: new Uint8Array([4, 5, 6]) });
    expect(harness.state.current?.fs.files.size).toBe(0);
    expect(harness.state.current?.fs.directories).toEqual(new Set(["/"]));
  });

  it.each(["stl", "summary"] as const)(
    "retains engine output and labels the adapter cause after a later %s parse failure",
    async (failureKind) => {
      let invocation = 0;
      const harness = moduleHarness((arguments_, current) => {
        invocation += 1;
        if (failureKind === "summary" && invocation === 1) {
          emit(current.options.stderr, `${THREE_D_FALLBACK_FIXTURE}\n`);
          return 1;
        }
        emit(current.options.stderr, "WARNING: engine output retained\n");
        const output = arguments_[arguments_.indexOf("-o") + 1];
        if (failureKind === "stl") current.fs.writeFile(output, new Uint8Array([1, 2, 3]));
        else {
          const summary = arguments_[arguments_.indexOf("--summary-file") + 1];
          current.fs.writeFile(output, '<svg xmlns="http://www.w3.org/2000/svg"/>');
          current.fs.writeFile(summary, "not-json");
        }
        return 0;
      });
      const runtime = await createOpenScadWasmRuntime(harness.namespace, {
        locateFile: (path) => path,
      });

      const result = await runtime.render({ ...renderRequest("full"), parameters: {} });

      expect(result).toMatchObject({ kind: "failure", reason: "engine-error" });
      expect(result.rawLog).toContain("WARNING: engine output retained\n");
      expect(result.rawLog).toMatch(/\[ScadMill WASM adapter error\].+(?:STL|JSON)/isu);
      expect(result.diagnostics).toContainEqual({
        severity: "warning",
        message: "engine output retained",
      });
      expect(result.diagnostics).toContainEqual({
        severity: "error",
        message: expect.stringMatching(/^ScadMill WASM adapter:/u),
      });
      expect(harness.state.current?.fs.directories).toEqual(new Set(["/"]));
    },
  );

  it("flushes unterminated stream events in first-pending-byte order", async () => {
    const harness = moduleHarness((arguments_, current) => {
      emit(current.options.stderr, "stderr pending");
      emit(current.options.stdout, "stdout pending");
      const output = arguments_[arguments_.indexOf("-o") + 1];
      current.fs.writeFile(output, binaryStl(1));
      return 0;
    });
    const runtime = await createOpenScadWasmRuntime(harness.namespace, {
      locateFile: (path) => path,
    });
    const events: EngineOutputEvent[] = [];

    await runtime.render(
      { ...renderRequest("full"), parameters: {} },
      (event) => events.push(event),
    );

    expect(events.map(({ stream, raw }) => ({ stream, raw }))).toEqual([
      { stream: "stderr", raw: "stderr pending" },
      { stream: "stdout", raw: "stdout pending" },
    ]);
  });

  const invalidProjects: readonly [string, WasmRenderRequest][] = [
    ["traversal", { ...renderRequest(), files: [{ path: "../escape.scad", contents: "cube(1);" }], entryFile: "../escape.scad" }],
    ["case collision", { ...renderRequest(), files: [{ path: "Part.scad", contents: "cube(1);" }, { path: "part.scad", contents: "cube(2);" }], entryFile: "Part.scad" }],
    ["binary entry", { ...renderRequest(), files: [{ path: "main.scad", contents: new Uint8Array([1]) }] }],
  ];

  it.each(invalidProjects)("rejects %s projects before callMain", async (_name, request) => {
    const harness = moduleHarness(() => 0);
    const runtime = await createOpenScadWasmRuntime(harness.namespace, {
      locateFile: (path) => path,
    });

    await expect(runtime.render(request)).resolves.toMatchObject({ kind: "failure", reason: "engine-error" });
    expect(harness.state.current?.calls).toEqual([]);
    expect(harness.state.current?.fs.directories).toEqual(new Set(["/"]));
  });

  it("rejects unsafe parameters before callMain and cleans a failed CLI run", async () => {
    const harness = moduleHarness((_arguments, current) => {
      emit(current.options.stderr, "ERROR: render failed\n");
      return 7;
    });
    const runtime = await createOpenScadWasmRuntime(harness.namespace, {
      locateFile: (path) => path,
    });

    await expect(runtime.render({
      ...renderRequest(),
      parameters: { "width; echo(1)": 2 },
    })).resolves.toMatchObject({ kind: "failure", reason: "engine-error" });
    expect(harness.state.current?.calls).toEqual([]);

    const failed = await runtime.render({ ...renderRequest(), parameters: {} });
    expect(failed).toMatchObject({
      kind: "failure",
      reason: "engine-error",
      exitCode: 7,
      rawLog: "ERROR: render failed\n",
    });
    expect(harness.state.current?.fs.directories).toEqual(new Set(["/"]));
  });
});
