import type {
  WorkspaceLayoutAction,
  WorkspaceLayoutState,
} from "../../application/layout/workspace-layout";
import { DEFAULT_KEYBINDINGS } from "../../application/commands/default-keybindings";
import { messages } from "../../messages/en";
import { useEffect, useRef, useState } from "react";

export interface WebMenuBarProps {
  layout: WorkspaceLayoutState;
  narrow: boolean;
  renderDisabled: boolean;
  closeDocumentDisabled?: boolean;
  reopenDocumentDisabled?: boolean;
  onLayoutAction(action: WorkspaceLayoutAction): void;
  onRenderPreview(): void;
  onCloseDocument?(): void;
  onReopenDocument?(): void;
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
  onLayoutAction,
  onRenderPreview,
  onCloseDocument = () => undefined,
  onReopenDocument = () => undefined,
}: WebMenuBarProps) {
  const [openMenu, setOpenMenu] = useState<"file" | "view" | "render" | null>(null);
  const menuBar = useRef<HTMLElement>(null);
  const fileTrigger = useRef<HTMLButtonElement>(null);
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
      <div className="web-menu-entry" data-menu-open={openMenu === "file"}>
        <button
          aria-expanded={openMenu === "file"}
          className="web-menu-trigger"
          onClick={(event) => {
            event.preventDefault();
            setOpenMenu((current) => current === "file" ? null : "file");
          }}
          ref={fileTrigger}
          type="button"
        >
          {messages.fileMenu}
        </button>
        {openMenu === "file" && <div className="web-menu-popover">
          <MenuCommand
            disabled
            label={messages.saveDocument}
            shortcut={DEFAULT_KEYBINDINGS.saveDocument}
            title={messages.pendingFileCommand}
            onClick={() => undefined}
          />
          <MenuCommand
            disabled
            label={messages.saveAllDocuments}
            shortcut={DEFAULT_KEYBINDINGS.saveAllDocuments}
            title={messages.pendingFileCommand}
            onClick={() => undefined}
          />
          <MenuCommand
            disabled
            label={messages.newFile}
            shortcut={DEFAULT_KEYBINDINGS.newFile}
            title={messages.pendingFileCommand}
            onClick={() => undefined}
          />
          <MenuCommand
            disabled
            label={messages.openProject}
            shortcut={DEFAULT_KEYBINDINGS.openProject}
            title={messages.pendingFileCommand}
            onClick={() => undefined}
          />
          <MenuCommand
            disabled={closeDocumentDisabled}
            label={messages.closeTab}
            shortcut={DEFAULT_KEYBINDINGS.closeTab}
            onClick={() => runDocumentCommand(onCloseDocument)}
          />
          <MenuCommand
            disabled={reopenDocumentDisabled}
            label={messages.reopenClosedTab}
            shortcut={DEFAULT_KEYBINDINGS.reopenClosedTab}
            onClick={() => runDocumentCommand(onReopenDocument)}
          />
        </div>}
      </div>
      <button disabled title={messages.editMenuUnavailable} type="button">
        {messages.editMenu}
      </button>
      <div className="web-menu-entry" data-menu-open={openMenu === "view"}>
        <button
          aria-expanded={openMenu === "view"}
          className="web-menu-trigger"
          onClick={(event) => {
            event.preventDefault();
            setOpenMenu((current) => current === "view" ? null : "view");
          }}
          ref={viewTrigger}
          type="button"
        >
          {messages.viewMenu}
        </button>
        {openMenu === "view" && <div className="web-menu-popover">
          <MenuCommand
            active={dockVisible}
            label={messages.toggleDock}
            shortcut={DEFAULT_KEYBINDINGS.toggleDock}
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
            shortcut={DEFAULT_KEYBINDINGS.toggleParameters}
            onClick={() => runLayoutAction(toggleSheet("parameter"))}
          />
          <MenuCommand
            active={consoleVisible}
            label={messages.toggleConsole}
            shortcut={DEFAULT_KEYBINDINGS.toggleConsole}
            onClick={() => runLayoutAction(toggleSheet("console"))}
          />
          {!narrow && (
            <>
              <MenuCommand
                active={layout.maximized === "editor"}
                label={layout.maximized === "editor" ? messages.restoreEditor : messages.maximizeEditor}
                shortcut={DEFAULT_KEYBINDINGS.maximizeEditor}
                onClick={() => runLayoutAction({ kind: "toggle-maximize", region: "editor" })}
              />
              <MenuCommand
                active={layout.maximized === "viewer"}
                label={layout.maximized === "viewer" ? messages.restoreViewer : messages.maximizeViewer}
                shortcut={DEFAULT_KEYBINDINGS.maximizeViewer}
                onClick={() => runLayoutAction({ kind: "toggle-maximize", region: "viewer" })}
              />
            </>
          )}
          <MenuCommand
            label={messages.resetLayout}
            onClick={() => runLayoutAction({ kind: "reset-layout" })}
          />
        </div>}
      </div>
      <div className="web-menu-entry" data-menu-open={openMenu === "render"}>
        <button
          aria-expanded={openMenu === "render"}
          className="web-menu-trigger"
          onClick={(event) => {
            event.preventDefault();
            setOpenMenu((current) => current === "render" ? null : "render");
          }}
          ref={renderTrigger}
          type="button"
        >
          {messages.renderMenu}
        </button>
        {openMenu === "render" && <div className="web-menu-popover">
          <button
            aria-label={messages.renderPreview}
            disabled={renderDisabled}
            onClick={() => {
              onRenderPreview();
              closeOpenMenu();
            }}
            type="button"
          >
            <span>{messages.renderPreview}</span>
          </button>
        </div>}
      </div>
      <button disabled title={messages.helpMenuUnavailable} type="button">
        {messages.helpMenu}
      </button>
    </nav>
  );
}
