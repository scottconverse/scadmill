import type { Completion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

import {
  openScadCurrentFileSymbolDescriptions,
  openScadCurrentFileSymbolDetails,
} from "../../messages/en";

export type OpenScadUserSymbolKind = "function" | "module" | "variable";

export interface OpenScadUserCompletion extends Completion {
  symbolKind: OpenScadUserSymbolKind;
  detail: string;
  info: string;
  boost: number;
}

type OpenScadSyntaxNode = ReturnType<typeof syntaxTree>["topNode"];
type CompletionMap = Map<string, OpenScadUserCompletion>;

function addCompletion(completions: CompletionMap, completion: OpenScadUserCompletion | null) {
  if (completion) completions.set(`${completion.symbolKind}:${completion.label}`, completion);
}

function callableCompletion(
  state: EditorState,
  node: OpenScadSyntaxNode,
  symbolKind: "function" | "module",
): OpenScadUserCompletion | null {
  const name = node.getChild("Identifier");
  const parameters = node.getChild("ParameterList");
  if (!name || !parameters) return null;

  const label = state.sliceDoc(name.from, name.to);
  return {
    label,
    symbolKind,
    detail: state.sliceDoc(name.from, parameters.to),
    info: openScadCurrentFileSymbolDescriptions[symbolKind],
    type: "function",
    boost: 10,
  };
}

function variableCompletionFromName(
  state: EditorState,
  name: OpenScadSyntaxNode | null,
): OpenScadUserCompletion | null {
  if (!name) return null;
  return {
    label: state.sliceDoc(name.from, name.to),
    symbolKind: "variable",
    detail: openScadCurrentFileSymbolDetails.variable,
    info: openScadCurrentFileSymbolDescriptions.variable,
    type: "variable",
    boost: 10,
  };
}

function variableCompletion(
  state: EditorState,
  node: OpenScadSyntaxNode,
): OpenScadUserCompletion | null {
  return variableCompletionFromName(
    state,
    node.getChild("Identifier") ?? node.getChild("Builtin") ?? node.getChild("SpecialVariable"),
  );
}

function collectDeclarations(state: EditorState, container: OpenScadSyntaxNode, into: CompletionMap) {
  let node = container.firstChild;
  while (node) {
    addCompletion(
      into,
      node.name === "ModuleDeclaration"
        ? callableCompletion(state, node, "module")
        : node.name === "FunctionDeclaration"
          ? callableCompletion(state, node, "function")
          : node.name === "AssignmentStatement"
            ? variableCompletion(state, node)
            : null,
    );
    node = node.nextSibling;
  }
}

function collectParameters(state: EditorState, declaration: OpenScadSyntaxNode, into: CompletionMap) {
  const parameters = declaration.getChild("ParameterList");
  let parameter = parameters?.firstChild ?? null;
  while (parameter) {
    if (parameter.name === "Parameter") {
      addCompletion(into, variableCompletionFromName(state, parameter.getChild("Identifier")));
    }
    parameter = parameter.nextSibling;
  }
}

function collectForBindings(state: EditorState, loop: OpenScadSyntaxNode, into: CompletionMap) {
  const specification = loop.getChild("ForSpecification");
  let list = specification?.firstChild ?? null;
  while (list) {
    if (list.name === "BindingList") {
      let binding = list.firstChild;
      while (binding) {
        if (binding.name === "Binding") addCompletion(into, variableCompletion(state, binding));
        binding = binding.nextSibling;
      }
    }
    list = list.nextSibling;
  }
}

function collectLetBindings(state: EditorState, scope: OpenScadSyntaxNode, into: CompletionMap) {
  const container = scope.name === "LetStatement" ? scope : scope.getChild("ArgumentList");
  let argument = container?.firstChild ?? null;
  while (argument) {
    if (argument.name === "Argument") {
      const binding = argument.getChild("NamedArgument");
      if (binding) addCompletion(into, variableCompletion(state, binding));
    }
    argument = argument.nextSibling;
  }
}

function scopeChain(state: EditorState, position: number): OpenScadSyntaxNode[] {
  const scopes: OpenScadSyntaxNode[] = [];
  let node: OpenScadSyntaxNode | null = syntaxTree(state).resolveInner(position, -1);
  while (node) {
    scopes.push(node);
    node = node.parent;
  }
  return scopes.reverse();
}

export function currentFileCompletions(
  state: EditorState,
  position: number,
): readonly OpenScadUserCompletion[] {
  const completions: CompletionMap = new Map();
  collectDeclarations(state, syntaxTree(state).topNode, completions);

  for (const scope of scopeChain(state, position)) {
    if (scope.name === "Block") collectDeclarations(state, scope, completions);
    if (
      scope.name === "ModuleDeclaration" ||
      scope.name === "FunctionDeclaration" ||
      scope.name === "FunctionLiteral"
    ) {
      collectParameters(state, scope, completions);
    }
    if (scope.name === "ForStatement" || scope.name === "ForComprehension") {
      collectForBindings(state, scope, completions);
    }
    if (scope.name === "LetStatement" || scope.name === "LetExpression") {
      collectLetBindings(state, scope, completions);
    }
  }

  return [...completions.values()];
}
