// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { createStore } from "zustand/vanilla";
import { describe, expect, it } from "vitest";

import type { RenderState } from "../../src/application/runtime/workbench-runtime-contracts";
import { sameRenderStateExceptCached } from "../../src/ui/render/render-state-view";
import { useReadonlyStore } from "../../src/ui/use-readonly-store";

describe("useReadonlyStore equality", () => {
  it("suppresses cache-marker-only parent renders but publishes material render changes", () => {
    const store = createStore<RenderState>(() => ({ status: "success", cached: false }));
    let renderCount = 0;
    const view = renderHook(() => {
      renderCount += 1;
      return useReadonlyStore(store, (state) => state, sameRenderStateExceptCached);
    });

    act(() => store.setState({ status: "success", cached: true }, true));
    expect(renderCount).toBe(1);
    expect(view.result.current.cached).toBe(false);

    act(() => store.setState({ status: "rendering", cached: false }, true));
    expect(renderCount).toBe(2);
    expect(view.result.current.status).toBe("rendering");
  });
});
