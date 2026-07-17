import type { RenderResult } from "../engine/contracts";

const SHA256_IDENTITY = /^sha256:[0-9a-f]{64}$/u;

export function isSha256GeometryIdentity(value: unknown): value is string {
  return typeof value === "string" && SHA256_IDENTITY.test(value);
}

export async function sha256GeometryIdentity(
  bytes: Uint8Array,
): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  try {
    const digestBytes: Uint8Array<ArrayBuffer> = bytes.buffer instanceof ArrayBuffer
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new Uint8Array(bytes);
    const digest = new Uint8Array(await subtle.digest("SHA-256", digestBytes));
    return `sha256:${[...digest]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
  } catch {
    return undefined;
  }
}

export async function ensureGeometryIdentity(
  result: RenderResult,
  hash: (bytes: Uint8Array) => Promise<string | undefined> = sha256GeometryIdentity,
): Promise<RenderResult> {
  if (result.kind === "failure") return result;
  if (result.kind === "3d") {
    const geometryIdentity = await hash(result.mesh.bytes);
    const mesh = { format: result.mesh.format, bytes: result.mesh.bytes };
    return { ...result, mesh: geometryIdentity ? { ...mesh, geometryIdentity } : mesh };
  }
  const geometryIdentity = await hash(new TextEncoder().encode(result.svg));
  const { geometryIdentity: _engineIdentity, ...withoutIdentity } = result;
  return geometryIdentity ? { ...withoutIdentity, geometryIdentity } : withoutIdentity;
}
