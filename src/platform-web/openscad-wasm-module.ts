export interface OpenScadFileSystem {
  mkdirTree(path: string): void;
  writeFile(path: string, contents: string | Uint8Array): void;
  readFile(path: string, options?: { readonly encoding?: "binary" | "utf8" }): Uint8Array | string;
  chdir(path: string): void;
  readdir(path: string): string[];
  stat(path: string): { readonly mode: number };
  isDir(mode: number): boolean;
  unlink(path: string): void;
  rmdir(path: string): void;
}

export interface OpenScadWasmModule {
  readonly FS: OpenScadFileSystem;
  callMain(arguments_: string[]): number;
}

export interface OpenScadWasmModuleOptions {
  readonly noInitialRun: true;
  readonly noExitRuntime: true;
  readonly locateFile: (path: string) => string;
  readonly stdout: (byte: number) => void;
  readonly stderr: (byte: number) => void;
  readonly wasmBinary?: Uint8Array;
}

export type OpenScadWasmModuleFactory = (
  options: OpenScadWasmModuleOptions,
) => Promise<OpenScadWasmModule>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeFileSystem(value: unknown): OpenScadFileSystem {
  if (!isRecord(value)) {
    throw new Error("The OpenSCAD WASM module returned an invalid file system.");
  }
  const required = [
    "mkdirTree",
    "writeFile",
    "readFile",
    "chdir",
    "readdir",
    "stat",
    "isDir",
    "unlink",
    "rmdir",
  ] as const;
  if (required.some((method) => typeof value[method] !== "function")) {
    throw new Error("The OpenSCAD WASM module returned an incomplete file system.");
  }
  return value as unknown as OpenScadFileSystem;
}

function decodeModule(value: unknown): OpenScadWasmModule {
  if (!isRecord(value) || typeof value.callMain !== "function") {
    throw new Error("The OpenSCAD WASM factory returned an invalid module.");
  }
  return {
    FS: decodeFileSystem(value.FS),
    callMain: value.callMain.bind(value) as (arguments_: string[]) => number,
  };
}

export function decodeOpenScadWasmModuleFactory(
  namespace: unknown,
): OpenScadWasmModuleFactory {
  if (!isRecord(namespace) || typeof namespace.default !== "function") {
    throw new Error("The OpenSCAD WASM JavaScript module has no default factory export.");
  }
  const factory = namespace.default as (options: OpenScadWasmModuleOptions) => Promise<unknown>;
  return async (options) => decodeModule(await factory(options));
}
