import { type AiSecretStore, streamAiCompletion } from "../../application/ai/ai-client";
import type { AiMessage } from "../../application/ai/ai-provider";
import type { ProposedEdit } from "../../application/ai/conversation";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime-contracts";
import type { SecretStore } from "../../application/settings/secret-store";
import type { PersistedSettings } from "../../application/settings/settings-schema";

export interface AiConversationBridge {
  readonly requestStream: (messages: readonly AiMessage[], signal: AbortSignal) => AsyncIterable<string>;
  readonly applyEdit: (proposal: ProposedEdit) => void;
}

export function createAiConversationBridge(
  runtime: WorkbenchRuntime,
  settings: PersistedSettings,
  secretStore: SecretStore,
  documentId: string,
): AiConversationBridge {
  const requestStream = async function* (messages: readonly AiMessage[], signal: AbortSignal) {
    if (settings.ai.provider === "none") return;
    const secret = await secretStore.load(settings.ai.persistWebSecret);
    const aiSecretStore: AiSecretStore = { load: () => secret };
    yield* streamAiCompletion(settings.ai, aiSecretStore, { model: settings.ai.model, messages }, signal);
  };
  const applyEdit = (proposal: ProposedEdit) => {
    if (proposal.documentId !== documentId) return;
    void runtime.dispatch({ kind: "edit-document", origin: "ai-panel", documentId, source: proposal.code }).catch(() => undefined);
  };
  return { requestStream, applyEdit };
}
