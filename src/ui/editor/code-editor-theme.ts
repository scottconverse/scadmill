import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { scadHighlightTags } from "./openscad-highlight-tags";

const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--editor-background)",
    color: "var(--editor-text)",
  },
  ".cm-content": {
    caretColor: "var(--editor-cursor)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--editor-cursor)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--editor-selection)",
  },
  ".cm-selected-text": {
    color: "var(--editor-text) !important",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--editor-active-line)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--editor-background)",
    color: "var(--editor-line-number)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--editor-active-line)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "var(--editor-matching-bracket)",
    outlineColor: "var(--editor-matching-bracket)",
  },
  ".cm-diagnostic-error, .cm-lintRange-error": {
    backgroundImage: "none",
    borderLeftColor: "var(--editor-squiggle-error)",
    textDecorationColor: "var(--editor-squiggle-error)",
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textUnderlineOffset: "2px",
  },
  ".cm-diagnostic-warning, .cm-lintRange-warning": {
    backgroundImage: "none",
    borderLeftColor: "var(--editor-squiggle-warning)",
    textDecorationColor: "var(--editor-squiggle-warning)",
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textUnderlineOffset: "2px",
  },
  ".cm-lintRange-active": {
    backgroundColor: "var(--editor-active-line)",
  },
  ".cm-lintPoint:after": {
    borderBottomColor: "var(--editor-squiggle-error)",
  },
  ".cm-lintPoint-warning:after": {
    borderBottomColor: "var(--editor-squiggle-warning)",
  },
  ".cm-lint-marker-error": {
    boxSizing: "border-box",
    border: "2px solid var(--editor-squiggle-error)",
    borderRadius: "50%",
    backgroundColor: "var(--editor-squiggle-error)",
    content: '""',
  },
  ".cm-lint-marker-warning": {
    width: ".72em",
    height: ".72em",
    margin: ".14em",
    borderRadius: "1px",
    backgroundColor: "var(--editor-squiggle-warning)",
    content: '""',
    transform: "rotate(45deg)",
  },
  ".cm-tooltip": {
    borderColor: "var(--chrome-border)",
    backgroundColor: "var(--chrome-surface-raised)",
    color: "var(--chrome-text)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--chrome-active)",
    color: "var(--chrome-text)",
  },
  ".cm-completionDetail": {
    color: "var(--chrome-text-muted)",
  },
  ".cm-completionInfo": {
    borderColor: "var(--chrome-border)",
    backgroundColor: "var(--chrome-surface-raised)",
    color: "var(--chrome-text)",
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--editor-syntax-keyword)" },
  {
    tag: tags.standard(tags.variableName),
    color: "var(--editor-syntax-builtin)",
  },
  { tag: scadHighlightTags.userModule, color: "var(--editor-syntax-user-module)" },
  { tag: tags.number, color: "var(--editor-syntax-number)" },
  { tag: tags.string, color: "var(--editor-syntax-string)" },
  { tag: tags.bool, color: "var(--editor-syntax-boolean)" },
  {
    tag: scadHighlightTags.specialVariable,
    color: "var(--editor-syntax-special-variable)",
  },
  { tag: tags.comment, color: "var(--editor-syntax-comment)" },
  { tag: tags.operator, color: "var(--editor-syntax-operator)" },
  {
    tag: scadHighlightTags.modifierChar,
    color: "var(--editor-syntax-modifier-char)",
  },
  { tag: tags.punctuation, color: "var(--editor-syntax-punctuation)" },
]);

const selectedTextMark = Decoration.mark({ class: "cm-selected-text" });

function selectedTextDecorations(view: EditorView): DecorationSet {
  const ranges = view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => selectedTextMark.range(range.from, range.to));
  return Decoration.set(ranges, true);
}

const selectedTextForeground = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = selectedTextDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = selectedTextDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

export const codeEditorTheme: Extension = [
  editorTheme,
  syntaxHighlighting(highlightStyle),
  selectedTextForeground,
];
