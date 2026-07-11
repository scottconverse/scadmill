import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

import openScadSignatures from "../../language/openscad-signatures.json";
import { openScadCompletionDescriptions } from "../../messages/en";
import {
  OPENSCAD_BUILTIN_FUNCTIONS,
  OPENSCAD_BUILTIN_MODULES,
  OPENSCAD_CONTEXTUAL_BUILTINS,
  OPENSCAD_SPECIAL_VARIABLES,
} from "./openscad-builtins";
import {
  currentFileCompletions,
  type OpenScadUserCompletion,
  projectSymbolCompletion,
  rootProjectReferences,
} from "./openscad-symbols";
import {
  OpenScadProjectIndexClient,
  type ProjectIndexWorkerFactory,
} from "./openscad-project-index-client";

type OpenScadCompletionName = keyof typeof openScadCompletionDescriptions;

export interface OpenScadProjectCompletionContext {
  readonly documentPath: string;
  readonly revision?: string;
  readonly sources: Pick<ReadonlyMap<string, string>, "get">;
}

export type OpenScadProjectCompletionProvider =
  () => OpenScadProjectCompletionContext | undefined;

export type DisposableCompletionSource = CompletionSource & { dispose(): void };

export interface OpenScadCompletion extends Completion {
  label: OpenScadCompletionName;
  detail: string;
  info: string;
}

const OPENSCAD_SIGNATURES: Record<OpenScadCompletionName, string> = openScadSignatures;

const moduleNames = new Set<string>([
  ...OPENSCAD_BUILTIN_MODULES,
  ...OPENSCAD_CONTEXTUAL_BUILTINS,
]);
const expressionNames = new Set<string>([
  ...OPENSCAD_BUILTIN_FUNCTIONS,
  "assert",
  "let",
  ...OPENSCAD_SPECIAL_VARIABLES,
]);
const specialVariableNames = new Set<string>(OPENSCAD_SPECIAL_VARIABLES);

function completionType(name: OpenScadCompletionName): string {
  if (specialVariableNames.has(name)) return "constant";
  if (OPENSCAD_CONTEXTUAL_BUILTINS.some((candidate) => candidate === name)) return "keyword";
  return "function";
}

export const OPENSCAD_COMPLETIONS: readonly OpenScadCompletion[] = Object.entries(
  OPENSCAD_SIGNATURES,
).map(([label, detail]) => {
  const name = label as OpenScadCompletionName;
  return {
    label: name,
    detail,
    info: openScadCompletionDescriptions[name],
    type: completionType(name),
    ...(name === "cube" ? { apply: "cube(size = 1, center = false);" } : {}),
  };
});

const excludedNodeNames = new Set(["BlockComment", "LineComment", "Path", "String"]);
const expressionTriggerCharacters = new Set("=([,?:+-*/%^<>!&|");
const expressionNodeNames = new Set([
  "Argument",
  "AssertExpression",
  "BinaryExpression",
  "Binding",
  "EachComprehension",
  "EchoExpression",
  "FunctionCall",
  "FunctionLiteral",
  "IfComprehension",
  "IndexExpression",
  "LetExpression",
  "ListElement",
  "ListExpression",
  "NamedArgument",
  "ParenthesizedExpression",
  "RangeExpression",
  "TernaryExpression",
  "UnaryExpression",
]);

function hasUnfinishedExcludedRegion(source: string): boolean {
  let mode: "block-comment" | "code" | "line-comment" | "path" | "string" = "code";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (mode === "line-comment") {
      if (character === "\n" || character === "\r") mode = "code";
    } else if (mode === "block-comment") {
      if (character === "*" && next === "/") {
        mode = "code";
        index += 1;
      }
    } else if (mode === "string") {
      if (character === "\\") index += 1;
      else if (character === '"') mode = "code";
    } else if (mode === "path") {
      if (character === ">") mode = "code";
    } else if (character === "/" && next === "/") {
      mode = "line-comment";
      index += 1;
    } else if (character === "/" && next === "*") {
      mode = "block-comment";
      index += 1;
    } else if (character === '"') {
      mode = "string";
    } else if (
      character === "<" &&
      /\b(?:include|use)\s*$/.test(source.slice(0, index))
    ) {
      mode = "path";
    }
  }
  return mode !== "code";
}

function isInsideExcludedNode(context: CompletionContext): boolean {
  if (hasUnfinishedExcludedRegion(context.state.doc.sliceString(0, context.pos))) return true;
  let node = syntaxTree(context.state).resolveInner(context.pos, -1);
  while (true) {
    if (excludedNodeNames.has(node.name)) return true;
    if (!node.parent) return false;
    node = node.parent;
  }
}

function isDeclarationName(sourceBeforeWord: string): boolean {
  return /\b(?:function|module)\s*$/.test(sourceBeforeWord);
}

function isCallableParameterName(
  context: CompletionContext,
  from: number,
  sourceBeforeWord: string,
): boolean {
  let node = syntaxTree(context.state).resolveInner(context.pos, -1);
  while (true) {
    if (node.name === "Parameter") {
      return !context.state.doc.sliceString(node.from, from).includes("=");
    }
    if (!node.parent) break;
    node = node.parent;
  }

  const declaration = sourceBeforeWord.match(
    /\b(?:function|module)\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^()]*)$/,
  );
  if (!declaration) return false;
  return !(declaration[1]?.split(",").at(-1) ?? "").includes("=");
}

