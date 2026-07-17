import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EngineService } from "../../application/engine/contracts";
import { createMcpReviewQueue } from "../../application/mcp/mcp-review-queue";
import { createMcpStdioController } from "../../application/mcp/mcp-stdio-controller";
import { DEFAULT_MCP_PERMISSIONS, type McpPermission, type McpToolName, type McpToolPermissionState } from "../../application/mcp/mcp-tools";
import { createWorkbenchMcpHandler } from "../../application/mcp/workbench-mcp-handler";
import type { McpServerPort } from "../../application/platform/scadmill-platform";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime-contracts";

export function useMcpStdio(
  runtime: WorkbenchRuntime,
  engine: EngineService | undefined,
  mcpPort: McpServerPort | undefined,
  captureScreenshot?: (width: number, height: number) => Promise<Uint8Array>,
) {
  const [enabled, setEnabled] = useState(false);
  const [permissions, setPermissions] = useState<McpToolPermissionState>(() => ({
    ...DEFAULT_MCP_PERMISSIONS,
    write_file: "allow-session",
    set_parameters: "allow-session",
  }));
  const permissionsRef = useRef(permissions);
  const [, setReviewVersion] = useState(0);
  const reviewQueue = useMemo(() => createMcpReviewQueue(), []);
  const setPermission = useCallback((tool: McpToolName, permission: McpPermission) => {
    const next = { ...permissionsRef.current, [tool]: permission };
    permissionsRef.current = next;
    setPermissions(next);
  }, []);
  const getPermissions = useCallback(() => permissionsRef.current, []);
  const consumePermission = useCallback((tool: Extract<McpToolName, "write_file" | "set_parameters">) => {
    setPermission(tool, "deny");
  }, [setPermission]);
  const enqueueReview = useCallback((review: Parameters<typeof reviewQueue.enqueue>[0]) => {
    reviewQueue.enqueue(review);
    setReviewVersion((version) => version + 1);
  }, [reviewQueue]);
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
  const controller = useMemo(() => mcpPort ? createMcpStdioController({
    handler: createWorkbenchMcpHandler({ engine, runtime, captureScreenshot, onPendingReview: enqueueReview }),
    getPermissions,
    onMutationPermissionConsumed: consumePermission,
    onResponse: (line) => { void mcpPort.writeResponse(line).catch(() => undefined); },
  }) : undefined, [captureScreenshot, consumePermission, engine, enqueueReview, getPermissions, mcpPort, runtime]);
  useEffect(() => {
    if (!mcpPort || !controller) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void mcpPort.setEnabled(enabled).then(async () => {
      if (!enabled || disposed) return;
      controller.start();
      const nextUnsubscribe = await mcpPort.subscribeRequests((chunk) => { void controller.receive(chunk); });
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      controller.stop();
      unsubscribe?.();
      void mcpPort.setEnabled(false).catch(() => undefined);
    };
  }, [controller, enabled, mcpPort]);
  return { enabled, setEnabled, permissions, setPermission, pendingReviews: reviewQueue.list(), approveReview, dismissReview };
}
