import type {
  KeybindingCommand,
  KeybindingSettings,
} from "../../application/commands/default-keybindings";
import { messages } from "../../messages/en";

const LABELS: Readonly<Record<KeybindingCommand, string>> = {
  saveDocument: messages.saveDocument,
  saveAllDocuments: messages.saveAllDocuments,
  newFile: messages.newFile,
  openProject: messages.openProject,
  closeTab: messages.closeTab,
  reopenClosedTab: messages.reopenClosedTab,
  nextTab: messages.nextTab,
  previousTab: messages.previousTab,
  find: messages.find,
  replace: messages.replace,
  findInProject: messages.findInProject,
  goToLine: messages.goToLine,
  goToDefinition: messages.goToDefinition,
  toggleComment: messages.toggleComment,
  formatDocument: messages.formatDocument,
  undo: messages.undo,
  redo: messages.redo,
  redoAlternate: messages.redoAlternate,
  multiCursorAdd: messages.multiCursorAdd,
  renderPreview: messages.renderPreview,
  renderFull: messages.renderFull,
  cancelRender: messages.cancelRender,
  exportModel: messages.exportModel,
  zoomViewerToFit: messages.zoomViewerToFit,
  axisFront: messages.axisFront,
  axisRight: messages.axisRight,
  axisTop: messages.axisTop,
  togglePerspective: messages.togglePerspective,
  screenshotViewport: messages.screenshotViewport,
  toggleDock: messages.toggleDock,
  toggleParameters: messages.toggleParameters,
  toggleConsole: messages.toggleConsole,
  maximizeEditor: messages.maximizeEditor,
  maximizeViewer: messages.maximizeViewer,
  settings: messages.openSettingsCommand,
  commandPalette: messages.commandPalette,
  switchCodeModel: messages.switchCodeModel,
};

const GROUPS: readonly {
  readonly label: string;
  readonly commands: readonly KeybindingCommand[];
}[] = [
  {
    label: messages.keybindingGroupFiles,
    commands: [
      "saveDocument", "saveAllDocuments", "newFile", "openProject", "closeTab",
      "reopenClosedTab", "nextTab", "previousTab",
    ],
  },
  {
    label: messages.keybindingGroupEditor,
    commands: [
      "find", "replace", "findInProject", "goToLine", "goToDefinition", "toggleComment",
      "formatDocument", "undo", "redo", "redoAlternate", "multiCursorAdd",
    ],
  },
  {
    label: messages.keybindingGroupRender,
    commands: ["renderPreview", "renderFull", "cancelRender", "exportModel"],
  },
  {
    label: messages.keybindingGroupViewer,
    commands: [
      "zoomViewerToFit", "axisFront", "axisRight", "axisTop", "togglePerspective",
      "screenshotViewport",
    ],
  },
  {
    label: messages.keybindingGroupLayout,
    commands: [
      "toggleDock", "toggleParameters", "toggleConsole", "maximizeEditor", "maximizeViewer",
      "settings", "commandPalette", "switchCodeModel",
    ],
  },
];

export function KeybindingSettingsFields({
  settings,
  onChange,
}: {
  readonly settings: KeybindingSettings;
  readonly onChange: (command: KeybindingCommand, binding: string) => void;
}) {
  return GROUPS.map((group) => (
    <fieldset className="keybinding-settings-group" key={group.label}>
      <legend>{group.label}</legend>
      {group.commands.map((command) => (
        <label className="setting-row" key={command}>
          <span>{LABELS[command]}</span>
          <input
            aria-label={messages.keybindingLabel(LABELS[command])}
            onChange={(event) => onChange(command, event.currentTarget.value)}
            value={settings[command]}
          />
        </label>
      ))}
    </fieldset>
  ));
}