function isExpressionContext(
  context: CompletionContext,
  from: number,
  sourceBeforeWord: string,
): boolean {
  let node = syntaxTree(context.state).resolveInner(context.pos, -1);
  while (true) {
    if (expressionNodeNames.has(node.name)) return true;
    if (node.name === "AssignmentStatement" || node.name === "FunctionDeclaration") {
      return context.state.doc.sliceString(node.from, from).includes("=");
    }
    if (node.name === "ModuleCallStatement") return false;
    if (!node.parent) break;
    node = node.parent;
  }

  const significantSource = sourceBeforeWord.trimEnd();
  const lastCharacter = significantSource.at(-1);
  return lastCharacter !== undefined && expressionTriggerCharacters.has(lastCharacter);
}

function userCompletionMatchesContext(
  completion: OpenScadUserCompletion,
  specialVariableContext: boolean,
  expressionContext: boolean,
): boolean {
  if (specialVariableContext) {
    return completion.symbolKind === "variable" && completion.label.startsWith("$");
  }
  return expressionContext
    ? completion.symbolKind === "function" || completion.symbolKind === "variable"
    : completion.symbolKind === "module";
}

function builtinCompletionKey(label: string, expressionContext: boolean): string {
  const symbolKind = specialVariableNames.has(label)
    ? "variable"
    : expressionContext
      ? "function"
      : "module";
  return `${symbolKind}:${label}`;
}

interface PreparedCompletion {
  readonly from: number;
  readonly options: Map<string, Completion>;
  readonly specialVariableContext: boolean;
  readonly expressionContext: boolean;
}

function prepareOpenScadCompletion(
  context: CompletionContext,
): PreparedCompletion | null {
  if (isInsideExcludedNode(context)) return null;

  const word = context.matchBefore(/[$A-Za-z_][A-Za-z0-9_$]*$/);
  if (!word && !context.explicit) return null;

  const from = word?.from ?? context.pos;
  const sourceBeforeWord = context.state.doc.sliceString(0, from);
  if (
    isDeclarationName(sourceBeforeWord) ||
    isCallableParameterName(context, from, sourceBeforeWord)
  ) {
    return null;
  }

  const specialVariableContext = word?.text.startsWith("$") ?? false;
  const expressionContext = isExpressionContext(context, from, sourceBeforeWord);
  const names = specialVariableContext
    ? specialVariableNames
    : expressionContext
      ? expressionNames
      : moduleNames;
  const options = new Map<string, Completion>(
    OPENSCAD_COMPLETIONS.filter(({ label }) => names.has(label)).map((completion) => [
      builtinCompletionKey(completion.label, expressionContext),
      completion,
    ]),
  );
  return { from, options, specialVariableContext, expressionContext };
}

function finishOpenScadCompletion(
  context: CompletionContext,
  prepared: PreparedCompletion,
  projectCompletions: readonly OpenScadUserCompletion[],
): CompletionResult {
  const options = new Map(prepared.options);
  for (const completion of projectCompletions) {
    if (userCompletionMatchesContext(
      completion,
      prepared.specialVariableContext,
      prepared.expressionContext,
    )) {
      options.set(`${completion.symbolKind}:${completion.label}`, completion);
    }
  }
  for (const completion of currentFileCompletions(context.state, context.pos)) {
    if (userCompletionMatchesContext(
      completion,
      prepared.specialVariableContext,
      prepared.expressionContext,
    )) {
      options.set(`${completion.symbolKind}:${completion.label}`, completion);
    }
  }

  return {
    from: prepared.from,
    options: [...options.values()],
    validFor: /[$A-Za-z_][A-Za-z0-9_$]*/,
  };
}

function completeOpenScad(context: CompletionContext): CompletionResult | null {
  const prepared = prepareOpenScadCompletion(context);
  return prepared ? finishOpenScadCompletion(context, prepared, []) : null;
}

export const openScadCompletionSource: CompletionSource = completeOpenScad;

export function createOpenScadCompletionSource(
  project: OpenScadProjectCompletionProvider,
  workerFactory?: ProjectIndexWorkerFactory,
): DisposableCompletionSource {
  const index = new OpenScadProjectIndexClient(workerFactory);
  const source: CompletionSource = async (context) => {
    const prepared = prepareOpenScadCompletion(context);
    if (!prepared) return null;
    const projectContext = project();
    if (!projectContext) return finishOpenScadCompletion(context, prepared, []);
    const references = rootProjectReferences(context.state, projectContext.documentPath);
    if (references.length === 0) return finishOpenScadCompletion(context, prepared, []);

    const controller = new AbortController();
    context.addEventListener("abort", () => controller.abort(), { onDocChange: true });
    try {
      const symbols = await index.index({
        documentPath: projectContext.documentPath,
        references,
        sources: projectContext.sources,
      }, controller.signal);
      if (context.aborted || controller.signal.aborted) return null;
      return finishOpenScadCompletion(
        context,
        prepared,
        symbols.map(projectSymbolCompletion),
      );
    } catch (error) {
      return context.aborted
        || controller.signal.aborted
        || (error instanceof Error && error.name === "AbortError")
        ? null
        : finishOpenScadCompletion(context, prepared, []);
    }
  };
  return Object.assign(source, { dispose: () => index.dispose() });
}
