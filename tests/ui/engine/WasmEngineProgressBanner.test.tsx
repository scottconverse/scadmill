// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { messages } from "../../../src/messages/en";
import { createBrowserWasmEngineProgressStore } from "../../../src/platform-web/browser-wasm-engine";
import { WasmEngineProgressBanner } from "../../../src/ui/engine/WasmEngineProgressBanner";

describe("WasmEngineProgressBanner", () => {
  it("shows cache-neutral loading progress only while checking", () => {
    const progress = createBrowserWasmEngineProgressStore();
    const view = render(
      <WasmEngineProgressBanner
        available={false}
        checking
        progress={progress}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(messages.wasmEngineLoading);
    expect(screen.queryByText(/download/iu)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    act(() => {
      progress.record({ asset: "openscad.wasm", loadedBytes: 25, totalBytes: 100 });
    });
    const meter = screen.getByRole("progressbar", {
      name: messages.wasmEngineAssetProgress("openscad.wasm"),
    });
    expect(meter).toHaveAttribute("value", "25");
    expect(meter).toHaveAttribute("max", "100");

    view.rerender(
      <WasmEngineProgressBanner
        available
        checking={false}
        progress={progress}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByText(messages.wasmEngineLoading)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("offers one explicit retry after a web-engine load failure", () => {
    const retry = vi.fn();
    const progress = createBrowserWasmEngineProgressStore();
    render(
      <WasmEngineProgressBanner
        available={false}
        checking={false}
        progress={progress}
        onRetry={retry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(messages.wasmEngineLoadFailed);
    fireEvent.click(screen.getByRole("button", { name: messages.retryWasmEngine }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("reports a deterministic version mismatch without offering a futile retry", () => {
    const progress = createBrowserWasmEngineProgressStore();
    render(
      <WasmEngineProgressBanner
        available={false}
        checking={false}
        failureMessage="OpenSCAD version mismatch"
        progress={progress}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("OpenSCAD version mismatch");
    expect(screen.queryByRole("button", { name: messages.retryWasmEngine }))
      .not.toBeInTheDocument();
  });
});
