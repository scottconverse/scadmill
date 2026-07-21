import type { KeybindingSettings } from "../../application/commands/default-keybindings";
import type { RecentProject } from "../../application/files/recent-projects";
import { messages } from "../../messages/en";
import { MenuCommand } from "./MenuCommand";
import { moveMenuFocus } from "./web-menu-keyboard";

export interface FileMenuCommandsProps {
  readonly keybindings: KeybindingSettings;
  readonly recentProjects: readonly RecentProject[];
  readonly closeDisabled: boolean;
  readonly reopenDisabled: boolean;
  readonly saveDisabled: boolean;
  readonly saveAllDisabled: boolean;
  readonly saveUnavailableReason?: string;
  readonly saveAllUnavailableReason?: string;
  readonly onClose: () => void;
  readonly onExport: () => void;
  readonly onNewFile: () => void;
  readonly onOpenProject: () => void;
  readonly onOpenRecentProject: (projectId: string, displayName: string) => void;
  readonly onReopen: () => void;
  readonly onSave: () => void;
  readonly onSaveAll: () => void;
}

export function FileMenuCommands(props: FileMenuCommandsProps) {
  return (
    <fieldset aria-label={messages.fileMenu} className="web-menu-popover" onKeyDown={moveMenuFocus}>
      <MenuCommand disabled={props.saveDisabled} label={messages.saveDocument} shortcut={props.keybindings.saveDocument} title={props.saveUnavailableReason} onClick={props.onSave} />
      <MenuCommand disabled={props.saveAllDisabled} label={messages.saveAllDocuments} shortcut={props.keybindings.saveAllDocuments} title={props.saveAllUnavailableReason} onClick={props.onSaveAll} />
      <MenuCommand label={messages.newFile} shortcut={props.keybindings.newFile} onClick={props.onNewFile} />
      <MenuCommand label={messages.openProject} shortcut={props.keybindings.openProject} onClick={props.onOpenProject} />
      <MenuCommand label={messages.openProjectExport} shortcut={props.keybindings.exportModel} onClick={props.onExport} />
      <MenuCommand
        disabled={props.closeDisabled}
        label={messages.closeTab}
        shortcut={props.keybindings.closeTab}
        onClick={props.onClose}
      />
      <MenuCommand
        disabled={props.reopenDisabled}
        label={messages.reopenClosedTab}
        shortcut={props.keybindings.reopenClosedTab}
        onClick={props.onReopen}
      />
      {props.recentProjects.map((recent) => (
        <MenuCommand
          key={recent.projectId}
          label={messages.reopenProject(recent.displayName)}
          onClick={() => props.onOpenRecentProject(recent.projectId, recent.displayName)}
        />
      ))}
    </fieldset>
  );
}
