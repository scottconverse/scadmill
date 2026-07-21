// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { App as ProductionApp } from "../../src/app/App";
import type { EngineInfo, EngineService, RenderFailure } from "../../src/application/engine/contracts";
import { PINNED_OPENSCAD_VERSION } from "../../src/application/engine/engine-pin";
import { messages } from "../../src/messages/en";
import { createBrowserWasmEngineProgressStore } from "../../src/platform-web/browser-wasm-engine";
import { createTestPlatform, type TestPlatformOverrides } from "../helpers/test-platform";

function App({ engine, ...overrides }: TestPlatformOverrides & { readonly engine: EngineService }) {
  return <ProductionApp platform={createTestPlatform(engine, overrides)} />;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("App browser WASM engine recovery", () => {
  it("preserves the editor and deduplicates a progress-clearing retry to one probe", async () => {
    const retry = deferred<EngineInfo | null>();
    const progress = createBrowserWasmEngineProgressStore();
    const clearProgress = vi.spyOn(progress, "clear");
    progress.record({ asset: "openscad.js", loadedBytes: 50, totalBytes: 100 });
    const renderResult: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [],
      rawLog: "synthetic render result",
    };
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "wasm-render",
        done: Promise.resolve(renderResult),
        subscribeOutput: () => () => undefined,
      }),
      export: vi.fn(),
      version: vi.fn().mockResolvedValueOnce(null).mockReturnValueOnce(retry.promise),
      cancel: vi.fn(),
    };

    const view = render(
      <StrictMode>
        <App
          engine={engine}
          scratchAutosavePersistence={{
            load: () => ({ path: "Untitled", source: "cube(10);" }),
            save: vi.fn(),
          }}
          wasmEngineProgress={progress}
          onRetryWasmEngine={() => progress.clear()}
        />
      </StrictMode>,
    );

    const retryButton = await screen.findByRole("button", { name: messages.retryWasmEngine });
    await waitFor(() => expect(view.container.querySelector(".cm-content")).toBeInTheDocument());
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    expect(clearProgress).toHaveBeenCalledOnce();
    expect(progress.getState().assets).toEqual([]);
    expect(engine.version).toHaveBeenCalledTimes(2);
    expect(screen.getByText(messages.wasmEngineLoading).closest('[role="status"]'))
      .toHaveTextContent(messages.wasmEngineLoading);
    expect(screen.queryByText(messages.wasmEngineLoadFailed)).not.toBeInTheDocument();
    expect(view.container.querySelector(".cm-content")).toBeInTheDocument();

    act(() => {
      progress.record({ asset: "openscad.wasm", loadedBytes: 10, totalBytes: 100 });
    });
    expect(await screen.findByRole("progressbar")).toHaveAttribute("value", "10");
    retry.resolve({ version: PINNED_OPENSCAD_VERSION, path: "wasm", features: [] });

    await waitFor(() => expect(engine.render).toHaveBeenCalledOnce());
    expect(engine.version).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(messages.wasmEngineLoading)).not.toBeInTheDocument();
  });
});
