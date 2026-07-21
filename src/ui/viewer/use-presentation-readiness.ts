import { useCallback, useEffect, useRef, useState } from "react";

const PRESENTATION_TIMEOUT_MS = 10_000;

export type PresentationStatus = "presenting" | "ready" | "failed" | "skipped";

interface PresentationWaiter {
  onAbort?: () => void;
  reject(reason: Error): void;
  resolve(): void;
  signal?: AbortSignal;
  timer: ReturnType<typeof setTimeout>;
}

function cancellationError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function usePresentationReadiness(token?: string, skipped = false) {
  const expectedToken = useRef(token);
  const skippedRef = useRef(skipped);
  const terminalRef = useRef<{ token: string; status: "ready" | "failed" } | undefined>(undefined);
  const waiters = useRef(new Map<string, Set<PresentationWaiter>>());
  const [terminal, setTerminal] = useState<{ token: string; status: "ready" | "failed" }>();
  expectedToken.current = token;
  skippedRef.current = skipped;
  const removeWaiter = useCallback((target: string, waiter: PresentationWaiter) => {
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
    const pending = waiters.current.get(target);
    pending?.delete(waiter);
    if (pending?.size === 0) waiters.current.delete(target);
  }, []);
  const settle = useCallback((target: string, error?: Error) => {
    for (const waiter of [...(waiters.current.get(target) ?? [])]) {
      removeWaiter(target, waiter);
      if (error) waiter.reject(error); else waiter.resolve();
    }
  }, [removeWaiter]);
  const fail = useCallback((target: string, error: Error) => {
    if (target === expectedToken.current) {
      terminalRef.current = { token: target, status: "failed" };
      setTerminal(terminalRef.current);
    }
    settle(target, error);
  }, [settle]);
  const onPresentationReady = useCallback((target: string) => {
    if (target !== expectedToken.current || terminalRef.current?.token === target) return;
    terminalRef.current = { token: target, status: "ready" };
    setTerminal(terminalRef.current);
    settle(target);
  }, [settle]);
  const onPresentationFailed = useCallback((target: string) => {
    if (target !== expectedToken.current) return;
    fail(target, new Error("The rendered result could not be presented."));
  }, [fail]);
  const waitForPresentation = useCallback((target?: string, signal?: AbortSignal): Promise<void> => {
    if (!target || (target === expectedToken.current && skippedRef.current)) return Promise.resolve();
    if (terminalRef.current?.token === target) {
      return terminalRef.current.status === "ready"
        ? Promise.resolve()
        : Promise.reject(new Error("The rendered result could not be presented."));
    }
    if (signal?.aborted) return Promise.reject(cancellationError("Presentation wait was cancelled."));
    return new Promise((resolve, reject) => {
      const waiter: PresentationWaiter = {
        reject,
        resolve,
        signal,
        timer: setTimeout(() => {
          fail(target, new Error("The rendered frame was not presented in time."));
        }, PRESENTATION_TIMEOUT_MS),
      };
      waiter.onAbort = () => {
        removeWaiter(target, waiter);
        reject(cancellationError("Presentation wait was cancelled."));
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      const pending = waiters.current.get(target) ?? new Set<PresentationWaiter>();
      pending.add(waiter);
      waiters.current.set(target, pending);
    });
  }, [fail, removeWaiter]);
  useEffect(() => {
    if (terminalRef.current && terminalRef.current.token !== token) {
      terminalRef.current = undefined;
      setTerminal(undefined);
    }
    for (const target of waiters.current.keys()) {
      if (target !== token) settle(target, cancellationError("The rendered frame was superseded."));
    }
    if (token && skipped) {
      if (terminalRef.current?.token === token) {
        terminalRef.current = undefined;
        setTerminal(undefined);
      }
      settle(token);
    }
  }, [skipped, settle, token]);
  useEffect(() => {
    if (!token || skipped || terminal?.token === token) return;
    const timer = setTimeout(() => {
      fail(token, new Error("The rendered frame was not presented in time."));
    }, PRESENTATION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fail, skipped, terminal, token]);
  useEffect(() => () => {
    for (const target of waiters.current.keys()) {
      settle(target, cancellationError("The viewer was closed before presentation."));
    }
  }, [settle]);
  const presentationStatus: PresentationStatus = skipped
    ? "skipped"
    : token && terminal?.token === token
      ? terminal.status
      : token ? "presenting" : "ready";
  return { onPresentationFailed, onPresentationReady, presentationStatus, waitForPresentation };
}
