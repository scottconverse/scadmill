import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const MAX_MINIMAP_ROWS = 240;

function renderMinimap(editor: EditorView, minimap: HTMLElement): void {
  const fragment = document.createDocumentFragment();
  const lineCount = editor.state.doc.lines;
  const step = Math.max(1, Math.ceil(lineCount / MAX_MINIMAP_ROWS));
  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += step) {
    const line = editor.state.doc.line(lineNumber);
    const row = document.createElement("span");
    row.className = "cm-minimap-line";
    row.style.inlineSize = `${Math.min(100, Math.max(8, line.length * 2))}%`;
    fragment.append(row);
  }
  minimap.replaceChildren(fragment);
}

export const minimapExtension = ViewPlugin.fromClass(class {
  readonly dom: HTMLDivElement;

  constructor(editor: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-minimap";
    this.dom.setAttribute("aria-hidden", "true");
    editor.dom.append(this.dom);
    renderMinimap(editor, this.dom);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) renderMinimap(update.view, this.dom);
  }

  destroy(): void {
    this.dom.remove();
  }
});
