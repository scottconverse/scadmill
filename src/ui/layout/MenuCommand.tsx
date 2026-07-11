export interface MenuCommandProps {
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly shortcut?: string;
  readonly title?: string;
  readonly onClick: () => void;
}

export function MenuCommand({ active, disabled, label, shortcut, title, onClick }: MenuCommandProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}
