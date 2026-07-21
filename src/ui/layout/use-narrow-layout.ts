import { useMemo, useSyncExternalStore } from "react";

export interface NarrowLayoutQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

export const NARROW_LAYOUT_QUERY = "(width < 900px)";

const FALLBACK_QUERY: NarrowLayoutQuery = {
  matches: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

function createBrowserQuery(): NarrowLayoutQuery {
  const media = globalThis.matchMedia?.(NARROW_LAYOUT_QUERY);
  if (!media) return FALLBACK_QUERY;
  return {
    get matches() {
      return media.matches;
    },
    addEventListener: (_type, listener) => media.addEventListener("change", listener),
    removeEventListener: (_type, listener) => media.removeEventListener("change", listener),
  };
}

export function useNarrowLayout(
  injectedQuery?: NarrowLayoutQuery,
  forceNarrow = false,
): boolean {
  const query = useMemo(() => injectedQuery ?? createBrowserQuery(), [injectedQuery]);
  const matchesWidth = useSyncExternalStore(
    (notify) => {
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => query.matches,
    () => false,
  );
  return forceNarrow || matchesWidth;
}
