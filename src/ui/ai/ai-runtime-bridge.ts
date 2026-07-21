import { type AiFetchFactory, type AiSecretStore, streamAiAgentTurn, streamAiCompletion } from "../../application/ai/ai-client";
import type { AgentModelTurn } from "../../application/ai/agent-loop";
import type { AiMessage } from "../../application/ai/ai-provider";
import type { ProposedEdit } from "../../application/ai/conversation";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime-contracts";
import type { SecretStore } from "../../application/settings/secret-store";
import type { PersistedSettings } from "../../application/settings/settings-schema";
import type { AiPreferences } from "../../application/settings/settings-schema";
import { messages } from "../../messages/en";

export interface AiConversationConfiguration {
  readonly id: string;
  readonly label: string;
}

interface ResolvedAiConfiguration extends AiConversationConfiguration {
  readonly preferences: AiPreferences;
  readonly secretScope?: string;
}

export interface AiConversationBridge {
  readonly configurations: readonly AiConversationConfiguration[];
  readonly requestStream: (messages: readonly AiMessage[], signal: AbortSignal, configurationId?: string) => AsyncIterable<string>;
  readonly loadConfigurationSecret: (configurationId?: string) => Promise<string | null>;
  readonly loadPersistenceSecrets: () => Promise<readonly string[]>;
  readonly configurationRequiresSecret: (configurationId?: string) => boolean;
  readonly requestAgentTurn: (messages: readonly AiMessage[], signal: AbortSignal, configurationId?: string, onTextDelta?: (delta: string) => void) => Promise<AgentModelTurn>;
  readonly applyEdit: (proposal: ProposedEdit) => Promise<void>;
}

function modelConfigurationId(model: string): string {
  const encoded = Array.from({ length: model.length }, (_, index) => model.charCodeAt(index).toString(16).padStart(4, "0")).join("");
  return `model-${encoded}`;
}

export function createAiConversationBridge(
  runtime: WorkbenchRuntime,
  settings: PersistedSettings,
  secretStore: SecretStore,
  aiFetch: AiFetchFactory = () => globalThis.fetch.bind(globalThis),
): AiConversationBridge {
  const configurations: readonly ResolvedAiConfiguration[] = [
    ...(settings.ai.provider === "none" ? [] : [...new Set([settings.ai.model, ...settings.ai.models].filter(Boolean))].map((model) => ({
      id: modelConfigurationId(model),
      label: `${settings.ai.provider} — ${model}`,
      preferences: { ...settings.ai, model },
    }))),
    ...settings.ai.configurations.map((configuration) => ({
      id: `profile-${configuration.id}`,
      label: `${configuration.label} — ${configuration.provider} — ${configuration.model}`,
      preferences: { ...settings.ai, provider: configuration.provider, endpoint: configuration.endpoint, model: configuration.model },
      secretScope: configuration.id,
    })),
  ];
  const resolve = (configurationId?: string) => configurations.find(({ id }) => id === configurationId) ?? configurations[0];
  const scopedLoad = (scope?: string) => secretStore.load(settings.ai.persistWebSecret, scope);
  const loadConfigurationSecret = async (configurationId?: string) => {
    const configuration = resolve(configurationId);
    return configuration ? scopedLoad(configuration.secretScope) : null;
  };
  const loadPersistenceSecrets = async () => Promise.all([...new Set(configurations.map(({ secretScope }) => secretScope ?? ""))].map((scope) => scopedLoad(scope || undefined)));
  const configurationRequiresSecret = (configurationId?: string) => resolve(configurationId)?.preferences.provider !== "local";
  const requestStream = async function* (messages: readonly AiMessage[], signal: AbortSignal, configurationId?: string) {
    const configuration = resolve(configurationId);
    if (!configuration) return;
    const secret = await scopedLoad(configuration.secretScope);
    const aiSecretStore: AiSecretStore = { load: () => secret };
    yield* streamAiCompletion(configuration.preferences, aiSecretStore, { model: configuration.preferences.model, messages }, signal, aiFetch(configuration.secretScope));
  };
  const requestAgentTurn = async (messages: readonly AiMessage[], signal: AbortSignal, configurationId?: string, onTextDelta: (delta: string) => void = () => undefined) => {
    const configuration = resolve(configurationId);
    if (!configuration) return {};
    const secret = await scopedLoad(configuration.secretScope);
    const aiSecretStore: AiSecretStore = { load: () => secret };
    return streamAiAgentTurn(configuration.preferences, aiSecretStore, { model: configuration.preferences.model, messages }, signal, onTextDelta, aiFetch(configuration.secretScope));
  };
  const applyEdit = async (proposal: ProposedEdit) => {
    if (!runtime.documents.getState().documents.some(({ id }) => id === proposal.documentId)) {
      throw new Error(messages.aiProposalTargetClosed);
    }
    await runtime.dispatch({ kind: "edit-document", origin: "ai-panel", documentId: proposal.documentId, source: proposal.code });
  };
  return {
    configurations: configurations.map(({ id, label }) => ({ id, label })),
    requestStream, requestAgentTurn, loadConfigurationSecret, loadPersistenceSecrets,
    configurationRequiresSecret, applyEdit,
  };
}
