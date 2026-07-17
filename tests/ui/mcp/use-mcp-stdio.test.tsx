// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import type { McpServerPort } from "../../../src/application/platform/scadmill-platform";
import type { WorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime-contracts";
import { useMcpStdio } from "../../../src/ui/mcp/use-mcp-stdio";

describe("useMcpStdio", () => {
  it("keeps the desktop bridge off by default, subscribes only after enabling, and closes it on unmount", async () => {
    const unsubscribe = vi.fn();
    const port: McpServerPort = {
      setEnabled: vi.fn().mockResolvedValue(undefined),
      subscribeRequests: vi.fn().mockResolvedValue(unsubscribe),
      writeResponse: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = {} as WorkbenchRuntime;
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
});
