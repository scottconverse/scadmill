import { useEffect, useRef } from "react";

import { messages } from "../messages/en";

export function NativeHelpPanel({ onClose, onOpenSettings }: {
  readonly onClose: () => void;
  readonly onOpenSettings: () => void;
}) {
  const firstAction = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(true);
  useEffect(() => {
    previousFocus.current = globalThis.document.activeElement instanceof HTMLElement
      ? globalThis.document.activeElement
      : null;
    firstAction.current?.focus();
    return () => {
      if (restoreFocus.current) previousFocus.current?.focus();
    };
  }, []);
  return (
    <section
      aria-label={messages.helpInformation}
      className="native-help-information"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      role="dialog"
    >
      <p>{messages.helpSummary}</p>
      <div>
        <button
          onClick={() => {
            restoreFocus.current = false;
            onOpenSettings();
          }}
          ref={firstAction}
          type="button"
        >{messages.viewKeyboardShortcuts}</button>
        <button onClick={onClose} type="button">{messages.closeHelp}</button>
      </div>
    </section>
  );
}

export function DismissibleNotice({ message, onDismiss }: {
  readonly message: string;
  readonly onDismiss: () => void;
}) {
  return (
    <div className="file-command-notice" role="alert">
      <span>{message}</span>
      <button aria-label={messages.dismissNotice} onClick={onDismiss} type="button">×</button>
    </div>
  );
}
