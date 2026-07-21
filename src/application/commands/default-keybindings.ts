export const DEFAULT_KEYBINDINGS = {
  saveDocument: "Mod+S",
  saveAllDocuments: "Mod+Alt+S",
  newFile: "Mod+N",
  openProject: "Mod+O",
  closeTab: "Mod+W",
  reopenClosedTab: "Mod+Shift+T",
  nextTab: "Ctrl+Tab",
  previousTab: "Ctrl+Shift+Tab",
  find: "Mod+F",
  replace: "Mod+H",
  findInProject: "Mod+Shift+F",
  goToLine: "Mod+G",
  goToDefinition: "F12",
  toggleComment: "Mod+/",
  formatDocument: "Shift+Alt+F",
  undo: "Mod+Z",
  redo: "Mod+Y",
  redoAlternate: "Mod+Shift+Z",
  multiCursorAdd: "Alt+Click",
  renderPreview: "F5",
  renderFull: "F6",
  cancelRender: "Escape",
  exportModel: "Mod+E",
  zoomViewerToFit: "Mod+0",
  axisFront: "Numpad1",
  axisRight: "Numpad3",
  axisTop: "Numpad7",
  togglePerspective: "Numpad5",
  screenshotViewport: "Mod+Shift+P",
  toggleDock: "Mod+B",
  toggleParameters: "Mod+Shift+B",
  toggleConsole: "Mod+J",
  maximizeEditor: "Mod+Shift+E",
  maximizeViewer: "Mod+Shift+V",
  settings: "Mod+,",
  commandPalette: "Mod+Shift+K",
  switchCodeModel: "Mod+M",
} as const;

export type KeybindingCommand = keyof typeof DEFAULT_KEYBINDINGS;
export type KeybindingSettings = Readonly<Record<KeybindingCommand, string>>;
export type PrimaryModifier = "control" | "meta";
type KeybindingScope = "global" | "editor" | "viewer";

const KEYBINDING_SCOPES: Readonly<Record<KeybindingCommand, KeybindingScope>> = {
  saveDocument: "global",
  saveAllDocuments: "global",
  newFile: "global",
  openProject: "global",
  closeTab: "global",
  reopenClosedTab: "global",
  nextTab: "global",
  previousTab: "global",
  find: "editor",
  replace: "editor",
  findInProject: "global",
  goToLine: "editor",
  goToDefinition: "editor",
  toggleComment: "editor",
  formatDocument: "editor",
  undo: "editor",
  redo: "editor",
  redoAlternate: "editor",
  multiCursorAdd: "editor",
  renderPreview: "global",
  renderFull: "global",
  cancelRender: "viewer",
  exportModel: "global",
  zoomViewerToFit: "viewer",
  axisFront: "viewer",
  axisRight: "viewer",
  axisTop: "viewer",
  togglePerspective: "viewer",
  screenshotViewport: "viewer",
  toggleConsole: "global",
  toggleDock: "global",
  toggleParameters: "global",
  maximizeEditor: "global",
  maximizeViewer: "global",
  settings: "global",
  commandPalette: "global",
  switchCodeModel: "global",
};

export interface KeybindingEvent {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export interface PointerBindingEvent {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

function canonicalBinding(binding: string): string {
  const parts = binding.split("+").map((part) => part.trim().toLowerCase());
  const key = parts.pop() ?? "";
  const modifiers = [...new Set(parts)].sort();
  return [...modifiers, key].join("+");
}

export function createKeybindingSettings(
  overrides: Partial<KeybindingSettings> = {},
): KeybindingSettings {
  const settings: KeybindingSettings = { ...DEFAULT_KEYBINDINGS, ...overrides };
  const claimed = new Map<string, KeybindingCommand>();
  for (const command of Object.keys(settings) as KeybindingCommand[]) {
    const binding = settings[command].trim();
    if (!binding) throw new Error(`Keybinding for ${command} cannot be empty`);
    const collisionKey = `${KEYBINDING_SCOPES[command]}:${canonicalBinding(binding)}`;
    const conflict = claimed.get(collisionKey);
    if (conflict) {
      throw new Error(`Keybinding collision: ${command} conflicts with ${conflict}`);
    }
    claimed.set(collisionKey, command);
  }
  return Object.freeze(settings);
}

export function primaryModifierForPlatform(
  platform: string = globalThis.navigator?.platform ?? "",
): PrimaryModifier {
  return /Mac|iPhone|iPad|iPod/iu.test(platform) ? "meta" : "control";
}

function primaryModifierMatches(
  event: Pick<KeybindingEvent, "ctrlKey" | "metaKey">,
  primaryModifier: PrimaryModifier,
): boolean {
  return primaryModifier === "meta"
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export function matchesKeybinding(
  event: KeybindingEvent,
  binding: string,
  primaryModifier: PrimaryModifier,
): boolean {
  if (binding === "Alt+Click") return false;
  const parts = binding.split("+");
  const key = parts.at(-1)?.toLowerCase();
  const mod = parts.includes("Mod");
  const control = parts.includes("Ctrl");
  const meta = parts.includes("Meta");
  const shift = parts.includes("Shift");
  const alt = parts.includes("Alt");
  const primaryMatches = mod
    ? primaryModifierMatches(event, primaryModifier)
    : event.ctrlKey === control && event.metaKey === meta;
  const eventKey = (event.code?.startsWith("Numpad") ? event.code : event.key).toLowerCase();
  return Boolean(key)
    && primaryMatches
    && event.shiftKey === shift
    && event.altKey === alt
    && eventKey === key;
}

export function matchesPointerBinding(
  event: PointerBindingEvent,
  binding: string,
  primaryModifier: PrimaryModifier,
): boolean {
  const parts = binding.split("+");
  if (parts.at(-1) !== "Click") return false;
  const mod = parts.includes("Mod");
  const control = parts.includes("Ctrl");
  const meta = parts.includes("Meta");
  const primaryMatches = mod
    ? primaryModifierMatches(event, primaryModifier)
    : event.ctrlKey === control && event.metaKey === meta;
  return primaryMatches
    && event.shiftKey === parts.includes("Shift")
    && event.altKey === parts.includes("Alt");
}
