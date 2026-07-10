export interface DeferredAction {
  schedule(delayMs: number): void;
  clear(): void;
}

export function createDeferredAction(action: () => void): DeferredAction {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  return {
    schedule(delayMs) {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(() => {
        timer = undefined;
        action();
      }, delayMs);
    },
    clear() {
      if (timer === undefined) return;
      globalThis.clearTimeout(timer);
      timer = undefined;
    },
  };
}
