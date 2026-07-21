import { useEffect, useRef, useState } from "react";

import { restoreSettingsSection } from "../../application/settings/settings-codec";
import type {
  AiPreferences,
  PersistedSettings,
  SettingsSection,
} from "../../application/settings/settings-schema";
import type { SecretStore } from "../../application/settings/secret-store";

export type SettingsUpdater = (current: PersistedSettings) => PersistedSettings;

export type AiSecretStatus =
  | "loading"
  | "idle"
  | "saving"
  | "saved"
  | "migrated"
  | "cleared"
  | "error"
  | "settings-error"
  | "rollback-error"
  | "load-error";

export interface AiSecretControllerInput {
  readonly blocked: boolean;
  readonly onChange: (settings: PersistedSettings) => void;
  readonly onCommit?: (update: SettingsUpdater) => Promise<void>;
  readonly onMutationStart?: () => void;
  readonly onRestore: (section: SettingsSection) => void | Promise<void>;
  readonly secretStore: SecretStore;
  readonly settings: PersistedSettings;
}

interface ScopedSecret {
  readonly scope?: string;
  readonly value: string;
}

async function saveScopedSecret(secretStore: SecretStore, secret: ScopedSecret, persist: boolean): Promise<void> {
  if (secret.scope) await secretStore.save(secret.value, persist, secret.scope);
  else await secretStore.save(secret.value, persist);
}

async function clearSecretScope(secretStore: SecretStore, scope?: string): Promise<void> {
  if (scope) await secretStore.clear(scope);
  else await secretStore.clear();
}

function restoreAiWithoutOverwritingConcurrentChanges(
  current: PersistedSettings,
  previous: AiPreferences,
  restored: AiPreferences,
): PersistedSettings {
  const ai: AiPreferences = {
    provider: current.ai.provider === restored.provider ? previous.provider : current.ai.provider,
    endpoint: current.ai.endpoint === restored.endpoint ? previous.endpoint : current.ai.endpoint,
    model: current.ai.model === restored.model ? previous.model : current.ai.model,
    models: current.ai.models === restored.models ? previous.models : current.ai.models,
    configurations: current.ai.configurations === restored.configurations ? previous.configurations : current.ai.configurations,
    persistWebSecret: current.ai.persistWebSecret === restored.persistWebSecret
      ? previous.persistWebSecret
      : current.ai.persistWebSecret,
  };
  return ai.provider === current.ai.provider
    && ai.endpoint === current.ai.endpoint
    && ai.model === current.ai.model
    && ai.models === current.ai.models
    && ai.configurations === current.ai.configurations
    && ai.persistWebSecret === current.ai.persistWebSecret
    ? current
    : { ...current, ai };
}

