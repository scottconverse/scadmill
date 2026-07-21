import {
  decodeProjectZipAsync,
  encodeProjectZipAsync,
} from "../../../src/application/files/project-zip";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../../../src/application/files/project-snapshot";

const MIB = 1024 * 1024;
const NEAR_LIMIT_ASSET_BYTES = 92 * MIB;

interface MemoryPerformance extends Performance {
  readonly memory?: { readonly usedJSHeapSize: number };
}

export interface PortabilityProfile {
  readonly archiveBytes: number;
  readonly assetBytes: number;
  readonly cancellationMs: number;
  readonly decodedAssetMatches: boolean;
  readonly encodeMs: number;
  readonly decodeMs: number;
  readonly longTaskCount: number;
  readonly longestLongTaskMs: number;
  readonly maximumHeartbeatGapMs: number;
  readonly peakHeapDeltaBytes: number | null;
  readonly sourceAssetStillAttached: boolean;
}

declare global {
  interface Window {
    scadmillPortabilityProfile(): Promise<PortabilityProfile>;
  }
}

async function randomAsset(): Promise<Uint8Array> {
  const bytes = new Uint8Array(NEAR_LIMIT_ASSET_BYTES);
  const maximumRandomChunk = 65_536;
  for (let offset = 0; offset < bytes.byteLength; offset += maximumRandomChunk) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(bytes.byteLength, offset + maximumRandomChunk)));
    if (offset % MIB === 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }
  return bytes;
}

window.scadmillPortabilityProfile = async () => {
  const asset = await randomAsset();
  const snapshot = createProjectSnapshot("near-limit", new Map<string, ProjectFileContent>([
    ["main.scad", "import(\"assets/reference.bin\");\n"],
    ["assets/reference.bin", asset],
  ]));

  const cancellation = new AbortController();
  const cancellationStartedAt = performance.now();
  const cancelled = encodeProjectZipAsync(snapshot, { signal: cancellation.signal });
  globalThis.setTimeout(() => cancellation.abort(), 10);
  await cancelled.catch((reason: unknown) => {
    if (!(reason instanceof Error) || reason.name !== "AbortError") throw reason;
  });
  const cancellationMs = performance.now() - cancellationStartedAt;

  const longTasks: number[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  });
  observer.observe({ type: "longtask", buffered: false });
  const memory = performance as MemoryPerformance;
  const initialHeap = memory.memory?.usedJSHeapSize;
  let peakHeap = initialHeap;
  let previousHeartbeat = performance.now();
  let maximumHeartbeatGapMs = 0;
  const heartbeat = globalThis.setInterval(() => {
    const now = performance.now();
    maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, now - previousHeartbeat);
    previousHeartbeat = now;
    if (memory.memory && (peakHeap === undefined || memory.memory.usedJSHeapSize > peakHeap)) {
      peakHeap = memory.memory.usedJSHeapSize;
    }
  }, 10);

  const encodeStartedAt = performance.now();
  const archive = await encodeProjectZipAsync(snapshot);
  const encodeMs = performance.now() - encodeStartedAt;
  const decodeStartedAt = performance.now();
  const decoded = await decodeProjectZipAsync("near-limit-decoded", archive);
  const decodeMs = performance.now() - decodeStartedAt;

  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 50));
  globalThis.clearInterval(heartbeat);
  observer.disconnect();
  const decodedAsset = decoded.files.get("assets/reference.bin" as never);
  return {
    archiveBytes: archive.byteLength,
    assetBytes: asset.byteLength,
    cancellationMs,
    decodedAssetMatches: decodedAsset instanceof Uint8Array
      && decodedAsset.byteLength === asset.byteLength
      && decodedAsset[0] === asset[0]
      && decodedAsset[decodedAsset.byteLength - 1] === asset[asset.byteLength - 1],
    encodeMs,
    decodeMs,
    longTaskCount: longTasks.length,
    longestLongTaskMs: Math.max(0, ...longTasks),
    maximumHeartbeatGapMs,
    peakHeapDeltaBytes: initialHeap === undefined || peakHeap === undefined
      ? null
      : peakHeap - initialHeap,
    sourceAssetStillAttached: asset.byteLength === NEAR_LIMIT_ASSET_BYTES,
  };
};
