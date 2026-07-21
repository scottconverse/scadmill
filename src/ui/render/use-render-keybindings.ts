import { useEffect } from "react";

import {
  matchesKeybinding,
  primaryModifierForPlatform,
  type KeybindingSettings,
} from "../../application/commands/default-keybindings";

export interface RenderKeybindingOptions {
  disabled: boolean;
  rendering: boolean;
  keybindings: KeybindingSettings;
  onPreview(): void;
  onFull(): void;
  onCancel(): void;
}

export function useRenderKeybindings({
  disabled,
  rendering,
  keybindings,
  onPreview,
  onFull,
  onCancel,
}: RenderKeybindingOptions): void {
  const primaryModifier = primaryModifierForPlatform();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (matchesKeybinding(event, keybindings.cancelRender, primaryModifier)) {
        if (rendering && event.target instanceof Element && event.target.closest(".viewer-panel")) {
          event.preventDefault();
          onCancel();
          return;
        }
      }
      if (disabled) return;
      const preview = matchesKeybinding(event, keybindings.renderPreview, primaryModifier);
      const full = matchesKeybinding(event, keybindings.renderFull, primaryModifier);
      if (!preview && !full) return;
      event.preventDefault();
      if (preview) onPreview();
      else onFull();
    };
    globalThis.addEventListener?.("keydown", onKeyDown);
    return () => globalThis.removeEventListener?.("keydown", onKeyDown);
  }, [disabled, keybindings, onCancel, onFull, onPreview, primaryModifier, rendering]);
}
