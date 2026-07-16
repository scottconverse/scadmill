import { parseOpenScad } from "./openscad-language";

export interface OpenScadFormatOptions {
  readonly indentSize: number;
}

export type OpenScadFormatResult =
  | { readonly status: "formatted"; readonly source: string }
  | { readonly status: "refused"; readonly reason: "syntax-error"; readonly source: string };

type TokenKind = "block-comment" | "line-comment" | "number" | "path" | "string" | "symbol" | "word";

interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly gap: string;
}

const BINARY_OPERATORS = new Set([
  "=", "+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "&&", "||", "?",
]);
const PAREN_KEYWORDS = new Set(["assert", "echo", "for", "if", "intersection_for", "let"]);
const CHAIN_EXCLUSIONS = new Set([
  "assert", "echo", "else", "for", "function", "if", "include", "intersection_for", "let", "module", "use",
]);

function hasSyntaxError(source: string): boolean {
  const cursor = parseOpenScad(source).cursor();
  do {
    if (cursor.type.isError) return true;
  } while (cursor.next());
  return false;
}

function newlineCount(value: string): number {
  return (value.match(/\r\n|\r|\n/g) ?? []).length;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let gap = "";
  let index = 0;
  const push = (kind: TokenKind, end: number) => {
    tokens.push({ kind, gap, value: source.slice(index, end) });
    gap = "";
    index = end;
  };
  while (index < source.length) {
    const character = source[index];
    if (/\s/u.test(character)) {
      gap += character;
      index += 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      let end = index + 2;
      while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end += 1;
      push("line-comment", end);
      continue;
    }
    if (source.startsWith("/*", index)) {
      const closing = source.indexOf("*/", index + 2);
      push("block-comment", closing < 0 ? source.length : closing + 2);
      continue;
    }
    if (character === '"') {
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === "\\") end += 2;
        else if (source[end++] === '"') break;
      }
      push("string", Math.min(end, source.length));
      continue;
    }
    const previous = tokens.at(-1)?.value;
    if (character === "<" && (previous === "include" || previous === "use")) {
      const closing = source.indexOf(">", index + 1);
      push("path", closing < 0 ? source.length : closing + 1);
      continue;
    }
    const word = source.slice(index).match(/^\$?[A-Za-z_][A-Za-z0-9_]*/u)?.[0];
    if (word) {
      push("word", index + word.length);
      continue;
    }
    const number = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u)?.[0];
    if (number) {
      push("number", index + number.length);
      continue;
    }
    const operator = ["&&", "||", "==", "!=", "<=", ">="].find((candidate) =>
      source.startsWith(candidate, index)
    );
    push("symbol", index + (operator?.length ?? 1));
  }
  return tokens;
}

function closingParen(tokens: readonly Token[], start: number): number | null {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === "(") depth += 1;
    if (tokens[index].value === ")" && --depth === 0) return index;
  }
  return null;
}

function transformChainBreaks(tokens: readonly Token[]): ReadonlySet<number> {
  const breaks = new Set<number>();
  for (let start = 0; start < tokens.length; start += 1) {
    const previous = tokens[start - 1]?.value;
    if (start > 0 && previous !== ";" && previous !== "{" && previous !== "}") continue;
    let cursor = start;
    while (["#", "!", "%", "*"].includes(tokens[cursor]?.value)) cursor += 1;
    const closes: number[] = [];
    while (
      tokens[cursor]?.kind === "word"
      && !CHAIN_EXCLUSIONS.has(tokens[cursor].value)
      && tokens[cursor + 1]?.value === "("
    ) {
      const close = closingParen(tokens, cursor + 1);
      if (close === null) break;
      closes.push(close);
      cursor = close + 1;
    }
    if (closes.length >= 3) {
      for (const close of closes.slice(0, -1)) breaks.add(close);
    }
  }
  return breaks;
}

const MAX_EXPRESSION_LINE = 88;

function safeOperatorBreaks(line: string, operators: ReadonlySet<string>): number[] {
  const breaks: number[] = [];
  let escaped = false;
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (line.startsWith("//", index) || line.startsWith("/*", index)) break;
    if (
      character === " "
      && line[index + 2] === " "
      && operators.has(line[index + 1] ?? "")
    ) breaks.push(index + 2);
  }
  return breaks;
}

function wrapLongLine(line: string, indentSize: number): string[] {
  const wrapped: string[] = [];
  let remainder = line;
  const leading = remainder.match(/^\s*/u)?.[0].length ?? 0;
  const continuation = " ".repeat(leading + indentSize);
  while (remainder.length > MAX_EXPRESSION_LINE) {
    const plusCandidates = safeOperatorBreaks(remainder, new Set(["+"]))
      .filter((position) => position <= MAX_EXPRESSION_LINE);
    const otherCandidates = safeOperatorBreaks(remainder, new Set(["*", "/", "-"]))
      .filter((position) => position <= MAX_EXPRESSION_LINE);
    const splitAt = plusCandidates.at(-1) ?? otherCandidates.at(-1);
    if (!splitAt) break;
    wrapped.push(remainder.slice(0, splitAt).trimEnd());
    remainder = continuation + remainder.slice(splitAt).trimStart();
  }
  wrapped.push(remainder.trimEnd());
  return wrapped;
}

