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
});
