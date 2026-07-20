// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import { createStore } from "zustand/vanilla";
import { describe, expect, it } from "vitest";

import type { RenderSuccess3D } from "../../../src/application/engine/contracts";
import type { RenderState } from "../../../src/application/runtime/workbench-runtime-contracts";
import { RenderStatusText } from "../../../src/ui/render/RenderStatusText";

const result: RenderSuccess3D = {
  kind: "3d",
  mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
  stats: { triangles: 1, engineTimeMs: 1 },
  diagnostics: [],
  rawLog: "rendered",
};

describe("RenderStatusText", () => {
  it("publishes the cached marker through its lightweight direct subscription", () => {
    const store = createStore<RenderState>(() => ({
      status: "success",
      cached: false,
      entryFile: "main.scad",
      result,
    }));
    render(<span data-testid="status"><RenderStatusText
      documentPath="main.scad"
      renderStore={store}
      stale={false}
    /></span>);
    expect(screen.getByTestId("status")).toHaveTextContent("Rendered main.scad (3d)");

    act(() => store.setState({ ...store.getState(), cached: true }, true));
    expect(screen.getByTestId("status")).toHaveTextContent("Rendered main.scad (3d, cached)");
  });

  it("does not claim a successful result is rendered before its first presentation frame", () => {
    const store = createStore<RenderState>(() => ({
      status: "success",
      cached: false,
      entryFile: "main.scad",
      result,
    }));
    render(<span data-testid="status"><RenderStatusText
      documentPath="main.scad"
      presentationStatus="presenting"
      renderStore={store}
      stale={false}
    /></span>);

    expect(screen.getByTestId("status")).toHaveTextContent("Presenting main.scad");
    expect(screen.getByTestId("status")).not.toHaveTextContent("Rendered");
  });

  it("reports a terminal display failure instead of remaining in Presenting", () => {
    const store = createStore<RenderState>(() => ({
      status: "success",
      cached: false,
      entryFile: "main.scad",
      result,
    }));
    render(<span data-testid="status"><RenderStatusText
      documentPath="main.scad"
      presentationStatus="failed"
      renderStore={store}
      stale={false}
    /></span>);

    expect(screen.getByTestId("status")).toHaveTextContent("Could not display main.scad");
  });

  it("discloses when the pinned viewer mode intentionally hides the result", () => {
    const store = createStore<RenderState>(() => ({
      status: "success",
      cached: true,
      entryFile: "main.scad",
      result,
    }));
    render(<span data-testid="status"><RenderStatusText
      documentPath="main.scad"
      presentationStatus="skipped"
      renderStore={store}
      stale={false}
    /></span>);

    expect(screen.getByTestId("status")).toHaveTextContent(
      "Rendered main.scad (3d, cached) - hidden by viewer mode",
    );
  });

  it("distinguishes a completed result that was intentionally withheld from the viewer", () => {
    const store = createStore<RenderState>(() => ({
      status: "success",
      cached: false,
      entryFile: "background.scad",
      result,
    }));
    render(<span data-testid="status"><RenderStatusText
      documentPath="main.scad"
      presentationStatus="withheld"
      renderStore={store}
      stale
    /></span>);

    expect(screen.getByTestId("status")).toHaveTextContent(
      "Render complete background.scad (3d, stale) - not displayed",
    );
  });
});