function formatTokens(tokens: readonly Token[], indentSize: number): string {
  const lines: string[] = [];
  const chainBreaks = transformChainBreaks(tokens);
  let current = "";
  let indentLevel = 0;
  let nextIndentExtra = 0;
  let ternaryDepth = 0;
  const indentation = (extra = 0) => " ".repeat(Math.max(0, indentLevel + extra) * indentSize);
  const startLine = () => {
    if (current === "") {
      current = indentation(nextIndentExtra);
      nextIndentExtra = 0;
    }
  };
  const append = (value: string) => {
    startLine();
    current += value;
  };
  const trim = () => {
    current = current.trimEnd();
  };
  const endLine = () => {
    trim();
    if (current !== "") lines.push(current);
    current = "";
    nextIndentExtra = 0;
  };
  const addBlankLine = () => {
    endLine();
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (newlineCount(token.gap) >= 2 && current === "") addBlankLine();

    if (token.kind === "line-comment") {
      if (current.trim() !== "") append(` ${token.value}`);
      else append(token.value);
      endLine();
      continue;
    }
    if (token.kind === "block-comment") {
      if (current.trim() !== "") append(` ${token.value}`);
      else {
        const parts = token.value.split(/\r\n|\r|\n/u);
        append(parts[0]);
        for (const part of parts.slice(1)) {
          endLine();
          append(part);
        }
      }
      if (newlineCount(next?.gap ?? "") > 0) endLine();
      continue;
    }
    if (token.value === "{") {
      trim();
      if (current.trim() !== "") append(" ");
      append("{");
      endLine();
      indentLevel += 1;
      continue;
    }
    if (token.value === "}") {
      endLine();
      indentLevel = Math.max(0, indentLevel - 1);
      append("}");
      if (next?.value !== ";" && next?.value !== "else") endLine();
      continue;
    }
    if (token.value === ";") {
      trim();
      append(";");
      if (next?.kind !== "line-comment" || newlineCount(next.gap) > 0) endLine();
      continue;
    }
    if (token.value === ",") {
      trim();
      append(", ");
      continue;
    }
    if (token.value === "(" || token.value === "[") {
      const preservesRequiredSpace = previous?.value === ","
        || BINARY_OPERATORS.has(previous?.value ?? "");
      if (!preservesRequiredSpace) trim();
      if (
        (token.value === "(" && previous?.kind === "word" && PAREN_KEYWORDS.has(previous.value))
        || (token.value === "[" && previous?.value === ")")
      ) append(" ");
      append(token.value);
      continue;
    }
    if (token.value === ")" || token.value === "]") {
      trim();
      append(token.value);
      if (chainBreaks.has(index)) {
        endLine();
        nextIndentExtra = 1;
      }
      continue;
    }
    if (token.value === ":") {
      trim();
      if (ternaryDepth > 0) {
        append(" : ");
        ternaryDepth -= 1;
      } else append(":");
      continue;
    }
    if (token.value === "else") {
      trim();
      if (current.trim() !== "") append(" ");
      append("else");
      continue;
    }
    if (BINARY_OPERATORS.has(token.value)) {
      const unary = ["+", "-", "!"].includes(token.value) && (
        !previous || BINARY_OPERATORS.has(previous.value) || ["(", "[", ",", ":"].includes(previous.value)
      );
      const modifier = ["#", "!", "%", "*"].includes(token.value)
        && (current === "" || current.trim() === indentation().trim());
      trim();
      if (unary || modifier) append(token.value);
      else append(` ${token.value} `);
      if (token.value === "?") ternaryDepth += 1;
      continue;
    }
    if (["#", "!"].includes(token.value)) {
      trim();
      append(token.value);
      continue;
    }
    if (token.value === "<" || token.value === ">") {
      trim();
      append(` ${token.value} `);
      continue;
    }

    const needsSpace = current.trim() !== "" && (
      previous?.kind === "word"
      || previous?.kind === "number"
      || previous?.kind === "string"
      || previous?.kind === "path"
      || previous?.value === ")"
      || previous?.value === "]"
    ) && !["#", "!", "%", "*"].includes(previous?.value ?? "");
    if (needsSpace) {
      trim();
      append(" ");
    }
    append(token.value);
    if (token.kind === "path" && (previous?.value === "include" || previous?.value === "use")) endLine();
  }
  endLine();
  while (lines.at(-1) === "") lines.pop();
  return lines.flatMap((line) => wrapLongLine(line, indentSize)).join("\n");
}

export function formatOpenScad(
  source: string,
  options: OpenScadFormatOptions,
): OpenScadFormatResult {
  if (hasSyntaxError(source)) return { status: "refused", reason: "syntax-error", source };
  return {
    status: "formatted",
    source: formatTokens(tokenize(source), options.indentSize),
  };
}
