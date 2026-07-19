import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EngineService } from "../../application/engine/contracts";
import { createMcpReviewQueue } from "../../application/mcp/mcp-review-queue";
import { createMcpStdioController } from "../../application/mcp/mcp-stdio-controller";
import type { McpPermission, McpToolName } from "../../application/mcp/mcp-tools";
import { createWorkbenchMcpHandler } from "../../application/mcp/workbench-mcp-handler";
import type { McpServerPort } from "../../application/platform/scadmill-platform";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime-contracts";
import { useReadonlyStore } from "../use-readonly-store";

export function useMcpStdio(
  runtime: WorkbenchRuntime,
  engine: EngineService | undefined,
  mcpPort: McpServerPort | undefined,
  captureScreenshot?: (width: number, height: number) => Promise<Uint8Array>,
) {
  const controls = useReadonlyStore(runtime.controls, (state) => state);
  const { mcpEnabled: enabled, mcpPermissions: permissions } = controls;
  const [connected, setConnected] = useState(false);
  const permissionsRef = useRef(permissions);
  permissionsRef.current = permissions;
  const [, setReviewVersion] = useState(0);
  const reviewQueue = useMemo(() => createMcpReviewQueue(), []);
  const setPermission = useCallback((tool: McpToolName, permission: McpPermission) => {
    void runtime.dispatch({
      kind: "set-mcp-permission",
      origin: "user",
      tool,
      permission,
    }).catch(() => undefined);
  }, [runtime]);
  const setEnabled = useCallback((next: boolean) => {
    void runtime.dispatch({
      kind: "set-mcp-enabled",
      origin: "user",
      enabled: next,
    }).catch(() => undefined);
  }, [runtime]);
  const getPermissions = useCallback(() => permissionsRef.current, []);
  const consumePermission = useCallback((tool: Extract<McpToolName, "write_file" | "set_parameters">) => {
    void runtime.dispatch({
      kind: "set-mcp-permission",
      origin: "system",
      tool,
      permission: "deny",
    }).catch(() => undefined);
  }, [runtime]);
  const enqueueReview = useCallback((review: Parameters<typeof reviewQueue.enqueue>[0]) => {
    reviewQueue.enqueue(review);
    setReviewVersion((version) => version + 1);
  }, [reviewQueue]);
  const restoreReview = enqueueReview;
  const dismissReview = useCallback((commandId: string) => {
    const review = reviewQueue.deny(commandId);
    if (review) setReviewVersion((version) => version + 1);
    return review;
  }, [reviewQueue]);
  const approveReview = useCallback((commandId: string) => {
    const review = reviewQueue.approve(commandId);
    if (review) setReviewVersion((version) => version + 1);
    return review;
  }, [reviewQueue]);
  const mcpHandler = useMemo(() => createWorkbenchMcpHandler({
    engine, runtime, captureScreenshot, onPendingReview: enqueueReview,
  }), [captureScreenshot, engine, enqueueReview, runtime]);
  const agentHandler = useMemo(() => createWorkbenchMcpHandler({
    engine, runtime, captureScreenshot, onPendingReview: enqueueReview, mutationOrigin: "ai-panel",
  }), [captureScreenshot, engine, enqueueReview, runtime]);
  const pendingReview = useCallback(
    (commandId: string) => reviewQueue.list().find(({ commandId: id }) => id === commandId),
    [reviewQueue],
  );
  const controller = useMemo(() => mcpPort ? createMcpStdioController({
    handler: mcpHandler,
    getPermissions,
    onMutationPermissionConsumed: consumePermission,
    onResponse: (line) => { void mcpPort.writeResponse(line).catch(() => undefined); },
  }) : undefined, [consumePermission, getPermissions, mcpHandler, mcpPort]);
  useEffect(() => {
    if (!mcpPort || !controller) return;
    if (!enabled) {
      controller.stop();
      setConnected(false);
      void mcpPort.setEnabled(false).catch(() => undefined);
      return;
    }
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeConnection: (() => void) | undefined;
    controller.start();
    void (async () => {
      try {
        const [nextUnsubscribe, nextConnectionUnsubscribe] = await Promise.all([
          mcpPort.subscribeRequests((chunk) => { void controller.receive(chunk); }),
          mcpPort.subscribeConnection((nextConnected) => {
            setConnected(nextConnected);
            if (!nextConnected) {
              controller.stop();
              controller.start();
            }
          }),
        ]);
        if (disposed) {
          nextUnsubscribe();
          nextConnectionUnsubscribe();
          return;
        }
        unsubscribe = nextUnsubscribe;
        unsubscribeConnection = nextConnectionUnsubscribe;
        await mcpPort.setEnabled(true);
        if (disposed) await mcpPort.setEnabled(false);
      } catch {
        unsubscribe?.();
        unsubscribeConnection?.();
        controller.stop();
        setConnected(false);
        if (!disposed) void runtime.dispatch({
          kind: "set-mcp-enabled",
          origin: "system",
          enabled: false,
        }).catch(() => undefined);
      }
    })();
    return () => {
      disposed = true;
      controller.stop();
      unsubscribe?.();
      unsubscribeConnection?.();
      setConnected(false);
      void mcpPort.setEnabled(false).catch(() => undefined);
    };
  }, [controller, enabled, mcpPort, runtime]);
  return { connected, enabled, setEnabled, permissions, setPermission, pendingReviews: reviewQueue.list(), pendingReview, approveReview, restoreReview, dismissReview, agentHandler };
}
