import { useEffect, useMemo, useState } from "react";

import type { EngineService } from "../../application/engine/contracts";
import { createMcpReviewQueue } from "../../application/mcp/mcp-review-queue";
import { createMcpStdioController } from "../../application/mcp/mcp-stdio-controller";
import { createWorkbenchMcpHandler } from "../../application/mcp/workbench-mcp-handler";
import type { McpServerPort } from "../../application/platform/scadmill-platform";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime-contracts";

export function useMcpStdio(
  runtime: WorkbenchRuntime,
  engine: EngineService | undefined,
  mcpPort: McpServerPort | undefined,
) {
  const [enabled, setEnabled] = useState(false);
  const reviewQueue = useMemo(() => createMcpReviewQueue(), []);
  const controller = useMemo(() => mcpPort ? createMcpStdioController({
    handler: createWorkbenchMcpHandler({ engine, runtime, onPendingReview: (review) => reviewQueue.enqueue(review) }),
    onResponse: (line) => { void mcpPort.writeResponse(line).catch(() => undefined); },
  }) : undefined, [engine, mcpPort, reviewQueue, runtime]);
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
  return { enabled, setEnabled };
}
