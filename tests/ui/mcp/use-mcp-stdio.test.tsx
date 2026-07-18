// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import type { McpServerPort } from "../../../src/application/platform/scadmill-platform";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { useMcpStdio } from "../../../src/ui/mcp/use-mcp-stdio";

describe("useMcpStdio", () => {
  it("keeps the desktop bridge off by default, subscribes only after enabling, and closes it on unmount", async () => {
    const unsubscribe = vi.fn();
    let connectionListener: ((connected: boolean) => void) | undefined;
    const port: McpServerPort = {
      setEnabled: vi.fn().mockResolvedValue(undefined),
      subscribeConnection: vi.fn().mockImplementation(async (listener) => { connectionListener = listener; return () => undefined; }),
      subscribeRequests: vi.fn().mockResolvedValue(unsubscribe),
      writeResponse: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createWorkbenchRuntime({} as EngineService, { initialScratchSource: "cube(1);" });
    const engine = {} as EngineService;
    const view = renderHook(() => useMcpStdio(runtime, engine, port));
    await waitFor(() => expect(port.setEnabled).toHaveBeenCalledWith(false));
    expect(port.subscribeRequests).not.toHaveBeenCalled();
    act(() => view.result.current.setEnabled(true));
    await waitFor(() => expect(port.subscribeRequests).toHaveBeenCalledOnce());
    await waitFor(() => expect(port.setEnabled).toHaveBeenCalledWith(true));
    act(() => connectionListener?.(true));
    expect(view.result.current.connected).toBe(true);
    expect(vi.mocked(port.subscribeRequests).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(port.setEnabled).mock.invocationCallOrder.find((_, index) =>
        vi.mocked(port.setEnabled).mock.calls[index]?.[0] === true,
      ) ?? Number.POSITIVE_INFINITY,
    );
    view.unmount();
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
    expect(port.setEnabled).toHaveBeenLastCalledWith(false);
    expect(view.result.current.permissions.write_file).toBe("deny");
    expect(view.result.current.permissions.set_parameters).toBe("deny");
  });

  it("closes a native endpoint whose enable call finishes after unmount", async () => {
    let releaseEnable: (() => void) | undefined;
    const enableGate = new Promise<void>((resolve) => { releaseEnable = resolve; });
    const completions: boolean[] = [];
    const port: McpServerPort = {
      setEnabled: vi.fn().mockImplementation(async (enabled: boolean) => {
        if (enabled) await enableGate;
        completions.push(enabled);
      }),
      subscribeConnection: vi.fn().mockResolvedValue(() => undefined),
      subscribeRequests: vi.fn().mockResolvedValue(() => undefined),
      writeResponse: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createWorkbenchRuntime({} as EngineService, { initialScratchSource: "cube(1);" });
    const view = renderHook(() => useMcpStdio(runtime, undefined, port));
    act(() => view.result.current.setEnabled(true));
    await waitFor(() => expect(port.setEnabled).toHaveBeenCalledWith(true));
    view.unmount();
    await waitFor(() => expect(completions).toContain(false));
    releaseEnable?.();
    await waitFor(() => expect(completions).toEqual([false, false, true, false]));
    runtime.dispose();
  });

  it("requires every successive authenticated client to initialize its own MCP session", async () => {
    let connectionListener: ((connected: boolean) => void) | undefined;
    let receive: ((chunk: string) => void) | undefined;
    const port: McpServerPort = {
      setEnabled: vi.fn().mockResolvedValue(undefined),
      subscribeConnection: vi.fn().mockImplementation(async (listener) => {
        connectionListener = listener;
        return () => undefined;
      }),
      subscribeRequests: vi.fn().mockImplementation(async (listener) => {
        receive = listener;
        return () => undefined;
      }),
      writeResponse: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createWorkbenchRuntime({} as EngineService, {
      initialScratchSource: "cube(1);",
    });
    const view = renderHook(() => useMcpStdio(runtime, undefined, port));
    act(() => view.result.current.setEnabled(true));
    await waitFor(() => expect(receive).toBeDefined());

    receive?.([
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"client-a","version":"1"}}}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
      "",
    ].join("\n"));
    await waitFor(() => expect(port.writeResponse).toHaveBeenLastCalledWith(
      expect.stringContaining('"id":2'),
    ));

    act(() => connectionListener?.(false));
    receive?.('{"jsonrpc":"2.0","id":3,"method":"tools/list"}\n');
    await waitFor(() => expect(port.writeResponse).toHaveBeenLastCalledWith(
      expect.stringContaining('"code":-32002'),
    ));
    receive?.('{"jsonrpc":"2.0","id":4,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"client-b","version":"1"}}}\n');
    await waitFor(() => expect(port.writeResponse).toHaveBeenLastCalledWith(
      expect.stringContaining('"id":4'),
    ));
    expect(vi.mocked(port.writeResponse).mock.calls.at(-1)?.[0]).toContain('"result"');
    view.unmount();
    runtime.dispose();
  });

  it("exposes queued mutation reviews and removes them only when explicitly approved or denied", async () => {
    let receive: ((chunk: string) => void) | undefined;
    const port: McpServerPort = {
      setEnabled: vi.fn().mockResolvedValue(undefined),
      subscribeConnection: vi.fn().mockResolvedValue(() => undefined),
      subscribeRequests: vi.fn().mockImplementation(async (listener) => { receive = listener; return () => undefined; }),
      writeResponse: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createWorkbenchRuntime({} as EngineService, { initialScratchSource: "cube(1);" });
    const view = renderHook(() => useMcpStdio(runtime, undefined, port));
    act(() => view.result.current.setPermission("write_file", "allow-session"));
    act(() => view.result.current.setEnabled(true));
    await waitFor(() => expect(receive).toBeDefined());
    await act(async () => {
      receive?.([
        '{"jsonrpc":"2.0","id":10,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}',
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"write_file","arguments":{"path":"main.scad","content":"cube(2);"}}}',
        "",
      ].join("\n"));
    });
    await waitFor(() => expect(port.writeResponse).toHaveBeenCalled());
    expect(port.writeResponse).toHaveBeenLastCalledWith(expect.stringContaining("mcp-review-"));
    await waitFor(() => expect(view.result.current.pendingReviews).toHaveLength(1));
    const review = view.result.current.pendingReviews[0];
    expect(review?.tool).toBe("write_file");
    if (!review) throw new Error("Expected a queued MCP review.");
    act(() => view.result.current.dismissReview(review.commandId));
    expect(view.result.current.pendingReviews).toHaveLength(0);
    runtime.dispose();
  });

  it("routes a live viewport capture through stdio as the normative base64 PNG response", async () => {
    let receive: ((chunk: string) => void) | undefined;
    const port: McpServerPort = {
      setEnabled: vi.fn().mockResolvedValue(undefined),
      subscribeConnection: vi.fn().mockResolvedValue(() => undefined),
      subscribeRequests: vi.fn().mockImplementation(async (listener) => { receive = listener; return () => undefined; }),
      writeResponse: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createWorkbenchRuntime({} as EngineService, { initialScratchSource: "cube(1);" });
    const capture = vi.fn().mockResolvedValue(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10));
    const view = renderHook(() => useMcpStdio(runtime, undefined, port, capture));
    act(() => view.result.current.setEnabled(true));
    await waitFor(() => expect(receive).toBeDefined());
    receive?.([
      '{"jsonrpc":"2.0","id":10,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"take_screenshot","arguments":{"width":640,"height":480}}}',
      "",
    ].join("\n"));

    await waitFor(() => expect(port.writeResponse).toHaveBeenLastCalledWith(expect.stringContaining("iVBORw0KGgo=")));
    expect(capture).toHaveBeenCalledWith(640, 480);
    runtime.dispose();
  });
});
