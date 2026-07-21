import { describe, expect, it, vi } from "vitest";

import {
  createAvailableOpenScadWasmArtifactCache,
  createIndexedDbOpenScadWasmArtifactCache,
  createOpenScadWasmArtifactCache,
  type OpenScadWasmBundleDatabase,
  type StoredOpenScadWasmBundle,
} from "../../src/platform-web/openscad-wasm-cache";

const KEY = "openscad-wasm:test";

function bundle(): StoredOpenScadWasmBundle {
  return {
    key: KEY,
    javascript: new Uint8Array([1, 2, 3]),
    wasm: new Uint8Array([4, 5, 6]),
  };
}

function memoryDatabase(initial?: unknown): {
  readonly database: OpenScadWasmBundleDatabase;
  readonly records: Map<string, unknown>;
} {
  const records = new Map<string, unknown>();
  if (initial !== undefined) records.set(KEY, initial);
  return {
    records,
    database: {
      read: async (key) => records.get(key) ?? null,
      write: async (record) => { records.set(record.key, record); },
      remove: async (key) => { records.delete(key); },
    },
  };
}

function fakeIndexedDb(): {
  readonly factory: IDBFactory;
  readonly created: ReturnType<typeof vi.fn>;
} {
  let record: StoredOpenScadWasmBundle | undefined;
  const stores = new Set<string>();
  const created = vi.fn((name: string, _options: IDBObjectStoreParameters) => stores.add(name));
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string, options: IDBObjectStoreParameters) => {
      created(name, options);
      return {};
    },
    transaction: (_name: string, mode: IDBTransactionMode) => {
      const transaction: Partial<IDBTransaction> = {};
      const complete = () => queueMicrotask(() => transaction.oncomplete?.call(
        transaction as IDBTransaction,
        new Event("complete"),
      ));
      const request = <T>(result: T): IDBRequest<T> => {
        const value = { result } as IDBRequest<T>;
        queueMicrotask(() => value.onsuccess?.(new Event("success")));
        return value;
      };
      transaction.objectStore = () => ({
        get: (key: IDBValidKey) => {
          const value = request(String(key) === record?.key ? record : undefined);
          complete();
          return value;
        },
        put: (value: StoredOpenScadWasmBundle) => {
          expect(mode).toBe("readwrite");
          record = value;
          const result = request(value.key);
          complete();
          return result;
        },
        delete: (key: IDBValidKey) => {
          expect(mode).toBe("readwrite");
          if (String(key) === record?.key) record = undefined;
          const result = request(undefined);
          complete();
          return result;
        },
      }) as unknown as IDBObjectStore;
      return transaction as IDBTransaction;
    },
  } as unknown as IDBDatabase;
  const openRequest = { result: database } as IDBOpenDBRequest;
  const factory = {
    open: vi.fn(() => {
      queueMicrotask(() => {
        openRequest.onupgradeneeded?.(new Event("upgradeneeded") as IDBVersionChangeEvent);
        openRequest.onsuccess?.(new Event("success"));
      });
      return openRequest;
    }),
  } as unknown as IDBFactory;
  return { factory, created };
}

function manualIndexedDb() {
  let record: StoredOpenScadWasmBundle | undefined;
  const transactions: Array<{
    readonly transaction: Partial<IDBTransaction>;
    request?: IDBRequest<unknown>;
    pending?: { readonly kind: "write"; readonly value: StoredOpenScadWasmBundle }
      | { readonly kind: "remove"; readonly key: string };
  }> = [];
  const database = {
    objectStoreNames: { contains: () => true },
    close: vi.fn(),
    transaction: (_name: string, _mode: IDBTransactionMode) => {
      const state = { transaction: {} as Partial<IDBTransaction> } as (typeof transactions)[number];
      state.transaction.objectStore = () => ({
        get: (key: IDBValidKey) => {
          state.request = {
            result: String(key) === record?.key ? record : undefined,
          } as IDBRequest<unknown>;
          return state.request;
        },
        put: (value: StoredOpenScadWasmBundle) => {
          state.pending = { kind: "write", value };
          return {} as IDBRequest<IDBValidKey>;
        },
        delete: (key: IDBValidKey) => {
          state.pending = { kind: "remove", key: String(key) };
          return {} as IDBRequest<undefined>;
        },
      }) as unknown as IDBObjectStore;
      transactions.push(state);
      return state.transaction as IDBTransaction;
    },
  } as unknown as IDBDatabase;
  const openRequest = { result: database } as IDBOpenDBRequest;
  const factory = { open: () => {
    queueMicrotask(() => openRequest.onsuccess?.(new Event("success")));
    return openRequest;
  } } as unknown as IDBFactory;
  return {
    factory,
    database,
    transactions,
    waitFor: async (index: number) => vi.waitFor(() => expect(transactions[index]).toBeDefined()),
    requestSuccess: (index: number) => {
      const request = transactions[index]?.request;
      request?.onsuccess?.call(request, new Event("success"));
    },
    complete: (index: number) => {
      const state = transactions[index];
      if (!state) throw new Error("Missing manual transaction.");
      if (state.pending?.kind === "write") record = state.pending.value;
      if (state.pending?.kind === "remove" && state.pending.key === record?.key) record = undefined;
      state.transaction.oncomplete?.call(
        state.transaction as IDBTransaction,
        new Event("complete"),
      );
    },
    abort: (index: number) => {
      const state = transactions[index];
      if (!state) throw new Error("Missing manual transaction.");
      state.transaction.onabort?.call(
        state.transaction as IDBTransaction,
        new Event("abort"),
      );
    },
    current: () => record,
  };
}

