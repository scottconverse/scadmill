import type {
  WorkspaceLayoutAction,
  WorkspaceLayoutState,
} from "../../application/layout/workspace-layout";
import { messages } from "../../messages/en";
import { useRef, useState } from "react";

export interface WebMenuBarProps {
  layout: WorkspaceLayoutState;
  narrow: boolean;
  renderDisabled: boolean;
  onLayoutAction(action: WorkspaceLayoutAction): void;
  onRenderPreview(): void;
}

interface MenuCommandProps {
  active?: boolean;
  label: string;
  shortcut?: string;
  onClick(): void;
}

function MenuCommand({ active, label, shortcut, onClick }: MenuCommandProps) {
  return (
    <button aria-label={label} aria-pressed={active} onClick={onClick} type="button">
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

export function WebMenuBar({
  layout,
  narrow,
  renderDisabled,
  onLayoutAction,
  onRenderPreview,
}: WebMenuBarProps) {
  const [openMenu, setOpenMenu] = useState<"view" | "render" | null>(null);
  const viewTrigger = useRef<HTMLButtonElement>(null);
  const renderTrigger = useRef<HTMLButtonElement>(null);
  const closeOpenMenu = () => {
    const trigger = openMenu === "view" ? viewTrigger.current : renderTrigger.current;
    setOpenMenu(null);
    trigger?.focus();
  };
  const runLayoutAction = (action: WorkspaceLayoutAction) => {
    onLayoutAction(action);
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
      onKeyDown={(event) => {
        if (event.key !== "Escape" || openMenu === null) return;
        event.preventDefault();
        closeOpenMenu();
      }}
    >
      <button disabled title={messages.fileMenuUnavailable} type="button">
        {messages.fileMenu}
      </button>
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
            shortcut="Mod+B"
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
            shortcut="Mod+Shift+B"
            onClick={() => runLayoutAction(toggleSheet("parameter"))}
          />
          <MenuCommand
            active={consoleVisible}
            label={messages.toggleConsole}
            shortcut="Mod+J"
            onClick={() => runLayoutAction(toggleSheet("console"))}
          />
          {!narrow && (
            <>
              <MenuCommand
                active={layout.maximized === "editor"}
                label={layout.maximized === "editor" ? messages.restoreEditor : messages.maximizeEditor}
                shortcut="Mod+Shift+E"
                onClick={() => runLayoutAction({ kind: "toggle-maximize", region: "editor" })}
              />
              <MenuCommand
                active={layout.maximized === "viewer"}
                label={layout.maximized === "viewer" ? messages.restoreViewer : messages.maximizeViewer}
                shortcut="Mod+Shift+V"
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
