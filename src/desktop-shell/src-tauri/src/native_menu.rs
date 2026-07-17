use serde::Deserialize;
use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItemKind, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file = SubmenuBuilder::new(app, "File")
        .text("file.new", "New File")
        .text("file.open", "Open Project…")
        .separator()
        .text("file.save", "Save")
        .text("file.save-all", "Save All")
        .text("file.export", "Export Model…")
        .separator()
        .text("file.close", "Close Tab")
        .text("file.reopen", "Reopen Closed Tab")
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .text("edit.find", "Find")
        .text("edit.replace", "Replace")
        .text("edit.go-to-line", "Go to Line")
        .separator()
        .text("edit.toggle-comment", "Toggle Comment")
        .text("edit.format-document", "Format Document")
        .text("edit.format-selection", "Format Selection")
        .separator()
        .text("edit.undo", "Undo")
        .text("edit.redo", "Redo")
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .check("view.toggle-dock", "Toggle Left Dock")
        .check("view.toggle-editor", "Toggle Editor")
        .check("view.toggle-viewer", "Toggle Viewer")
        .check("view.toggle-parameters", "Toggle Parameter Panel")
        .check("view.toggle-console", "Toggle Console")
        .separator()
        .check("view.maximize-editor", "Maximize Editor")
        .check("view.maximize-viewer", "Maximize Viewer")
        .text("view.reset-layout", "Reset Layout")
        .build()?;
    let render = SubmenuBuilder::new(app, "Render")
        .text("render.preview", "Render Preview")
        .text("render.full", "Full Render")
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .text("help.show", "ScadMill Help")
        .build()?;
    let menu = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let menu = {
        let application = SubmenuBuilder::new(app, "ScadMill")
            .about(None)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu.item(&application)
    };
    menu.item(&file)
        .item(&edit)
        .item(&view)
        .item(&render)
        .item(&help)
        .build()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMenuItemState {
    id: String,
    enabled: bool,
    checked: Option<bool>,
    accelerator: Option<String>,
}

fn find_item<R: Runtime>(items: Vec<MenuItemKind<R>>, id: &str) -> Option<MenuItemKind<R>> {
    for item in items {
        if item.id().as_ref() == id {
            return Some(item);
        }
        if let MenuItemKind::Submenu(submenu) = &item
            && let Ok(children) = submenu.items()
            && let Some(found) = find_item(children, id)
        {
            return Some(found);
        }
    }
    None
}

fn apply_all<T>(
    items: Vec<T>,
    mut apply: impl FnMut(T) -> Result<(), String>,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for item in items {
        if let Err(error) = apply(item) {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_native_menu_state(
    app: AppHandle,
    items: Vec<NativeMenuItemState>,
) -> Result<(), String> {
    let menu = app
        .menu()
        .ok_or_else(|| "The native application menu is unavailable.".to_string())?;
    apply_all(items, |state| {
        let item = find_item(menu.items().map_err(|error| error.to_string())?, &state.id)
            .ok_or_else(|| format!("Unknown native menu item: {}", state.id))?;
        match item {
            MenuItemKind::MenuItem(item) => {
                item.set_enabled(state.enabled)
                    .map_err(|error| error.to_string())?;
                item.set_accelerator(state.accelerator.as_deref())
                    .map_err(|error| error.to_string())?;
            }
            MenuItemKind::Check(item) => {
                item.set_enabled(state.enabled)
                    .map_err(|error| error.to_string())?;
                item.set_checked(state.checked.unwrap_or(false))
                    .map_err(|error| error.to_string())?;
                item.set_accelerator(state.accelerator.as_deref())
                    .map_err(|error| error.to_string())?;
            }
            _ => return Err(format!("Native menu item is not stateful: {}", state.id)),
        }
        Ok(())
    })
}

#[tauri::command]
pub fn disable_native_menu(app: AppHandle) -> Result<(), String> {
    app.remove_menu().map_err(|error| error.to_string())?;
    Ok(())
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let _ = app.emit("scadmill://menu-command", event.id().as_ref());
}

#[cfg(test)]
mod tests {
    use super::apply_all;

    #[test]
    fn update_batch_continues_after_an_item_fails() {
        let mut attempted = Vec::new();

        let result = apply_all(vec!["first", "broken", "last"], |item| {
            attempted.push(item);
            if item == "broken" {
                Err("broken item".to_string())
            } else {
                Ok(())
            }
        });

        assert_eq!(attempted, vec!["first", "broken", "last"]);
        assert_eq!(result, Err("broken item".to_string()));
    }
}
