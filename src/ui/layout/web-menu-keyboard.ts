import type { KeyboardEvent } from "react";

export function moveMenuFocus(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const commands = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  ];
  if (commands.length === 0) return;
  const current = commands.indexOf(event.target as HTMLButtonElement);
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? commands.length - 1
      : event.key === "ArrowDown"
        ? (current + 1 + commands.length) % commands.length
        : (current - 1 + commands.length) % commands.length;
  event.preventDefault();
  commands[next]?.focus();
}
