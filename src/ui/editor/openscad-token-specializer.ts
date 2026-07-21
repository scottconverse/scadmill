import type { Stack } from "@lezer/lr";

import { OPENSCAD_BUILTIN_NAMES } from "./openscad-builtins";
import {
  Boolean as BooleanTerm,
  Builtin,
  Constant,
  AssertKeyword,
  EachKeyword,
  EchoKeyword,
  ElseKeyword,
  ForKeyword,
  FunctionKeyword,
  IfKeyword,
  IncludeKeyword,
  IntersectionForKeyword,
  LetKeyword,
  ModuleKeyword,
  UseKeyword,
} from "./generated/openscad-parser.terms";

const KEYWORDS = new Map<string, number>([
  ["module", ModuleKeyword],
  ["function", FunctionKeyword],
  ["if", IfKeyword],
  ["else", ElseKeyword],
  ["for", ForKeyword],
  ["intersection_for", IntersectionForKeyword],
  ["let", LetKeyword],
  ["each", EachKeyword],
  ["include", IncludeKeyword],
  ["use", UseKeyword],
]);

export function specializeIdentifier(value: string, stack: Stack): number {
  const keyword = KEYWORDS.get(value);
  if (keyword !== undefined) return keyword;
  if (value === "true" || value === "false") return BooleanTerm;
  if (value === "undef" || value === "PI") return Constant;
  if (value === "assert" && stack.canShift(AssertKeyword)) return AssertKeyword;
  if (value === "echo" && stack.canShift(EchoKeyword)) return EchoKeyword;
  return OPENSCAD_BUILTIN_NAMES.has(value) && stack.canShift(Builtin) ? Builtin : -1;
}
