import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags } from "@lezer/highlight";

import { parser } from "./generated/openscad-parser";
import { scadHighlightTags } from "./openscad-highlight-tags";
import { openScadCompletionSource } from "./openscad-completion";

const openScadParser = parser.configure({
  props: [
    styleTags({
      "ModuleKeyword FunctionKeyword IfKeyword ElseKeyword ForKeyword IntersectionForKeyword LetKeyword EachKeyword IncludeKeyword UseKeyword":
        tags.keyword,
      "Builtin AssertKeyword EchoKeyword": tags.standard(tags.variableName),
      "ModuleDeclaration/Identifier FunctionDeclaration/Identifier ModuleCallStatement/Identifier FunctionCall/Identifier":
        scadHighlightTags.userModule,
      "AssignmentStatement/Builtin Binding/Builtin": scadHighlightTags.userModule,
      Number: tags.number,
      "String Path": tags.string,
      Boolean: tags.bool,
      Constant: tags.atom,
      SpecialVariable: scadHighlightTags.specialVariable,
      "LineComment BlockComment": tags.comment,
      "Assign Plus Minus Multiply Divide Modulo Not And Or Equal NotEqual Less LessEqual Greater GreaterEqual Question Colon":
        tags.operator,
      Modifier: scadHighlightTags.modifierChar,
      "LParen RParen LBracket RBracket LBrace RBrace Comma Semicolon": tags.punctuation,
    }),
  ],
});

export const openScadLanguage = LRLanguage.define({
  parser: openScadParser,
  languageData: {
    autocomplete: openScadCompletionSource,
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", '"'] },
  },
});

export function openScad(): LanguageSupport {
  return new LanguageSupport(openScadLanguage);
}

export function parseOpenScad(source: string) {
  return openScadParser.parse(source);
}
