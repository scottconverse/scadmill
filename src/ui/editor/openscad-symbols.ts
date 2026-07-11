import type { Completion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

import { parseProjectPath } from "../../application/files/project-path";
import {
  openScadCurrentFileSymbolDescriptions,
  openScadCurrentFileSymbolDetails,
  openScadProjectFileSymbolDescriptions,
} from "../../messages/en";
import type {
  ProjectIndexedSymbol,
  ProjectReference,
} from "./openscad-project-index";

export type OpenScadUserSymbolKind = "function" | "module" | "variable";

export interface OpenScadUserCompletion extends Completion {
  symbolKind: OpenScadUserSymbolKind;
  detail: string;
  info: string;
  boost: number;
}

type OpenScadSyntaxNode = ReturnType<typeof syntaxTree>["topNode"];
type CompletionMap = Map<string, OpenScadUserCompletion>;
type SourceReader = (from: number, to: number) => string;

function addCompletion(completions: CompletionMap, completion: OpenScadUserCompletion | null) {
  if (completion) completions.set(`${completion.symbolKind}:${completion.label}`, completion);
}

function callableCompletion(
  read: SourceReader,
  node: OpenScadSyntaxNode,
  symbolKind: "function" | "module",
  projectPath?: string,
): OpenScadUserCompletion | null {
  const name = node.getChild("Identifier");
  const parameters = node.getChild("ParameterList");
  if (!name || !parameters) return null;

  const label = read(name.from, name.to);
  return {
    label,
    symbolKind,
    detail: read(name.from, parameters.to),
    info: projectPath
      ? openScadProjectFileSymbolDescriptions[symbolKind](projectPath)
      : openScadCurrentFileSymbolDescriptions[symbolKind],
    type: "function",
    boost: projectPath ? 5 : 10,
  };
}

function variableCompletionFromName(
  read: SourceReader,
  name: OpenScadSyntaxNode | null,
  projectPath?: string,
): OpenScadUserCompletion | null {
  if (!name) return null;
  return {
    label: read(name.from, name.to),
    symbolKind: "variable",
    detail: openScadCurrentFileSymbolDetails.variable,
    info: projectPath
      ? openScadProjectFileSymbolDescriptions.variable(projectPath)
      : openScadCurrentFileSymbolDescriptions.variable,
    type: "variable",
    boost: projectPath ? 5 : 10,
  };
}

function variableCompletion(
  read: SourceReader,
  node: OpenScadSyntaxNode,
  projectPath?: string,
): OpenScadUserCompletion | null {
  return variableCompletionFromName(
    read,
    node.getChild("Identifier") ?? node.getChild("Builtin") ?? node.getChild("SpecialVariable"),
    projectPath,
  );
}

function collectDeclarations(
  read: SourceReader,
  container: OpenScadSyntaxNode,
  into: CompletionMap,
  projectPath?: string,
) {
  let node = container.firstChild;
  while (node) {
    addCompletion(
      into,
      node.name === "ModuleDeclaration"
        ? callableCompletion(read, node, "module", projectPath)
        : node.name === "FunctionDeclaration"
          ? callableCompletion(read, node, "function", projectPath)
          : node.name === "AssignmentStatement"
            ? variableCompletion(read, node, projectPath)
            : null,
    );
    node = node.nextSibling;
  }
}

function collectParameters(state: EditorState, declaration: OpenScadSyntaxNode, into: CompletionMap) {
  const read = (from: number, to: number) => state.sliceDoc(from, to);
  const parameters = declaration.getChild("ParameterList");
  let parameter = parameters?.firstChild ?? null;
  while (parameter) {
    if (parameter.name === "Parameter") {
      addCompletion(into, variableCompletionFromName(read, parameter.getChild("Identifier")));
    }
    parameter = parameter.nextSibling;
  }
}

function collectForBindings(state: EditorState, loop: OpenScadSyntaxNode, into: CompletionMap) {
  const read = (from: number, to: number) => state.sliceDoc(from, to);
  const specification = loop.getChild("ForSpecification");
  let list = specification?.firstChild ?? null;
  while (list) {
    if (list.name === "BindingList") {
      let binding = list.firstChild;
      while (binding) {
        if (binding.name === "Binding") addCompletion(into, variableCompletion(read, binding));
        binding = binding.nextSibling;
      }
    }
    list = list.nextSibling;
  }
}

function collectLetBindings(state: EditorState, scope: OpenScadSyntaxNode, into: CompletionMap) {
  const read = (from: number, to: number) => state.sliceDoc(from, to);
  const container = scope.name === "LetStatement" ? scope : scope.getChild("ArgumentList");
  let argument = container?.firstChild ?? null;
  while (argument) {
    if (argument.name === "Argument") {
      const binding = argument.getChild("NamedArgument");
      if (binding) addCompletion(into, variableCompletion(read, binding));
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
  const read = (from: number, to: number) => state.sliceDoc(from, to);
  collectDeclarations(read, syntaxTree(state).topNode, completions);

  for (const scope of scopeChain(state, position)) {
    if (scope.name === "Block") collectDeclarations(read, scope, completions);
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

function projectReference(
  read: SourceReader,
  node: OpenScadSyntaxNode,
): ProjectReference | null {
  if (node.name !== "IncludeStatement" && node.name !== "UseStatement") return null;
  const pathNode = node.getChild("Path");
  if (!pathNode) return null;
  const literal = read(pathNode.from, pathNode.to);
  if (!literal.startsWith("<") || !literal.endsWith(">")) return null;
  try {
    return {
      kind: node.name === "IncludeStatement" ? "include" : "use",
      path: parseProjectPath(literal.slice(1, -1)),
    };
  } catch {
    return null;
  }
}

export function rootProjectReferences(
  state: EditorState,
): readonly ProjectReference[] {
  const read = (from: number, to: number) => state.sliceDoc(from, to);
  const references: ProjectReference[] = [];
  let node = syntaxTree(state).topNode.firstChild;
  while (node && references.length < 512) {
    const reference = projectReference(read, node);
    if (reference) references.push(reference);
    node = node.nextSibling;
  }
  return references;
}

export function projectSymbolCompletion(
  symbol: ProjectIndexedSymbol,
): OpenScadUserCompletion {
  return {
    label: symbol.label,
    symbolKind: symbol.symbolKind,
    detail: symbol.detail,
    info: openScadProjectFileSymbolDescriptions[symbol.symbolKind](symbol.projectPath),
    type: symbol.symbolKind === "variable" ? "variable" : "function",
    boost: 5,
  };
}
