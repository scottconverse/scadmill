import { parseProjectPath } from "../files/project-path";
import { isSha256GeometryIdentity } from "../geometry/geometry-identity";

export const MAX_RENDER_THUMBNAIL_BYTES = 256 * 1024;
export const MAX_RENDER_THUMBNAIL_WORKSPACE_BYTES = 8 * 1024 * 1024;
export const MAX_RENDER_THUMBNAILS_PER_WORKSPACE = 100;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export interface RenderThumbnailRecord {
  readonly documentPath: string;
  readonly renderIdentity: string;
  readonly capturedAt: string;
  readonly pngBytes: Uint8Array;
}

export interface RenderThumbnailPersistence {
  load(workspaceIdentity: string): readonly RenderThumbnailRecord[];
  save(workspaceIdentity: string, thumbnail: RenderThumbnailRecord): void;
  clear(workspaceIdentity: string): void;
  subscribe?(listener: () => void): () => void;
}

export function validateRenderThumbnailRecord(record: RenderThumbnailRecord): RenderThumbnailRecord {
  const documentPath = parseProjectPath(record.documentPath);
  if (!isSha256GeometryIdentity(record.renderIdentity)) {
    throw new Error("Thumbnail render identity must be a canonical SHA-256 identity.");
  }
  if (Number.isNaN(Date.parse(record.capturedAt))) {
    throw new Error("Thumbnail capture time must be a timestamp.");
  }
  if (!(record.pngBytes instanceof Uint8Array)
    || record.pngBytes.byteLength < PNG_SIGNATURE.length
    || record.pngBytes.byteLength > MAX_RENDER_THUMBNAIL_BYTES
    || !PNG_SIGNATURE.every((value, index) => record.pngBytes[index] === value)) {
    throw new Error("Thumbnail PNG is invalid or exceeds the supported size.");
  }
  return { documentPath, renderIdentity: record.renderIdentity, capturedAt: record.capturedAt, pngBytes: record.pngBytes.slice() };
}

export const EPHEMERAL_RENDER_THUMBNAIL_PERSISTENCE: RenderThumbnailPersistence = Object.freeze({
  load: () => [],
  save: () => undefined,
  clear: () => undefined,
});

export function thumbnailDataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}
