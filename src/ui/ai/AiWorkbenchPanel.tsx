import { useCallback, useMemo } from "react";

import type { AiContextInputs } from "../../application/ai/ai-context";
import type { AiFetchFactory } from "../../application/ai/ai-client";
import { createLocalConversationPersistence } from "../../application/ai/conversation-persistence";
import type { DocumentBuffer } from "../../application/documents/document-workspace";
import type { McpToolHandler } from "../../application/mcp/mcp-dispatcher";
import type { McpPendingReview } from "../../application/mcp/mcp-review-queue";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime-contracts";
import type { SecretStore } from "../../application/settings/secret-store";
import type { PersistedSettings } from "../../application/settings/settings-schema";
import { AiConversationPanel } from "./AiConversationPanel";
import { createAiConversationBridge } from "./ai-runtime-bridge";

export interface AiWorkbenchPanelProps {
  readonly runtime: WorkbenchRuntime;
  readonly aiFetch?: AiFetchFactory;
  readonly profile: PersistedSettings;
  readonly secretStore: SecretStore;
  readonly document: DocumentBuffer;
  readonly projectIdentity: string;
  readonly contextInputs: AiContextInputs;
  readonly agentToolHandler: McpToolHandler;
  readonly pendingReview: (commandId: string) => McpPendingReview | undefined;
  readonly onApproveReview: (review: McpPendingReview) => Promise<void>;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly onInsertAtCursor: (code: string) => void;
  readonly onOpenSettings?: () => void;
}

export function AiWorkbenchPanel({
  runtime, aiFetch = () => globalThis.fetch.bind(globalThis), profile, secretStore, document, projectIdentity, contextInputs, agentToolHandler,
  pendingReview, onApproveReview, onCopy, onInsertAtCursor, onOpenSettings,
}: AiWorkbenchPanelProps) {
  const bridge = useMemo(
    () => createAiConversationBridge(runtime, profile, secretStore, aiFetch),
    [aiFetch, profile, runtime, secretStore],
  );
  const persistence = useMemo(() => createLocalConversationPersistence(projectIdentity), [projectIdentity]);
  const approveAgentReview = useCallback(async (commandId: string) => {
    const review = pendingReview(commandId);
    if (review?.origin !== "ai-panel") throw new Error("The AI review is no longer pending.");
    await onApproveReview(review);
  }, [onApproveReview, pendingReview]);
  return <AiConversationPanel
    agentToolHandler={agentToolHandler}
    approveAgentReview={approveAgentReview}
    configurations={bridge.configurations}
    configurationRequiresSecret={bridge.configurationRequiresSecret}
    configured={(profile.ai.provider !== "none" && Boolean(profile.ai.model.trim() || profile.ai.models.length)) || profile.ai.configurations.length > 0}
    contextInputs={contextInputs}
    currentSource={document.source}
    documentId={document.id}
    loadConfigurationSecret={bridge.loadConfigurationSecret}
    loadPersistenceSecrets={bridge.loadPersistenceSecrets}
    onApplyEdit={bridge.applyEdit}
    onCopy={onCopy}
    onInsertAtCursor={onInsertAtCursor}
    onOpenSettings={onOpenSettings}
    persistence={persistence}
    requestAgentTurn={bridge.requestAgentTurn}
    requestStream={bridge.requestStream}
    sourceForDocument={(documentId) => runtime.documents.getState().documents.find(({ id }) => id === documentId)?.source ?? ""}
  />;
}
