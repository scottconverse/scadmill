import { useSyncExternalStore } from "react";

import type { ReadonlyStore } from "../application/runtime/workbench-runtime";

export function useReadonlyStore<T, Selected>(
  store: ReadonlyStore<T>,
  selector: (state: T) => Selected,
): Selected {
  return useSyncExternalStore(
    (notify) => store.subscribe(() => notify()),
    () => selector(store.getState()),
    () => selector(store.getInitialState()),
  );
}
