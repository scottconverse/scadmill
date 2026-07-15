import { messages } from "../../messages/en";

export interface RenderControlsProps {
  autoRender: boolean;
  autoRenderDisabled?: boolean;
  renderDisabled: boolean;
  rendering: boolean;
  onAutoRenderChange(enabled: boolean): void;
  onRenderPreview(): void;
  onRenderFull(): void;
}

export function RenderControls({
  autoRender,
  autoRenderDisabled = false,
  renderDisabled,
  rendering,
  onAutoRenderChange,
  onRenderPreview,
  onRenderFull,
}: RenderControlsProps) {
  return (
    <div className="titlebar-actions">
      <label aria-disabled={autoRenderDisabled} className="auto-render-toggle">
        <input
          aria-label={messages.autoRender}
          checked={autoRender}
          disabled={autoRenderDisabled}
          onChange={(event) => onAutoRenderChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>{messages.autoRender}</span>
      </label>
      <button
        className="render-button"
        disabled={renderDisabled}
        onClick={onRenderPreview}
        type="button"
      >
        {rendering ? messages.rendering : messages.renderPreview}
      </button>
      <button disabled={renderDisabled} onClick={onRenderFull} type="button">
        {messages.renderFull}
      </button>
    </div>
  );
}
