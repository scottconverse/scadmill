const DEFAULT_COMPRESSED_BYTE_LIMIT = 50 * 1024;
const DEFAULT_SOURCE_BYTE_LIMIT = 1024 * 1024;
const FRAGMENT_PREFIX = "scadmill-share=v1.";

export interface ShareLinkLimits {
  readonly compressedByteLimit?: number;
  readonly sourceByteLimit?: number;
}

export interface SharedSource {
  readonly source: string;
  readonly origin: string;
}

export class ShareLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareLinkError";
  }
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new ShareLinkError(`${label} must be a positive integer.`);
  }
  return selected;
}

async function transform(bytes: Uint8Array, stream: TransformStream): Promise<Uint8Array> {
  const input = new Uint8Array(bytes);
  const body = new Blob([input]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

async function transformWithLimit(
  bytes: Uint8Array,
  stream: TransformStream,
  byteLimit: number,
): Promise<Uint8Array> {
  const input = new Uint8Array(bytes);
  const reader = new Blob([input]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      byteLength += chunk.byteLength;
      if (byteLength > byteLimit) {
        await reader.cancel().catch(() => undefined);
        throw new ShareLinkError("The decompressed share-link payload is too large.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new ShareLinkError("The share-link payload is malformed.");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    "=",
  );
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new ShareLinkError("The share-link payload is malformed.");
  }
}

function maximumBase64UrlLength(byteLimit: number): number {
  const completeTriplets = Math.floor(byteLimit / 3);
  const remainderCharacters = [0, 2, 3][byteLimit % 3];
  const encodedLength = completeTriplets * 4 + remainderCharacters;
  return Number.isSafeInteger(encodedLength) ? encodedLength : Number.MAX_SAFE_INTEGER;
}

export async function encodeShareLink(
  source: string,
  baseHref: string,
  limits: ShareLinkLimits = {},
): Promise<string> {
  const sourceLimit = positiveLimit(limits.sourceByteLimit, DEFAULT_SOURCE_BYTE_LIMIT, "Source limit");
  const compressedLimit = positiveLimit(
    limits.compressedByteLimit,
    DEFAULT_COMPRESSED_BYTE_LIMIT,
    "Compressed limit",
  );
  const sourceBytes = new TextEncoder().encode(source);
  if (sourceBytes.length > sourceLimit) {
    throw new ShareLinkError("The source is too large for a share link.");
  }
  const compressed = await transform(sourceBytes, new CompressionStream("gzip"));
  if (compressed.length > compressedLimit) {
    throw new ShareLinkError("The compressed source is too large for a share link.");
  }
  const url = new URL(baseHref);
  url.hash = `${FRAGMENT_PREFIX}${base64UrlEncode(compressed)}`;
  return url.href;
}

export async function decodeShareLink(
  href: string,
  limits: ShareLinkLimits = {},
): Promise<SharedSource> {
  const url = new URL(href);
  const fragment = url.hash.slice(1);
  if (fragment.startsWith("scadmill-share=") && !fragment.startsWith(FRAGMENT_PREFIX)) {
    throw new ShareLinkError("The share-link version is unsupported.");
  }
  if (!fragment.startsWith(FRAGMENT_PREFIX)) {
    throw new ShareLinkError("The URL does not contain a ScadMill share link.");
  }
  const compressedLimit = positiveLimit(
    limits.compressedByteLimit,
    DEFAULT_COMPRESSED_BYTE_LIMIT,
    "Compressed limit",
  );
  const encoded = fragment.slice(FRAGMENT_PREFIX.length);
  if (encoded.length > maximumBase64UrlLength(compressedLimit)) {
    throw new ShareLinkError("The compressed share-link payload is too large.");
  }
  const compressed = base64UrlDecode(encoded);
  if (compressed.length > compressedLimit) {
    throw new ShareLinkError("The compressed share-link payload is too large.");
  }
  const sourceLimit = positiveLimit(limits.sourceByteLimit, DEFAULT_SOURCE_BYTE_LIMIT, "Source limit");
  let sourceBytes: Uint8Array;
  try {
    sourceBytes = await transformWithLimit(
      compressed,
      new DecompressionStream("gzip"),
      sourceLimit,
    );
  } catch (error) {
    if (error instanceof ShareLinkError) throw error;
    throw new ShareLinkError("The share-link payload is malformed.");
  }
  try {
    return {
      source: new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes),
      origin: url.hostname || "local file",
    };
  } catch {
    throw new ShareLinkError("The share-link source is not valid UTF-8.");
  }
}
