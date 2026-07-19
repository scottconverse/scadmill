import { Channel, invoke as tauriInvoke } from "@tauri-apps/api/core";

import type { AiFetchFactory } from "../application/ai/ai-client";

const REQUEST_SIZE_LIMIT = 8 * 1024 * 1024;
const SAFE_REQUEST_HEADERS = new Set(["authorization", "anthropic-version", "content-type", "x-api-key"]);

type AiHttpEvent =
  | { readonly kind: "start"; readonly status: number; readonly headers: readonly (readonly [string, string])[] }
  | { readonly kind: "chunk"; readonly bytesBase64: string }
  | { readonly kind: "end" };

export type AiHttpChannelFactory = (onMessage: (event: AiHttpEvent) => void) => unknown;
export type AiHttpInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function abortError(): DOMException {
  return new DOMException("The AI request was cancelled.", "AbortError");
}

function decodeBase64(value: string): Uint8Array {
  const decoded = globalThis.atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
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
): AiFetchFactory {
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
    let resolveResponse!: (response: Response) => void;
    let rejectResponse!: (reason: unknown) => void;
    const response = new Promise<Response>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const finish = () => {
      if (settled) return false;
      settled = true;
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
    const onEvent = (event: AiHttpEvent) => {
      if (settled) return;
      if (event.kind === "start") {
        if (responseStarted) return fail(new Error("Desktop AI HTTP response started more than once."));
        responseStarted = true;
        const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
        resolveResponse(new Response(body, { status: event.status, headers: event.headers.map(([name, value]): [string, string] => [name, value]) }));
        return;
      }
      if (!responseStarted) return fail(new Error("Desktop AI HTTP response body arrived before status."));
      if (event.kind === "chunk") streamController?.enqueue(decodeBase64(event.bytesBase64));
      else if (finish()) streamController?.close();
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
      if (!settled) fail(new Error("Desktop AI HTTP response omitted its terminal event."));
    }, fail);
    return response;
  };
}
