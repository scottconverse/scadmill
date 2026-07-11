import type { ProjectStorage } from "../application/files/project-file-service";
import { parseProjectPath } from "../application/files/project-path";
import {
  createProjectSnapshot,
  type ProjectFileContent,
  type ProjectSnapshot,
} from "../application/files/project-snapshot";

export interface StoredProjectRecord {
  readonly projectId: string;
  readonly files: readonly {
    readonly path: string;
    readonly content: ProjectFileContent;
  }[];
}

export interface ProjectRecordDatabase {
  read(projectId: string): Promise<StoredProjectRecord | null>;
  update(
    projectId: string,
    transform: (current: StoredProjectRecord | null) => StoredProjectRecord,
  ): Promise<void>;
}

export interface BrowserProjectStorage extends ProjectStorage {
  replace(snapshot: ProjectSnapshot): Promise<void>;
}

export interface IndexedDbHost {
  readonly indexedDB?: IDBFactory;
}

function copyContent(content: ProjectFileContent): ProjectFileContent {
  return typeof content === "string" ? content : content.slice();
}

function recordFromSnapshot(snapshot: ProjectSnapshot): StoredProjectRecord {
  return {
    projectId: snapshot.projectId,
    files: [...snapshot.files].map(([path, content]) => ({ path, content: copyContent(content) })),
  };
}

function snapshotFromRecord(projectId: string, record: StoredProjectRecord | null): ProjectSnapshot {
  if (record === null) return createProjectSnapshot(projectId, new Map());
  if (record.projectId !== projectId || !Array.isArray(record.files)) {
    throw new Error("IndexedDB project record has an invalid identity or shape.");
  }
  const files = new Map<string, ProjectFileContent>();
  for (const file of record.files) {
    if (
      typeof file !== "object"
      || file === null
      || typeof file.path !== "string"
      || (typeof file.content !== "string" && !(file.content instanceof Uint8Array))
    ) throw new Error("IndexedDB project file has an invalid shape.");
    files.set(file.path, copyContent(file.content));
  }
  return createProjectSnapshot(projectId, files);
}

function updateRecord(
  projectId: string,
  current: StoredProjectRecord | null,
  mutate: (files: Map<string, ProjectFileContent>) => void,
): StoredProjectRecord {
  const snapshot = snapshotFromRecord(projectId, current);
  const files = new Map<string, ProjectFileContent>(
    [...snapshot.files].map(([path, content]) => [path, copyContent(content)]),
  );
  mutate(files);
  return recordFromSnapshot(createProjectSnapshot(projectId, files));
}

export function createBrowserProjectStorage(
  database: ProjectRecordDatabase,
): BrowserProjectStorage {
  return {
    snapshot: async (projectId) => snapshotFromRecord(projectId, await database.read(projectId)),
    write: async (projectId, path, content) => {
      const destination = parseProjectPath(path);
      await database.update(projectId, (current) => updateRecord(projectId, current, (files) => {
        files.set(destination, copyContent(content));
      }));
    },
    move: async (projectId, from, to) => {
      const source = parseProjectPath(from);
      const destination = parseProjectPath(to);
      await database.update(projectId, (current) => updateRecord(projectId, current, (files) => {
        const content = files.get(source);
        if (content === undefined) throw new Error(`Project file ${source} does not exist.`);
        if (files.has(destination)) throw new Error(`Project file ${destination} already exists.`);
        files.delete(source);
        files.set(destination, content);
      }));
    },
    trash: async (projectId, path) => {
      const target = parseProjectPath(path);
      await database.update(projectId, (current) => updateRecord(projectId, current, (files) => {
        if (!files.delete(target)) throw new Error(`Project file ${target} does not exist.`);
      }));
    },
    reveal: async () => {
      throw new Error("Reveal in the operating system is unavailable in the web app.");
    },
    replace: async (snapshot) => {
      await database.update(snapshot.projectId, () => recordFromSnapshot(snapshot));
    },
  };
}

export function createIndexedDbProjectDatabase(
  factory: IDBFactory,
  databaseName = "scadmill-projects-v1",
): ProjectRecordDatabase {
  if (!factory) throw new Error("IndexedDB project persistence is unavailable.");
  const request = factory.open(databaseName, 1);
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("projects")) {
        request.result.createObjectStore("projects", { keyPath: "projectId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open project storage."));
    request.onblocked = () => reject(new Error("Project storage upgrade is blocked by another tab."));
  });

  return {
    read: async (projectId) => {
      const database = await opened;
      return new Promise<StoredProjectRecord | null>((resolve, reject) => {
        const transaction = database.transaction("projects", "readonly");
        const request = transaction.objectStore("projects").get(projectId);
        request.onsuccess = () => resolve((request.result as StoredProjectRecord | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error("Could not read the web project."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Web project read was aborted."));
      });
    },
    update: async (projectId, transform) => {
      const database = await opened;
      return new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("projects", "readwrite");
        const store = transaction.objectStore("projects");
        const request = store.get(projectId);
        request.onsuccess = () => {
          try {
            store.put(transform((request.result as StoredProjectRecord | undefined) ?? null));
          } catch (error) {
            transaction.abort();
            reject(error);
          }
        };
        request.onerror = () => reject(request.error ?? new Error("Could not read the web project."));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the web project."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Web project update was aborted."));
      });
    },
  };
}

export function createAvailableBrowserProjectStorage(
  host: IndexedDbHost = globalThis,
): BrowserProjectStorage | undefined {
  try {
    const factory = host.indexedDB;
    return factory
      ? createBrowserProjectStorage(createIndexedDbProjectDatabase(factory))
      : undefined;
  } catch {
    return undefined;
  }
}
