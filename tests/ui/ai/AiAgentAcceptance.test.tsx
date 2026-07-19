// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AgentModelTurn } from "../../../src/application/ai/agent-loop";
import type { AiMessage } from "../../../src/application/ai/ai-provider";
import type { EngineService, RenderSuccess3D } from "../../../src/application/engine/contracts";
import { applyWorkbenchReview } from "../../../src/application/mcp/apply-workbench-review";
import type { McpPendingReview } from "../../../src/application/mcp/mcp-review-queue";
import { createWorkbenchMcpHandler } from "../../../src/application/mcp/workbench-mcp-handler";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { AiConversationPanel } from "../../../src/ui/ai/AiConversationPanel";
import { McpReviewPanel } from "../../../src/ui/mcp/McpReviewPanel";

function engine(): EngineService {
  const result: RenderSuccess3D = {
    kind: "3d",
    mesh: { format: "stl-binary", bytes: Uint8Array.of(1) },
    stats: { triangles: 1, engineTimeMs: 1 },
    diagnostics: [{ severity: "error", message: "radius is undefined" }],
    rawLog: "ERROR: radius is undefined",
  };
  return {
    render: vi.fn().mockReturnValue({ jobId: "agent-render", done: Promise.resolve(result) }),
    export: vi.fn(),
    cancel: vi.fn(),
    version: vi.fn().mockResolvedValue(null),
  };
}

function Harness({ runtime, renderEngine, model }: {
  readonly runtime: WorkbenchRuntime;
  readonly renderEngine: EngineService;
  readonly model: (messages: readonly AiMessage[], signal: AbortSignal) => Promise<AgentModelTurn>;
}) {
  const [reviews, setReviews] = useState<readonly McpPendingReview[]>([]);
  const handler = useMemo(() => createWorkbenchMcpHandler({
    runtime,
    engine: renderEngine,
    mutationOrigin: "ai-panel",
    onPendingReview: (review) => setReviews((current) => [...current, review]),
  }), [renderEngine, runtime]);
  const approve = async (review: McpPendingReview) => {
    await applyWorkbenchReview(runtime, review, review.origin);
    setReviews((current) => current.filter(({ commandId }) => commandId !== review.commandId));
  };
  return <>
    <AiConversationPanel
      agentToolHandler={handler}
      configured
      currentSource={runtime.documents.getState().documents[0]?.source ?? ""}
      documentId="document-main"
      requestAgentTurn={model}
      requestStream={async function* () { yield ""; }}
    />
    <McpReviewPanel
      history={runtime.history.getState()}
      historyDetails={runtime.historyDetails.getState()}
      onApprove={approve}
      onDeny={(commandId) => setReviews((current) => current.filter(({ commandId: id }) => id !== commandId))}
      pendingReviews={reviews}
      sourceForPath={() => runtime.documents.getState().documents[0]?.source ?? ""}
    />
  </>;
}

describe("AC-10.c AI agent acceptance", () => {
  it("renders, reads diagnostics, proposes a fix, and leaves an exact diff pending", async () => {
    const runtime = createWorkbenchRuntime(engine(), { initialScratchSource: "cube(radius);" });
    const renderEngine = engine();
    const model = vi.fn()
      .mockResolvedValueOnce({ toolCall: { name: "render_preview", arguments: { path: "main.scad" } } })
      .mockResolvedValueOnce({ toolCall: { name: "get_diagnostics", arguments: { path: "main.scad" } } })
      .mockResolvedValueOnce({ toolCall: { name: "write_file", arguments: { path: "main.scad", content: "cube(10);" } } })
      .mockResolvedValueOnce({ text: "The repair is ready for review." });
    render(<Harness model={model} renderEngine={renderEngine} runtime={runtime} />);

    fireEvent.click(screen.getByLabelText("Allow tool calls for this conversation"));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "repair the render" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("AI file change: main.scad")).toBeVisible();
    expect(runtime.documents.getState().documents[0]?.source).toBe("cube(radius);");
    expect(JSON.stringify(model.mock.calls[2]?.[0])).toContain("radius is undefined");
    fireEvent.click(screen.getByRole("button", { name: "Approve change" }));
    await waitFor(() => expect(runtime.documents.getState().documents[0]?.source).toBe("cube(10);"));
    expect(runtime.history.getState().at(-1)).toMatchObject({ origin: "ai-panel", kind: "edit-document" });
    runtime.dispose();
  });
});
