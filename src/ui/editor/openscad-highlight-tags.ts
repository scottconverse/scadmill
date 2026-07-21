import { Tag, tags } from "@lezer/highlight";

export const scadHighlightTags = {
  userModule: Tag.define("scad-user-module", tags.variableName),
  specialVariable: Tag.define("scad-special-variable", tags.variableName),
  modifierChar: Tag.define("scad-modifier-char", tags.punctuation),
} as const;
