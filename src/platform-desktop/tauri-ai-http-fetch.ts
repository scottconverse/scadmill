import { Channel, invoke as tauriInvoke } from "@tauri-apps/api/core";

import type { AiFetchFactory } from "../application/ai/ai-client";

const REQUEST_SIZE_LIMIT = 8 * 1024 * 1024;
const DEFAULT_TERMINAL_EVENT_GRACE_MS = 1_000;
const MAX_TERMINAL_EVENT_GRACE_MS = 10_000;
const SAFE_REQUEST_HEADERS = new Set(["authorization", "anthropic-version", "content-type", "x-api-key"]);

export type AiHttpChannelFactory = (onMessage: (event: unknown) => void) => unknown;
export type AiHttpInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function abortError(): DOMException {
  return new DOMException("The AI request was cancelled.", "AbortError");
}

function decodeBase64(value: string): Uint8Array {
  const decoded = globalThis.atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function responseHeaders(value: unknown): [string, string][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const headers: [string, string][] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2
      || typeof entry[0] !== "string" || typeof entry[1] !== "string") return undefined;
    headers.push([entry[0], entry[1]]);
  }
  return headers;
}

function requestHeaders(headers: HeadersInit | undefined): readonly (readonly [string, string])[] {
  const normalized = [...new Headers(headers).entries()];
  for (const [name] of normalized) {
    if (!SAFE_REQUEST_HEADERS.has(name)) throw new Error(`AI HTTP header is not permitted: ${name}`);
  }
  return normalized;
}

const createChannel: AiHttpChannelFactory = (onMessage) =>
  typeof globalThis.window === "undefined" ? { onmessage: onMessage } : new Channel(onMessage);

export function createTauriAiFetchFactory(
  invokeCommand: AiHttpInvoke = tauriInvoke,
  channelFactory: AiHttpChannelFactory = createChannel,
  terminalEventGraceMs = DEFAULT_TERMINAL_EVENT_GRACE_MS,
): AiFetchFactory {
  if (!Number.isSafeInteger(terminalEventGraceMs) || terminalEventGraceMs < 1 || terminalEventGraceMs > MAX_TERMINAL_EVENT_GRACE_MS) {
    throw new Error(`Desktop AI HTTP terminal-event grace must be an integer from 1 to ${MAX_TERMINAL_EVENT_GRACE_MS} milliseconds.`);
  }
  return (configurationId) => async (input, init = {}) => {
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "POST") throw new Error("Desktop AI HTTP requests must use POST.");
    if (input instanceof Request) throw new Error("Desktop AI HTTP requests require an explicit endpoint and body.");
    if (typeof init.body !== "string") throw new Error("Desktop AI HTTP request body must be JSON text.");
    if (new TextEncoder().encode(init.body).byteLength > REQUEST_SIZE_LIMIT) {
      throw new Error("Desktop AI HTTP request exceeds the supported size.");
    }
    const signal = init.signal;
    if (signal?.aborted) throw abortError();
    const endpoint = input instanceof URL ? input.toString() : input;
    const requestId = globalThis.crypto.randomUUID();
    let settled = false;
    let responseStarted = false;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let terminalEventTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveResponse!: (response: Response) => void;
    let rejectResponse!: (reason: unknown) => void;
    const response = new Promise<Response>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const finish = () => {
      if (settled) return false;
      settled = true;
      if (terminalEventTimer !== undefined) clearTimeout(terminalEventTimer);
      signal?.removeEventListener("abort", onAbort);
      return true;
    };
    const fail = (reason: unknown) => {
      if (!finish()) return;
      if (responseStarted) streamController?.error(reason);
      else rejectResponse(reason);
    };
    const onAbort = () => {
      void invokeCommand("cancel_ai_http_request", { requestId }).catch(() => undefined);
      fail(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const onEvent = (event: unknown) => {
      if (settled) return;
      if (!record(event) || typeof event.kind !== "string") {
        return fail(new Error("Desktop AI HTTP response emitted an invalid event."));
      }
      if (event.kind === "start") {
        if (responseStarted) return fail(new Error("Desktop AI HTTP response started more than once."));
        const headers = responseHeaders(event.headers);
        if (!Number.isSafeInteger(event.status) || (event.status as number) < 200
          || (event.status as number) > 599 || headers === undefined) {
          return fail(new Error("Desktop AI HTTP response emitted an invalid start event."));
        }
        try {
          const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
          const nextResponse = new Response(body, { status: event.status as number, headers });
          responseStarted = true;
          resolveResponse(nextResponse);
        } catch (error) {
          return fail(error);
        }
        return;
      }
      if (!responseStarted) return fail(new Error("Desktop AI HTTP response body arrived before status."));
      if (event.kind === "chunk") {
        if (typeof event.bytesBase64 !== "string") {
          return fail(new Error("Desktop AI HTTP chunk omitted its bytesBase64 field."));
        }
        try {
          streamController?.enqueue(decodeBase64(event.bytesBase64));
        } catch (error) {
          return fail(error);
        }
      } else if (event.kind === "end") {
        if (finish()) streamController?.close();
      } else {
        fail(new Error(`Desktop AI HTTP response emitted an unsupported event kind: ${event.kind.slice(0, 128)}`));
      }
    };
    void invokeCommand("ai_http_request", {
      request: {
        requestId,
        ...(configurationId ? { configurationId } : {}),
        endpoint,
        method,
        headers: requestHeaders(init.headers),
        body: init.body,
      },
      onEvent: channelFactory(onEvent),
    }).then(() => {
      if (!settled) {
        terminalEventTimer = setTimeout(() => {
          fail(new Error("Desktop AI HTTP response omitted its terminal event."));
        }, terminalEventGraceMs);
      }
    }, fail);
    return response;
  };
}
