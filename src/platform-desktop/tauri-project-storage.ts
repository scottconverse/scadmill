import { invoke } from "@tauri-apps/api/core";

import type { ProjectStorage } from "../application/files/project-file-service";
import { parseProjectPath } from "../application/files/project-path";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../application/files/project-snapshot";
import type { Invoke } from "./tauri-bridge";

interface ProjectFileWire {
  readonly path: string;
  readonly text: boolean;
  readonly contentsBase64: string;
}

const EPHEMERAL_DESKTOP_WORKSPACE_IDENTITY = "desktop-ephemeral";

async function opaqueWorkspaceIdentity(
  invokeCommand: Invoke,
  projectId: string,
): Promise<string> {
  try {
    const material = await invokeCommand<unknown>("project_workspace_identity_material", {
      projectId,
    });
    if (typeof material !== "string" || material.length === 0) {
      return EPHEMERAL_DESKTOP_WORKSPACE_IDENTITY;
    }
    const bytes = new TextEncoder().encode(`scadmill-workspace-v1\0${material}`);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `desktop-project:${hex}`;
  } catch {
    return EPHEMERAL_DESKTOP_WORKSPACE_IDENTITY;
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error("Project file payload is not valid base64.");
  }
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeFile(file: ProjectFileWire): readonly [string, ProjectFileContent] {
  if (
    typeof file !== "object"
    || file === null
    || typeof file.path !== "string"
    || typeof file.text !== "boolean"
    || typeof file.contentsBase64 !== "string"
  ) throw new Error("Native project file has an invalid shape.");
  const path = parseProjectPath(file.path);
  const bytes = decodeBase64(file.contentsBase64);
  return [
    path,
    file.text ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : bytes,
  ];
}

function decodeFiles(files: readonly ProjectFileWire[]): ReadonlyMap<string, ProjectFileContent> {
  const decoded = new Map<string, ProjectFileContent>();
  for (const file of files) {
    const [path, content] = decodeFile(file);
    if (decoded.has(path)) throw new Error(`Native project snapshot repeats ${path}.`);
    decoded.set(path, content);
  }
  return decoded;
}

function wireContent(content: ProjectFileContent) {
  const text = typeof content === "string";
  const bytes = text ? new TextEncoder().encode(content) : content;
  return { text, contentsBase64: encodeBase64(bytes) };
}

export function createTauriProjectStorage(invokeCommand: Invoke = invoke): ProjectStorage {
  return {
    snapshot: async (projectId) => {
      const files = await invokeCommand<ProjectFileWire[]>("project_snapshot", { projectId });
      if (!Array.isArray(files)) throw new Error("Native project snapshot must be a file list.");
      const decoded = decodeFiles(files);
      const workspaceIdentity = await opaqueWorkspaceIdentity(invokeCommand, projectId);
      return createProjectSnapshot(projectId, decoded, workspaceIdentity);
    },
    read: async (projectId, requestedPath) => {
      const path = parseProjectPath(requestedPath);
      const file = await invokeCommand<ProjectFileWire | null>("project_read", { projectId, path });
      if (file === null) return undefined;
      const [returnedPath, content] = decodeFile(file);
      if (returnedPath !== path) throw new Error("Native project read returned the wrong file.");
      return content;
    },
    write: async (projectId, path, content) => {
      await invokeCommand("project_write", {
        projectId,
        path: parseProjectPath(path),
        ...wireContent(content),
      });
    },
    move: async (projectId, from, to) => {
      await invokeCommand("project_move", {
        projectId,
        from: parseProjectPath(from),
        to: parseProjectPath(to),
      });
    },
    trash: async (projectId, path) => {
      await invokeCommand("project_trash", { projectId, path: parseProjectPath(path) });
    },
    reveal: async (projectId, path) => {
      await invokeCommand("project_reveal", { projectId, path: parseProjectPath(path) });
    },
  };
}
