import type { EngineLoadProgressStore } from "../../application/engine/engine-load-progress";
import { messages } from "../../messages/en";
import { useReadonlyStore } from "../use-readonly-store";

export interface WasmEngineProgressBannerProps {
  readonly available: boolean;
  readonly checking: boolean;
  readonly progress: EngineLoadProgressStore;
  readonly failureMessage?: string;
  readonly onRetry?: () => void;
}

export function WasmEngineProgressBanner({
  available,
  checking,
  progress,
  failureMessage = messages.wasmEngineLoadFailed,
  onRetry,
}: WasmEngineProgressBannerProps) {
  const assets = useReadonlyStore(progress, (state) => state.assets);
  if (available) return null;
  if (!checking) {
    return (
      <div className="engine-banner wasm-engine-banner" role="alert">
        <span>{failureMessage}</span>
        {onRetry && (
          <button onClick={onRetry} type="button">{messages.retryWasmEngine}</button>
        )}
      </div>
    );
  }
  return (
    <div className="engine-banner wasm-engine-banner" role="status">
      <span>{messages.wasmEngineLoading}</span>
      {assets.map((asset) => (
        <label key={asset.asset}>
          <span>{asset.asset}</span>
          <progress
            aria-label={messages.wasmEngineAssetProgress(asset.asset)}
            {...(asset.totalBytes === null
              ? {}
              : { max: asset.totalBytes, value: asset.loadedBytes })}
          />
        </label>
      ))}
    </div>
  );
}