export function useAiSecretController({
  blocked,
  onChange,
  onCommit,
  onMutationStart,
  onRestore,
  secretStore,
  settings,
}: AiSecretControllerInput) {
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<AiSecretStatus>("loading");
  const durableSecret = useRef("");
  const request = useRef(0);
  const operation = useRef<number | null>(null);
  const mutationInFlight = status === "saving";
  const busy = status === "loading" || mutationInFlight;
  const locked = blocked || status === "load-error";

  useEffect(() => {
    if (operation.current !== null) return;
    const requestId = ++request.current;
    if (blocked) {
      durableSecret.current = "";
      setSecret("");
      setStatus("idle");
      return;
    }
    setStatus("loading");
    void secretStore.load(settings.ai.persistWebSecret).then((loaded) => {
      if (requestId !== request.current) return;
      durableSecret.current = loaded;
      setSecret(loaded);
      setStatus("idle");
    }).catch(() => {
      if (requestId === request.current) setStatus("load-error");
    });
    return () => { request.current += 1; };
  }, [blocked, secretStore, settings.ai.persistWebSecret]);

  const begin = (): number | null => {
    if (locked || busy || operation.current !== null) return null;
    onMutationStart?.();
    const requestId = ++request.current;
    operation.current = requestId;
    setStatus("saving");
    return requestId;
  };
  const finish = (requestId: number, next: AiSecretStatus) => {
    if (operation.current !== requestId) return;
    operation.current = null;
    setStatus(next);
  };
  const change = (value: string) => {
    if (locked || busy || operation.current !== null) return;
    setSecret(value);
    setStatus("idle");
  };
  const save = () => {
    const requestId = begin();
    if (requestId === null) return;
    const nextDurableSecret = secret;
    void secretStore.save(nextDurableSecret, settings.ai.persistWebSecret)
      .then(() => {
        durableSecret.current = nextDurableSecret;
        finish(requestId, "saved");
      })
      .catch(() => finish(requestId, "error"));
  };
  const clear = () => {
    const requestId = begin();
    if (requestId === null) return;
    void secretStore.clear().then(() => {
      durableSecret.current = "";
      if (operation.current === requestId) setSecret("");
      finish(requestId, "cleared");
    }).catch(() => finish(requestId, "error"));
  };
  const changePersistence = (persistWebSecret: boolean) => {
    const requestId = begin();
    if (requestId === null) return;
    const scopes = settings.ai.configurations.map(({ id }) => id);
    let previousPersistence = settings.ai.persistWebSecret;
    void Promise.all(scopes.map(async (scope): Promise<ScopedSecret> => ({
      scope,
      value: await secretStore.load(previousPersistence, scope),
    }))).then(async (profileSecrets) => {
      const secrets: readonly ScopedSecret[] = [{ value: durableSecret.current }, ...profileSecrets];
      try {
        await Promise.all(secrets.map((secret) => saveScopedSecret(secretStore, secret, persistWebSecret)));
      } catch {
        const rollback = await Promise.allSettled(secrets.map((secret) => saveScopedSecret(secretStore, secret, previousPersistence)));
        finish(requestId, rollback.some(({ status: result }) => result === "rejected") ? "rollback-error" : "error");
        return;
      }
      try {
        if (onCommit) {
          await onCommit((current) => {
            previousPersistence = current.ai.persistWebSecret;
            return { ...current, ai: { ...current.ai, persistWebSecret } };
          });
        } else {
          onChange({ ...settings, ai: { ...settings.ai, persistWebSecret } });
        }
        finish(requestId, "migrated");
      } catch {
        let rollbackFailed = false;
        const secretRollback = await Promise.allSettled(secrets.map((secret) => saveScopedSecret(secretStore, secret, previousPersistence)));
        rollbackFailed = secretRollback.some(({ status: result }) => result === "rejected");
        if (onCommit) {
          try {
            await onCommit((current) => current.ai.persistWebSecret === persistWebSecret
              ? {
                  ...current,
                  ai: { ...current.ai, persistWebSecret: previousPersistence },
                }
              : current
            );
          } catch {
            rollbackFailed = true;
          }
        }
        finish(requestId, rollbackFailed ? "rollback-error" : "settings-error");
      }
    }).catch(() => finish(requestId, "error"));
  };
  const restore = () => {
    const requestId = begin();
    if (requestId === null) return;
    let previousAi = settings.ai;
    let restoredAi = restoreSettingsSection(settings, "ai").ai;
    let settingsCommitted = false;
    const scopes = settings.ai.configurations.map(({ id }) => id);
    void Promise.all(scopes.map(async (scope): Promise<ScopedSecret> => ({
      scope,
      value: await secretStore.load(settings.ai.persistWebSecret, scope),
    }))).then(async (profileSecrets) => {
      const previousSecrets: readonly ScopedSecret[] = [{ value: durableSecret.current }, ...profileSecrets];
      const commit = onCommit
        ? onCommit((current) => {
            previousAi = current.ai;
            const restored = restoreSettingsSection(current, "ai");
            restoredAi = restored.ai;
            return restored;
          })
        : Promise.resolve(onRestore("ai"));
      await commit;
      settingsCommitted = true;
      try {
        await Promise.all(previousSecrets.map(({ scope }) => clearSecretScope(secretStore, scope)));
        durableSecret.current = "";
        if (operation.current === requestId) setSecret("");
        finish(requestId, "cleared");
      } catch {
        throw Object.assign(new Error("AI secret clear failed."), { previousSecrets });
      }
    }).catch(async (reason: unknown) => {
      if (!settingsCommitted) {
        let rollbackFailed = false;
        if (onCommit) {
          try {
            await onCommit((current) =>
              restoreAiWithoutOverwritingConcurrentChanges(current, previousAi, restoredAi)
            );
          } catch {
            rollbackFailed = true;
          }
        }
        finish(requestId, rollbackFailed ? "rollback-error" : "settings-error");
        return;
      }
      let rollbackFailed = !onCommit;
      const previousSecrets = reason instanceof Error && "previousSecrets" in reason
        ? (reason as Error & { previousSecrets: readonly ScopedSecret[] }).previousSecrets
        : [{ value: durableSecret.current }];
      const secretRollback = await Promise.allSettled(previousSecrets.map((secret) => saveScopedSecret(secretStore, secret, previousAi.persistWebSecret)));
      if (secretRollback.some(({ status: result }) => result === "rejected")) rollbackFailed = true;
      if (onCommit) {
        try {
          await onCommit((current) =>
            restoreAiWithoutOverwritingConcurrentChanges(current, previousAi, restoredAi)
          );
        } catch {
          rollbackFailed = true;
        }
      }
      finish(requestId, rollbackFailed ? "rollback-error" : "error");
    });
  };

  return {
    busy,
    change,
    changePersistence,
    clear,
    locked,
    mutationInFlight,
    restore,
    save,
    secret,
    status,
  };
}
