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

function restoreAiWithoutOverwritingConcurrentChanges(
  current: PersistedSettings,
  previous: AiPreferences,
  restored: AiPreferences,
): PersistedSettings {
  const ai: AiPreferences = {
    provider: current.ai.provider === restored.provider ? previous.provider : current.ai.provider,
    endpoint: current.ai.endpoint === restored.endpoint ? previous.endpoint : current.ai.endpoint,
    model: current.ai.model === restored.model ? previous.model : current.ai.model,
    persistWebSecret: current.ai.persistWebSecret === restored.persistWebSecret
      ? previous.persistWebSecret
      : current.ai.persistWebSecret,
  };
  return ai.provider === current.ai.provider
    && ai.endpoint === current.ai.endpoint
    && ai.model === current.ai.model
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
    const secretToMove = durableSecret.current;
    let previousPersistence = settings.ai.persistWebSecret;
    void secretStore.save(secretToMove, persistWebSecret).then(async () => {
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
        try {
          await secretStore.save(secretToMove, previousPersistence);
        } catch {
          rollbackFailed = true;
        }
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
    const previousSecret = durableSecret.current;
    let previousAi = settings.ai;
    let restoredAi = restoreSettingsSection(settings, "ai").ai;
    let settingsCommitted = false;
    const commit = onCommit
      ? onCommit((current) => {
          previousAi = current.ai;
          const restored = restoreSettingsSection(current, "ai");
          restoredAi = restored.ai;
          return restored;
        })
      : Promise.resolve(onRestore("ai"));
    void commit.then(async () => {
      settingsCommitted = true;
      await secretStore.clear();
      durableSecret.current = "";
      if (operation.current === requestId) setSecret("");
      finish(requestId, "cleared");
    }).catch(async () => {
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
      try {
        await secretStore.save(previousSecret, previousAi.persistWebSecret);
      } catch {
        rollbackFailed = true;
      }
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
