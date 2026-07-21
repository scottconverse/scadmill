import { messages } from "../../messages/en";

export interface AiActivityProps { readonly configured: boolean; readonly onOpenSettings?: () => void; }

export function AiActivity({ configured, onOpenSettings }: AiActivityProps) {
  if (configured) return <section aria-label={messages.activityAi}><p>{messages.aiReady}</p></section>;
  return (
    <section aria-label={messages.activityAi} className="ai-activity">
      <h2>{messages.activityAi}</h2>
      <p>{messages.aiNotConfigured}</p>
      <p>{messages.aiSetupGuidance}</p>
      {onOpenSettings && <button onClick={onOpenSettings} type="button">{messages.openSettings}</button>}
    </section>
  );
}
