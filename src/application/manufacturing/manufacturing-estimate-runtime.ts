import engineAssetUrl from "../../vendor/kiri-moto/4.7.1/run/engine.js?url";
import minionAssetUrl from "../../vendor/kiri-moto/4.7.1/run/minion.js?url";
import workerAssetUrl from "../../vendor/kiri-moto/4.7.1/run/worker.js?url";
import manifoldAssetUrl from "../../vendor/kiri-moto/4.7.1/wasm/manifold.wasm?url";
import type { MeshFormat } from "../engine/contracts";
import {
  estimateWithKiriMoto,
  type KiriMotoEngine,
  type KiriMotoEngineFactory,
} from "./kiri-moto-estimator";
import type { ManufacturingEstimate } from "./manufacturing-estimate";
import { manufacturingEstimateProfile } from "./manufacturing-estimate";
import { prepareManufacturingEstimateStlOffThread } from "./manufacturing-estimate-worker-client";

interface KiriMotoModule {
  readonly Engine: new (options: {
    readonly workURL: string;
    readonly poolURL: string;
  }) => KiriMotoEngine;
}

export interface ManufacturingEstimateRuntimeDependencies {
  readonly createEngine?: KiriMotoEngineFactory;
  readonly prepareStl?: (
    bytes: Uint8Array,
    format: MeshFormat,
    signal?: AbortSignal,
  ) => Promise<Uint8Array>;
}

let importedEngine: Promise<KiriMotoModule> | undefined;

function localAssetUrl(value: string): string {
  const resolved = new URL(value, globalThis.location.href);
  if (resolved.origin !== globalThis.location.origin) {
    throw new Error("A manufacturing estimate runtime asset is not same-origin.");
  }
  return resolved.href;
}

async function importKiriMoto(): Promise<KiriMotoModule> {
  const engineUrl = localAssetUrl(engineAssetUrl);
  const manifoldUrl = localAssetUrl(manifoldAssetUrl);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const requested = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
      globalThis.location.href,
    );
    return requested.origin === globalThis.location.origin
      && requested.pathname.endsWith("/wasm/manifold.wasm")
      ? nativeFetch(manifoldUrl, init)
      : nativeFetch(input, init);
  };
  try {
    const imported = await import(/* @vite-ignore */ engineUrl) as unknown as KiriMotoModule;
    if (typeof imported.Engine !== "function") {
      throw new Error("The embedded Kiri:Moto engine could not load.");
    }
    return imported;
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

async function defaultEngineFactory(): Promise<KiriMotoEngineFactory> {
  importedEngine ??= importKiriMoto().catch((error) => {
    importedEngine = undefined;
    throw error;
  });
  const imported = await importedEngine;
  const workURL = localAssetUrl(workerAssetUrl);
  const poolURL = localAssetUrl(minionAssetUrl);
  return () => new imported.Engine({ workURL, poolURL });
}

export async function runManufacturingEstimate(
  bytes: Uint8Array,
  format: MeshFormat,
  profileId: string,
  signal?: AbortSignal,
  dependencies: ManufacturingEstimateRuntimeDependencies = {},
): Promise<ManufacturingEstimate> {
  const profile = manufacturingEstimateProfile(profileId);
  const prepare = dependencies.prepareStl
    ?? ((source, sourceFormat, activeSignal) => prepareManufacturingEstimateStlOffThread(
      source,
      sourceFormat,
      undefined,
      activeSignal,
    ));
  const stl = await prepare(bytes, format, signal);
  if (signal?.aborted) {
    const error = new Error("The manufacturing estimate was cancelled.");
    error.name = "AbortError";
    throw error;
  }
  const createEngine = dependencies.createEngine ?? await defaultEngineFactory();
  return estimateWithKiriMoto(stl, profile, createEngine);
}
