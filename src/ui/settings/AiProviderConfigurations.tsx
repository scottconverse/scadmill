import { useEffect, useRef, useState } from "react";

import type { SecretStore } from "../../application/settings/secret-store";
import type { AiProviderConfiguration } from "../../application/settings/settings-schema";
import { messages } from "../../messages/en";

export interface AiProviderConfigurationsProps {
  readonly configurations: readonly AiProviderConfiguration[];
  readonly persistWebSecret: boolean;
  readonly secretStore: SecretStore;
  readonly onChange: (configurations: readonly AiProviderConfiguration[]) => void;
  readonly onMutationStart?: () => void;
  readonly onMutationEnd?: () => void;
}

function ConfigurationRow({ configuration, persistWebSecret, secretStore, onChange, onRemove, onMutationStart, onMutationEnd }: {
  readonly configuration: AiProviderConfiguration;
  readonly persistWebSecret: boolean;
  readonly secretStore: SecretStore;
  readonly onChange: (configuration: AiProviderConfiguration) => void;
  readonly onRemove: () => void;
  readonly onMutationStart?: () => void;
  readonly onMutationEnd?: () => void;
}) {
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<"loading" | "idle" | "saved" | "error">("loading");
  const mutationActive = useRef(false);
  useEffect(() => {
    let active = true;
    setStatus("loading");
    void secretStore.load(persistWebSecret, configuration.id).then((value) => {
      if (active) { setSecret(value); setStatus("idle"); }
    }, () => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [configuration.id, persistWebSecret, secretStore]);
  const patch = (change: Partial<AiProviderConfiguration>) => onChange({ ...configuration, ...change });
  const mutate = (operation: () => Promise<void>, onSuccess: () => void) => {
    if (mutationActive.current) return;
    mutationActive.current = true;
    onMutationStart?.();
    setStatus("loading");
    void operation().then(onSuccess, () => setStatus("error")).finally(() => {
      mutationActive.current = false;
      onMutationEnd?.();
    });
  };
  return <fieldset className="ai-provider-configuration">
    <legend>{configuration.label}</legend>
    <label>{messages.aiConfigurationLabel}<input onChange={(event) => patch({ label: event.currentTarget.value })} value={configuration.label} /></label>
    <label>{messages.aiProvider}<select onChange={(event) => patch({ provider: event.currentTarget.value as AiProviderConfiguration["provider"] })} value={configuration.provider}><option value="openai">{messages.aiProviderOpenAi}</option><option value="anthropic">{messages.aiProviderAnthropic}</option><option value="compatible">{messages.aiProviderCompatible}</option><option value="local">{messages.aiProviderLocal}</option></select></label>
    <label>{messages.aiEndpoint}<input onChange={(event) => patch({ endpoint: event.currentTarget.value })} type="url" value={configuration.endpoint} /></label>
    <label>{messages.aiModel}<input onChange={(event) => patch({ model: event.currentTarget.value })} value={configuration.model} /></label>
    <label>{messages.aiApiKey}<input autoComplete="off" disabled={status === "loading"} onChange={(event) => setSecret(event.currentTarget.value)} type="password" value={secret} /></label>
    <div><button disabled={status === "loading"} onClick={() => mutate(() => secretStore.save(secret, persistWebSecret, configuration.id), () => setStatus("saved"))} type="button">{messages.saveAiKey}</button><button disabled={status === "loading" || !secret} onClick={() => mutate(() => secretStore.clear(configuration.id), () => { setSecret(""); setStatus("idle"); })} type="button">{messages.clearAiKey}</button><button onClick={() => mutate(() => secretStore.clear(configuration.id), onRemove)} type="button">{messages.aiRemoveConfiguration}</button></div>
    {status === "saved" && <p role="status">{messages.aiKeySaved}</p>}
    {status === "error" && <p role="alert">{messages.aiKeyStorageFailed}</p>}
  </fieldset>;
}

function newConfigurationId(existing: readonly AiProviderConfiguration[]): string {
  const unavailable = new Set(existing.map(({ id }) => id));
  for (let index = 1; index <= 16; index += 1) {
    const id = `provider-${index}`;
    if (!unavailable.has(id)) return id;
  }
  throw new Error("AI provider configuration limit reached.");
}

export function AiProviderConfigurations({ configurations, persistWebSecret, secretStore, onChange, onMutationStart, onMutationEnd }: AiProviderConfigurationsProps) {
  const update = (id: string, configuration: AiProviderConfiguration) => onChange(configurations.map((current) => current.id === id ? configuration : current));
  const remove = (id: string) => onChange(configurations.filter((configuration) => configuration.id !== id));
  return <section aria-label={messages.aiProviderConfigurations}>
    <h3>{messages.aiProviderConfigurations}</h3>
    {configurations.map((configuration) => <ConfigurationRow configuration={configuration} key={configuration.id} onChange={(next) => update(configuration.id, next)} onMutationEnd={onMutationEnd} onMutationStart={onMutationStart} onRemove={() => remove(configuration.id)} persistWebSecret={persistWebSecret} secretStore={secretStore} />)}
    <button disabled={configurations.length >= 16} onClick={() => onChange([...configurations, { id: newConfigurationId(configurations), label: messages.aiNewConfiguration, provider: "openai", endpoint: "", model: "model" }])} type="button">{messages.aiAddConfiguration}</button>
  </section>;
}
