import type {
  WorkspaceLayoutAction,
  WorkspaceLayoutState,
} from "../../application/layout/workspace-layout";
import {
  DEFAULT_KEYBINDINGS,
  type KeybindingSettings,
} from "../../application/commands/default-keybindings";
import type { DirectEditorCommandId } from "../../application/commands/editor-commands";
import { messages } from "../../messages/en";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { moveMenuFocus } from "./web-menu-keyboard";

export interface WebMenuBarProps {
  layout: WorkspaceLayoutState;
  narrow: boolean;
  renderDisabled: boolean;
  closeDocumentDisabled?: boolean;
  reopenDocumentDisabled?: boolean;
  keybindings?: KeybindingSettings;
  onLayoutAction(action: WorkspaceLayoutAction): void;
  onRenderPreview(): void;
  onRenderFull(): void;
  onCloseDocument?(): void;
  onReopenDocument?(): void;
  onEditorCommand?(command: DirectEditorCommandId): void;
}

interface MenuCommandProps {
  active?: boolean;
  disabled?: boolean;
  label: string;
  shortcut?: string;
  title?: string;
  onClick(): void;
}

function MenuCommand({ active, disabled, label, shortcut, title, onClick }: MenuCommandProps) {
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

export function WebMenuBar({
  layout,
  narrow,
  renderDisabled,
  closeDocumentDisabled = true,
  reopenDocumentDisabled = true,
  keybindings = DEFAULT_KEYBINDINGS,
  onLayoutAction,
  onRenderPreview,
  onRenderFull,
  onCloseDocument = () => undefined,
  onReopenDocument = () => undefined,
  onEditorCommand = () => undefined,
}: WebMenuBarProps) {
  const [openMenu, setOpenMenu] = useState<"file" | "edit" | "view" | "render" | null>(null);
  const menuBar = useRef<HTMLElement>(null);
  const fileTrigger = useRef<HTMLButtonElement>(null);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const viewTrigger = useRef<HTMLButtonElement>(null);
  const renderTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (openMenu === null) return;
    const dismissOutside = (event: Event) => {
      const target = event.target;
      const root = menuBar.current;
      if (!(target instanceof Node) || !root) return;
      if (event.type === "pointerdown") {
        if (!root.contains(target)) setOpenMenu(null);
        return;
      }
      const openEntry = root.querySelector('[data-menu-open="true"]');
      if (!openEntry?.contains(target)) setOpenMenu(null);
    };
    globalThis.document.addEventListener("focusin", dismissOutside);
    globalThis.document.addEventListener("pointerdown", dismissOutside);
    return () => {
      globalThis.document.removeEventListener("focusin", dismissOutside);
      globalThis.document.removeEventListener("pointerdown", dismissOutside);
    };
  }, [openMenu]);
  const closeOpenMenu = () => {
    const trigger = openMenu === "file"
      ? fileTrigger.current
      : openMenu === "edit"
        ? editTrigger.current
      : openMenu === "view"
        ? viewTrigger.current
        : renderTrigger.current;
    setOpenMenu(null);
    trigger?.focus();
  };
  const runLayoutAction = (action: WorkspaceLayoutAction) => {
    onLayoutAction(action);
    closeOpenMenu();
  };
  const runDocumentCommand = (command: () => void) => {
    command();
    closeOpenMenu();
  };
  const runEditorCommand = (command: DirectEditorCommandId) => {
    onEditorCommand(command);
    closeOpenMenu();
  };
  const openFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    menu: "file" | "edit" | "view" | "render",
  ) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setOpenMenu(menu);
    globalThis.queueMicrotask(() => {
      const entry = menuBar.current?.querySelector(`[data-menu-name="${menu}"]`);
      const commands = [...(entry?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])]
        .filter((command) => !command.classList.contains("web-menu-trigger"));
      commands[event.key === "ArrowUp" ? commands.length - 1 : 0]?.focus();
    });
  };
  const toggleSheet = (panel: "parameter" | "console"): WorkspaceLayoutAction =>
    narrow
      ? {
          kind: "set-narrow-sheet",
          sheet: layout.narrowSheet === panel ? null : panel,
        }
      : { kind: "toggle-panel", panel };
  const dockVisible = narrow
    ? layout.narrowDockOpen
    : layout.dockOpen && layout.maximized === null;
  const editorVisible = narrow
    ? layout.narrowView === "code"
    : layout.editorOpen && layout.maximized !== "viewer";
  const viewerVisible = narrow
    ? layout.narrowView === "model"
    : layout.viewerOpen && layout.maximized !== "editor";
  const parameterVisible = narrow
    ? layout.narrowSheet === "parameter"
    : layout.parameterOpen && viewerVisible && layout.maximized !== "viewer";
  const consoleVisible = narrow
    ? layout.narrowSheet === "console"
    : layout.consoleOpen && layout.maximized === null;

  return (
    <nav
      aria-label={messages.applicationMenu}
      className="web-menu-bar"
      ref={menuBar}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || openMenu === null) return;
        event.preventDefault();
        closeOpenMenu();
      }}
    >
      <div className="web-menu-entry" data-menu-name="file" data-menu-open={openMenu === "file"}>
        <button
          aria-expanded={openMenu === "file"}
          className="web-menu-trigger"
          onClick={(event) => {
            event.preventDefault();
            setOpenMenu((current) => current === "file" ? null : "file");
          }}
          onKeyDown={(event) => openFromKeyboard(event, "file")}
          ref={fileTrigger}
          type="button"
        >
          {messages.fileMenu}
        </button>
        {openMenu === "file" && <fieldset aria-label={messages.fileMenu} className="web-menu-popover" onKeyDown={moveMenuFocus}>
          <MenuCommand
            disabled
            label={messages.saveDocument}
            shortcut={keybindings.saveDocument}
            title={messages.pendingFileCommand}
            onClick={() => undefined}
          />
          <MenuCommand
            disabled
            label={messages.saveAllDocuments}
            shortcut={keybindings.saveAllDocuments}
            title={messages.pendingFileCommand}
            onClick={() => undefined}
          />
          <MenuCommand
            disabled
            label={messages.newFile}
            shortcut={keybindings.newFile}
            title={messages.pendingFileCommand}
            onClick={() => undefined}
          />
          <MenuCommand
            disabled
            label={messages.openProject}
            shortcut={keybindings.openProject}
            title={messages.pendingFileCommand}
            onClick={() => undefined}
          />
          <MenuCommand
            disabled={closeDocumentDisabled}
            label={messages.closeTab}
            shortcut={keybindings.closeTab}
            onClick={() => runDocumentCommand(onCloseDocument)}
          />
          <MenuCommand
            disabled={reopenDocumentDisabled}
            label={messages.reopenClosedTab}
            shortcut={keybindings.reopenClosedTab}
            onClick={() => runDocumentCommand(onReopenDocument)}
          />
        </fieldset>}
      </div>
      <div className="web-menu-entry" data-menu-name="edit" data-menu-open={openMenu === "edit"}>
        <button
          aria-expanded={openMenu === "edit"}
          className="web-menu-trigger"
          onClick={(event) => {
            event.preventDefault();
            setOpenMenu((current) => current === "edit" ? null : "edit");
          }}
          onKeyDown={(event) => openFromKeyboard(event, "edit")}
          ref={editTrigger}
          type="button"
        >
          {messages.editMenu}
        </button>
        {openMenu === "edit" && <fieldset aria-label={messages.editMenu} className="web-menu-popover" onKeyDown={moveMenuFocus}>
          <MenuCommand
            label={messages.find}
            shortcut={keybindings.find}
            onClick={() => runEditorCommand("find")}
          />
          <MenuCommand
            label={messages.replace}
            shortcut={keybindings.replace}
            onClick={() => runEditorCommand("replace")}
          />
          <MenuCommand
            label={messages.goToLine}
            shortcut={keybindings.goToLine}
            onClick={() => runEditorCommand("go-to-line")}
          />
          <MenuCommand
            label={messages.toggleComment}
            shortcut={keybindings.toggleComment}
            onClick={() => runEditorCommand("toggle-comment")}
          />
          <MenuCommand
            label={messages.undo}
            shortcut={keybindings.undo}
            onClick={() => runEditorCommand("undo")}
          />
          <MenuCommand
            label={messages.redo}
            shortcut={`${keybindings.redo} / ${keybindings.redoAlternate}`}
            onClick={() => runEditorCommand("redo")}
          />
        </fieldset>}
      </div>
      <div className="web-menu-entry" data-menu-name="view" data-menu-open={openMenu === "view"}>
        <button
          aria-expanded={openMenu === "view"}
          className="web-menu-trigger"
          onClick={(event) => {
            event.preventDefault();
            setOpenMenu((current) => current === "view" ? null : "view");
          }}
          onKeyDown={(event) => openFromKeyboard(event, "view")}
          ref={viewTrigger}
          type="button"
        >
          {messages.viewMenu}
        </button>
        {openMenu === "view" && <fieldset aria-label={messages.viewMenu} className="web-menu-popover" onKeyDown={moveMenuFocus}>
          <MenuCommand
            active={dockVisible}
            label={messages.toggleDock}
            shortcut={keybindings.toggleDock}
            onClick={() =>
              runLayoutAction(
                narrow
                  ? { kind: "activate-rail", panel: layout.activeRail, narrow: true }
                  : { kind: "toggle-panel", panel: "dock" },
              )
            }
          />
          <MenuCommand
            active={editorVisible}
            label={narrow ? messages.showCode : messages.toggleEditor}
            onClick={() =>
              runLayoutAction(
                narrow
                  ? { kind: "set-narrow-view", view: "code" }
                  : { kind: "toggle-panel", panel: "editor" },
              )
            }
          />
          <MenuCommand
            active={viewerVisible}
            label={narrow ? messages.showModel : messages.toggleViewer}
            onClick={() =>
              runLayoutAction(
                narrow
                  ? { kind: "set-narrow-view", view: "model" }
                  : { kind: "toggle-panel", panel: "viewer" },
              )
            }
          />
          <MenuCommand
            active={parameterVisible}
            label={messages.toggleParameters}
            shortcut={keybindings.toggleParameters}
            onClick={() => runLayoutAction(toggleSheet("parameter"))}
          />
          <MenuCommand
            active={consoleVisible}
            label={messages.toggleConsole}
            shortcut={keybindings.toggleConsole}
            onClick={() => runLayoutAction(toggleSheet("console"))}
          />
          {!narrow && (
            <>
              <MenuCommand
                active={layout.maximized === "editor"}
                label={layout.maximized === "editor" ? messages.restoreEditor : messages.maximizeEditor}
                shortcut={keybindings.maximizeEditor}
                onClick={() => runLayoutAction({ kind: "toggle-maximize", region: "editor" })}
              />
              <MenuCommand
                active={layout.maximized === "viewer"}
                label={layout.maximized === "viewer" ? messages.restoreViewer : messages.maximizeViewer}
                shortcut={keybindings.maximizeViewer}
                onClick={() => runLayoutAction({ kind: "toggle-maximize", region: "viewer" })}
              />
            </>
          )}
          <MenuCommand
            label={messages.resetLayout}
            onClick={() => runLayoutAction({ kind: "reset-layout" })}
          />
        </fieldset>}
      </div>
      <div className="web-menu-entry" data-menu-name="render" data-menu-open={openMenu === "render"}>
        <button
          aria-expanded={openMenu === "render"}
          className="web-menu-trigger"
          onClick={(event) => {
            event.preventDefault();
            setOpenMenu((current) => current === "render" ? null : "render");
          }}
          onKeyDown={(event) => openFromKeyboard(event, "render")}
          ref={renderTrigger}
          type="button"
        >
          {messages.renderMenu}
        </button>
        {openMenu === "render" && <fieldset aria-label={messages.renderMenu} className="web-menu-popover" onKeyDown={moveMenuFocus}>
          <MenuCommand
            disabled={renderDisabled}
            label={messages.renderPreview}
            shortcut={keybindings.renderPreview}
            onClick={() => {
              onRenderPreview();
              closeOpenMenu();
            }}
          />
          <MenuCommand
            disabled={renderDisabled}
            label={messages.renderFull}
            shortcut={keybindings.renderFull}
            onClick={() => {
              onRenderFull();
              closeOpenMenu();
            }}
          />
        </fieldset>}
      </div>
      <button disabled title={messages.helpMenuUnavailable} type="button">
        {messages.helpMenu}
      </button>
    </nav>
  );
}