describe("OpenSCAD WASM artifact cache", () => {
  it("stores one paired bundle and returns defensive byte copies", async () => {
    const memory = memoryDatabase();
    const cache = createOpenScadWasmArtifactCache(memory.database);
    const original = bundle();

    await cache.write(original);
    original.javascript[0] = 9;
    original.wasm[0] = 9;
    const first = await cache.read(KEY);
    expect(first).toEqual(bundle());
    if (!first) throw new Error("Expected a cached bundle.");
    first.javascript[1] = 9;
    first.wasm[1] = 9;
    await expect(cache.read(KEY)).resolves.toEqual(bundle());
  });

  it.each([
    {},
    { key: "wrong", javascript: new Uint8Array(), wasm: new Uint8Array() },
    { key: KEY, javascript: [1], wasm: new Uint8Array() },
    { key: KEY, javascript: new Uint8Array(), wasm: "bytes" },
    Object.assign(Object.create({
      key: KEY,
      javascript: new Uint8Array(),
      wasm: new Uint8Array(),
    }) as object, { "javascript,key,wasm": true }),
  ])("rejects malformed stored records without returning executable bytes", async (record) => {
    const cache = createOpenScadWasmArtifactCache(memoryDatabase(record).database);
    await expect(cache.read(KEY)).rejects.toThrow(/Invalid OpenSCAD WASM cache record/u);
  });

  it("removes only the requested paired record", async () => {
    const memory = memoryDatabase();
    const cache = createOpenScadWasmArtifactCache(memory.database);
    await cache.write(bundle());
    await cache.remove(KEY);
    await expect(cache.read(KEY)).resolves.toBeNull();
  });

  it("creates and exercises the versioned IndexedDB store atomically", async () => {
    const fake = fakeIndexedDb();
    const cache = createIndexedDbOpenScadWasmArtifactCache(fake.factory, "test-engine-cache");
    await cache.write(bundle());
    await expect(cache.read(KEY)).resolves.toEqual(bundle());
    await cache.remove(KEY);
    await expect(cache.read(KEY)).resolves.toBeNull();
    expect(fake.factory.open).toHaveBeenCalledWith("test-engine-cache", 1);
    expect(fake.created).toHaveBeenCalledWith("artifact-bundles", { keyPath: "key" });
  });

  it("waits for transaction commit and rejects aborted writes without exposing bytes", async () => {
    const manual = manualIndexedDb();
    const cache = createIndexedDbOpenScadWasmArtifactCache(manual.factory);
    const write = cache.write(bundle());
    let writeSettled = false;
    void write.finally(() => { writeSettled = true; });
    await manual.waitFor(0);
    await Promise.resolve();
    expect(writeSettled).toBe(false);
    manual.complete(0);
    await expect(write).resolves.toBeUndefined();

    const read = cache.read(KEY);
    let readSettled = false;
    void read.finally(() => { readSettled = true; });
    await manual.waitFor(1);
    manual.requestSuccess(1);
    await Promise.resolve();
    expect(readSettled).toBe(false);
    manual.complete(1);
    await expect(read).resolves.toEqual(bundle());

    const rejected = manualIndexedDb();
    const rejectedCache = createIndexedDbOpenScadWasmArtifactCache(rejected.factory);
    const abortedWrite = rejectedCache.write(bundle());
    await rejected.waitFor(0);
    rejected.abort(0);
    await expect(abortedWrite).rejects.toThrow(/cache/u);
    expect(rejected.current()).toBeUndefined();
  });

  it("closes connections on version change and after a blocked open later succeeds", async () => {
    const database = {
      objectStoreNames: { contains: () => true },
      close: vi.fn(),
    } as unknown as IDBDatabase;
    const request = { result: database } as IDBOpenDBRequest;
    const factory = { open: () => request } as unknown as IDBFactory;
    const blockedRead = createIndexedDbOpenScadWasmArtifactCache(factory).read(KEY);
    request.onblocked?.(new Event("blocked") as IDBVersionChangeEvent);
    await expect(blockedRead).rejects.toThrow(/blocked/u);
    request.onsuccess?.(new Event("success"));
    expect(database.close).toHaveBeenCalledOnce();

    const healthyDatabase = {
      objectStoreNames: { contains: () => true },
      close: vi.fn(),
    } as unknown as IDBDatabase;
    const healthyRequest = { result: healthyDatabase } as IDBOpenDBRequest;
    createIndexedDbOpenScadWasmArtifactCache({
      open: () => healthyRequest,
    } as unknown as IDBFactory);
    healthyRequest.onsuccess?.(new Event("success"));
    healthyDatabase.onversionchange?.(
      new Event("versionchange") as IDBVersionChangeEvent,
    );
    expect(healthyDatabase.close).toHaveBeenCalledOnce();
  });

  it("keeps startup available when IndexedDB is absent or synchronously denied", () => {
    expect(createAvailableOpenScadWasmArtifactCache({ indexedDB: undefined })).toBeUndefined();
    const inaccessible = Object.defineProperty({}, "indexedDB", {
      get: () => { throw new DOMException("blocked", "SecurityError"); },
    });
    expect(createAvailableOpenScadWasmArtifactCache(inaccessible)).toBeUndefined();
    const denied = { open: () => { throw new DOMException("denied", "SecurityError"); } };
    expect(createAvailableOpenScadWasmArtifactCache({
      indexedDB: denied as unknown as IDBFactory,
    })).toBeUndefined();
  });
});
