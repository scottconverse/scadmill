import { useCallback, useRef, useSyncExternalStore } from "react";

import type { ReadonlyStore } from "../application/runtime/workbench-runtime";

export function useReadonlyStore<T, Selected>(
  store: ReadonlyStore<T>,
  selector: (state: T) => Selected,
  isEqual: (left: Selected, right: Selected) => boolean = Object.is,
): Selected {
  const previous = useRef<{ readonly value: Selected } | undefined>(undefined);
  const select = useCallback((state: T) => {
    const value = selector(state);
    if (previous.current && isEqual(previous.current.value, value)) {
      return previous.current.value;
    }
    previous.current = { value };
    return value;
  }, [isEqual, selector]);
  return useSyncExternalStore(
    (notify) => store.subscribe(() => notify()),
    () => select(store.getState()),
    () => select(store.getInitialState()),
  );
}
