import {
  MAX_RENDER_THUMBNAIL_WORKSPACE_BYTES,
  MAX_RENDER_THUMBNAILS_PER_WORKSPACE,
  type RenderThumbnailPersistence,
  type RenderThumbnailRecord,
  validateRenderThumbnailRecord,
} from "../application/render-cache/render-thumbnail-persistence";

interface DurableWebviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_PREFIX = "scadmill.desktop-render-thumbnails.v1";
const OPAQUE_PROJECT_IDENTITY = /^desktop-project:[0-9a-f]{64}$/u;

function availableStorage(storage?: DurableWebviewStorage): DurableWebviewStorage | undefined {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return undefined; }
}

function storageKey(workspaceIdentity: string, prefix = STORAGE_PREFIX, allowAny = false): string | null {
  return (allowAny || OPAQUE_PROJECT_IDENTITY.test(workspaceIdentity))
    ? `${prefix}:${workspaceIdentity}`
    : null;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeRecords(serialized: string | null): readonly RenderThumbnailRecord[] {
  if (serialized === null) return [];
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(",") !== "records,version") {
    throw new Error("Invalid thumbnail envelope.");
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== 1 || !Array.isArray(envelope.records)
    || envelope.records.length > MAX_RENDER_THUMBNAILS_PER_WORKSPACE) {
    throw new Error("Unsupported thumbnail envelope.");
  }
  let total = 0;
  const records = envelope.records.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "capturedAt,documentPath,pngBase64,renderIdentity") {
      throw new Error("Invalid thumbnail record.");
    }
    const record = value as Record<string, unknown>;
    if (typeof record.documentPath !== "string"
      || typeof record.renderIdentity !== "string"
      || typeof record.capturedAt !== "string"
      || typeof record.pngBase64 !== "string") {
      throw new Error("Invalid thumbnail record values.");
    }
    const thumbnail = validateRenderThumbnailRecord({
      documentPath: record.documentPath,
      renderIdentity: record.renderIdentity,
      capturedAt: record.capturedAt,
      pngBytes: decodeBase64(record.pngBase64),
    });
    total += thumbnail.pngBytes.byteLength;
    if (total > MAX_RENDER_THUMBNAIL_WORKSPACE_BYTES) {
      throw new Error("Thumbnail workspace exceeds the supported size.");
    }
    return thumbnail;
  });
  if (new Set(records.map(({ documentPath }) => documentPath)).size !== records.length) {
    throw new Error("Thumbnail document paths must be unique.");
  }
  return records;
}

export function createDesktopRenderThumbnailPersistence(
  storage?: DurableWebviewStorage,
  options: { readonly prefix?: string; readonly allowAnyWorkspace?: boolean } = {},
): RenderThumbnailPersistence {
  const selected = availableStorage(storage);
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    supportsWorkspace: (workspaceIdentity) => Boolean(
      selected && storageKey(workspaceIdentity, options.prefix, options.allowAnyWorkspace),
    ),
    load: (workspaceIdentity) => {
      const key = storageKey(workspaceIdentity, options.prefix, options.allowAnyWorkspace);
      if (!key || !selected) return [];
      try { return decodeRecords(selected.getItem(key)); } catch { return []; }
    },
    save: (workspaceIdentity, thumbnail) => {
      const key = storageKey(workspaceIdentity, options.prefix, options.allowAnyWorkspace);
      if (!key) throw new Error("Thumbnail persistence requires an opaque desktop project identity.");
      if (!selected) throw new Error("Desktop profile storage is unavailable.");
      const next = validateRenderThumbnailRecord(thumbnail);
      const current = decodeRecords(selected.getItem(key));
      const records = [next, ...current.filter(({ documentPath }) => documentPath !== next.documentPath)];
      while (records.length > MAX_RENDER_THUMBNAILS_PER_WORKSPACE
        || records.reduce((sum, record) => sum + record.pngBytes.byteLength, 0) > MAX_RENDER_THUMBNAIL_WORKSPACE_BYTES) {
        records.pop();
      }
      selected.setItem(key, JSON.stringify({
        version: 1,
        records: records.map(({ documentPath, renderIdentity, capturedAt, pngBytes }) => ({
          documentPath,
          renderIdentity,
          capturedAt,
          pngBase64: encodeBase64(pngBytes),
        })),
      }));
      notify();
    },
    clear: (workspaceIdentity) => {
      const key = storageKey(workspaceIdentity, options.prefix, options.allowAnyWorkspace);
      if (!key) throw new Error("Thumbnail persistence requires an opaque desktop project identity.");
      if (!selected) throw new Error("Desktop profile storage is unavailable.");
      selected.removeItem(key);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createBrowserRenderThumbnailPersistence(storage?: DurableWebviewStorage): RenderThumbnailPersistence {
  return createDesktopRenderThumbnailPersistence(storage, {
    prefix: "scadmill.browser-render-thumbnails.v1",
    allowAnyWorkspace: true,
  });
}
