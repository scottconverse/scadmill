export type EditorCommandId =
  | "find"
  | "replace"
  | "go-to-line"
  | "go-to-definition"
  | "toggle-comment"
  | "format-document"
  | "format-selection"
  | "undo"
  | "redo"
  | "multi-cursor-add";

export type DirectEditorCommandId = Exclude<
  EditorCommandId,
  "go-to-definition" | "multi-cursor-add"
>;

export type EditorCommandUnavailableReason =
  | "project-symbol-navigation-unavailable"
  | "syntax-error";

export type EditorCommandOutcome =
  | { command: EditorCommandId; status: "handled" }
  | {
      command: EditorCommandId;
      status: "unavailable";
      reason: EditorCommandUnavailableReason;
    };
