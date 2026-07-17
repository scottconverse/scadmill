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
    const port: McpServerPort = {
      setEnabled: vi.fn().mockResolvedValue(undefined),
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
    view.unmount();
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
    expect(port.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it("exposes queued mutation reviews and removes them only when explicitly approved or denied", async () => {
    let receive: ((chunk: string) => void) | undefined;
    const port: McpServerPort = {
      setEnabled: vi.fn().mockResolvedValue(undefined),
      subscribeRequests: vi.fn().mockImplementation(async (listener) => { receive = listener; return () => undefined; }),
      writeResponse: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createWorkbenchRuntime({} as EngineService, { initialScratchSource: "cube(1);" });
    const view = renderHook(() => useMcpStdio(runtime, undefined, port));
    act(() => view.result.current.setEnabled(true));
    await waitFor(() => expect(receive).toBeDefined());
    await act(async () => {
      receive?.('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"write_file","arguments":{"path":"main.scad","content":"cube(2);"}}}\n');
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
      subscribeRequests: vi.fn().mockImplementation(async (listener) => { receive = listener; return () => undefined; }),
      writeResponse: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = createWorkbenchRuntime({} as EngineService, { initialScratchSource: "cube(1);" });
    const capture = vi.fn().mockResolvedValue(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10));
    const view = renderHook(() => useMcpStdio(runtime, undefined, port, capture));
    act(() => view.result.current.setEnabled(true));
    await waitFor(() => expect(receive).toBeDefined());
    receive?.('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"take_screenshot","arguments":{"width":640,"height":480}}}\n');

    await waitFor(() => expect(port.writeResponse).toHaveBeenLastCalledWith(expect.stringContaining("iVBORw0KGgo=")));
    expect(capture).toHaveBeenCalledWith(640, 480);
    runtime.dispose();
  });
});
