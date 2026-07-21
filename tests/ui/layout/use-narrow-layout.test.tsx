// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  NARROW_LAYOUT_QUERY,
  useNarrowLayout,
  type NarrowLayoutQuery,
} from "../../../src/ui/layout/use-narrow-layout";

class FakeNarrowLayoutQuery implements NarrowLayoutQuery {
  matches: boolean;
  readonly listeners = new Set<() => void>();

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(_type: "change", listener: () => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "change", listener: () => void) {
    this.listeners.delete(listener);
  }

  emit(matches: boolean) {
    this.matches = matches;
    for (const listener of this.listeners) listener();
  }
}

describe("useNarrowLayout", () => {
  it("tracks the 900px breakpoint and removes its host listener on unmount", () => {
    expect(NARROW_LAYOUT_QUERY).toBe("(width < 900px)");
    const query = new FakeNarrowLayoutQuery(false);
    const view = renderHook(() => useNarrowLayout(query));

    expect(view.result.current).toBe(false);
    expect(query.listeners).toHaveLength(1);

    act(() => query.emit(true));
    expect(view.result.current).toBe(true);

    view.unmount();
    expect(query.listeners).toHaveLength(0);
  });

  it("defaults to narrow for a mobile web host at any width", () => {
    const query = new FakeNarrowLayoutQuery(false);
    const view = renderHook(() => useNarrowLayout(query, true));

    expect(view.result.current).toBe(true);
    act(() => query.emit(false));
    expect(view.result.current).toBe(true);
  });
});
