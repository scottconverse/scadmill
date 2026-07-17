export interface StoredOpenScadWasmBundle {
  readonly key: string;
  readonly javascript: Uint8Array;
  readonly wasm: Uint8Array;
}

export interface OpenScadWasmArtifactCache {
  read(key: string): Promise<StoredOpenScadWasmBundle | null>;
  write(bundle: StoredOpenScadWasmBundle): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface OpenScadWasmBundleDatabase {
  read(key: string): Promise<unknown | null>;
  write(bundle: StoredOpenScadWasmBundle): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface IndexedDbCacheHost {
  readonly indexedDB?: IDBFactory;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function copyStoredBundle(value: unknown, expectedKey?: string): StoredOpenScadWasmBundle {
  const keys = isRecord(value) ? Object.keys(value) : [];
  if (
    !isRecord(value)
    || keys.length !== 3
    || !["javascript", "key", "wasm"].every((key) => Object.hasOwn(value, key))
    || typeof value.key !== "string"
    || value.key.length === 0
    || (expectedKey !== undefined && value.key !== expectedKey)
    || !(value.javascript instanceof Uint8Array)
    || !(value.wasm instanceof Uint8Array)
  ) {
    throw new Error("Invalid OpenSCAD WASM cache record.");
  }
  return {
    key: value.key,
    javascript: value.javascript.slice(),
    wasm: value.wasm.slice(),
  };
}

export function createOpenScadWasmArtifactCache(
  database: OpenScadWasmBundleDatabase,
): OpenScadWasmArtifactCache {
  return {
    read: async (key) => {
      const value = await database.read(key);
      return value === null ? null : copyStoredBundle(value, key);
    },
    write: async (bundle) => database.write(copyStoredBundle(bundle)),
    remove: async (key) => database.remove(key),
  };
}

function requestResult<T>(request: IDBRequest<T>, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(message));
  });
}

function transactionCompletion(transaction: IDBTransaction, message: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(message));
    transaction.onabort = () => reject(transaction.error ?? new Error(message));
  });
}

function bundleStore(database: IDBDatabase, mode: IDBTransactionMode) {
  const transaction = database.transaction("artifact-bundles", mode);
  return { transaction, store: transaction.objectStore("artifact-bundles") };
}

function createIndexedDbBundleDatabase(
  factory: IDBFactory,
  databaseName: string,
): OpenScadWasmBundleDatabase {
  const request = factory.open(databaseName, 1);
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("artifact-bundles")) {
        request.result.createObjectStore("artifact-bundles", { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => fail(
      request.error ?? new Error("Could not open the OpenSCAD WASM artifact cache."),
    );
    request.onblocked = () => fail(
      new Error("The OpenSCAD WASM artifact cache upgrade is blocked by another tab."),
    );
  });

  return {
    read: async (key) => {
      const { transaction, store } = bundleStore(await opened, "readonly");
      const result = requestResult(
        store.get(key) as IDBRequest<unknown | undefined>,
        "Could not read the OpenSCAD WASM artifact cache.",
      );
      const [value] = await Promise.all([
        result,
        transactionCompletion(transaction, "OpenSCAD WASM artifact cache read was aborted."),
      ]);
      return value ?? null;
    },
    write: async (bundle) => {
      const { transaction, store } = bundleStore(await opened, "readwrite");
      store.put(bundle);
      await transactionCompletion(transaction, "Could not write the OpenSCAD WASM artifact cache.");
    },
    remove: async (key) => {
      const { transaction, store } = bundleStore(await opened, "readwrite");
      store.delete(key);
      await transactionCompletion(transaction, "Could not remove the OpenSCAD WASM artifact cache record.");
    },
  };
}

export function createIndexedDbOpenScadWasmArtifactCache(
  factory: IDBFactory,
  databaseName = "scadmill-openscad-wasm-v1",
): OpenScadWasmArtifactCache {
  if (!factory) throw new Error("IndexedDB OpenSCAD WASM caching is unavailable.");
  return createOpenScadWasmArtifactCache(createIndexedDbBundleDatabase(factory, databaseName));
}

export function createAvailableOpenScadWasmArtifactCache(
  host: IndexedDbCacheHost = globalThis,
): OpenScadWasmArtifactCache | undefined {
  try {
    const factory = host.indexedDB;
    return factory ? createIndexedDbOpenScadWasmArtifactCache(factory) : undefined;
  } catch {
    return undefined;
  }
}
