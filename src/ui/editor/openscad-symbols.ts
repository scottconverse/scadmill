import type { Completion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

import { parseProjectPath } from "../../application/files/project-path";
import {
  openScadCurrentFileSymbolDescriptions,
  openScadCurrentFileSymbolDetails,
  openScadProjectFileSymbolDescriptions,
} from "../../messages/en";
import { parser } from "./generated/openscad-parser";

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

export interface OpenScadProjectSources {
  readonly documentPath: string;
  readonly sources: Pick<ReadonlyMap<string, string>, "get">;
}

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

interface ProjectReference {
  readonly kind: "include" | "use";
  readonly path: string;
}

type ProjectVisibility = "all" | "callable";
const MAX_PROJECT_COMPLETION_FILES = 64;
const MAX_PROJECT_COMPLETION_FILE_CODE_UNITS = 50_000;
const MAX_PROJECT_COMPLETION_TOTAL_CODE_UNITS = 100_000;
const MAX_PROJECT_COMPLETION_REFERENCES = 512;
const MAX_PROJECT_COMPLETION_SYMBOLS = 1_024;

type ProjectFileEvent =
  | { readonly kind: "reference"; readonly reference: ProjectReference }
  | { readonly kind: "symbol"; readonly completion: OpenScadUserCompletion };

interface CachedProjectFile {
  readonly source: string;
  readonly events: readonly ProjectFileEvent[];
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

function projectFileEvents(source: string, projectPath: string): readonly ProjectFileEvent[] {
  const tree = parser.parse(source);
  const read = (from: number, to: number) => source.slice(from, to);
  const events: ProjectFileEvent[] = [];
  let references = 0;
  let symbols = 0;
  let node = tree.topNode.firstChild;
  while (node && references < MAX_PROJECT_COMPLETION_REFERENCES && symbols < MAX_PROJECT_COMPLETION_SYMBOLS) {
    const reference = projectReference(read, node);
    if (reference) {
      events.push({ kind: "reference", reference });
      references += 1;
    } else {
      const completion = node.name === "ModuleDeclaration"
        ? callableCompletion(read, node, "module", projectPath)
        : node.name === "FunctionDeclaration"
          ? callableCompletion(read, node, "function", projectPath)
          : node.name === "AssignmentStatement"
            ? variableCompletion(read, node, projectPath)
            : null;
      if (completion) {
        events.push({ kind: "symbol", completion });
        symbols += 1;
      }
    }
    node = node.nextSibling;
  }
  return events;
}

export class OpenScadProjectCompletionCache {
  private readonly entries = new Map<string, CachedProjectFile>();
  private codeUnits = 0;

  read(path: string, source: string): CachedProjectFile | null {
    const existing = this.entries.get(path);
    if (existing?.source === source) {
      this.entries.delete(path);
      this.entries.set(path, existing);
      return existing;
    }
    if (existing) {
      this.entries.delete(path);
      this.codeUnits -= existing.source.length;
    }
    if (source.length > MAX_PROJECT_COMPLETION_FILE_CODE_UNITS) return null;
    while (
      this.entries.size > 0
      && (
        this.entries.size >= MAX_PROJECT_COMPLETION_FILES
        || this.codeUnits + source.length > MAX_PROJECT_COMPLETION_TOTAL_CODE_UNITS
      )
    ) {
      const oldestPath = this.entries.keys().next().value as string | undefined;
      if (oldestPath === undefined) break;
      const oldest = this.entries.get(oldestPath);
      this.entries.delete(oldestPath);
      this.codeUnits -= oldest?.source.length ?? 0;
    }
    const parsed = { source, events: projectFileEvents(source, path) };
    this.entries.set(path, parsed);
    this.codeUnits += source.length;
    return parsed;
  }
}

function rootProjectReferences(
  state: EditorState,
): readonly ProjectReference[] {
  const read = (from: number, to: number) => state.sliceDoc(from, to);
  const references: ProjectReference[] = [];
  let node = syntaxTree(state).topNode.firstChild;
  while (node && references.length < MAX_PROJECT_COMPLETION_REFERENCES) {
    const reference = projectReference(read, node);
    if (reference) references.push(reference);
    node = node.nextSibling;
  }
  return references;
}

export function projectFileCompletions(
  state: EditorState,
  project: OpenScadProjectSources,
  cache = new OpenScadProjectCompletionCache(),
): readonly OpenScadUserCompletion[] {
  const completions: CompletionMap = new Map();
  const visited = new Map<string, ProjectVisibility>();
  const visiting = new Set<string>();
  try {
    visited.set(parseProjectPath(project.documentPath), "all");
  } catch {
    return [];
  }

  let parsedFiles = 0;
  let parsedCodeUnits = 0;
  let followedReferences = 0;
  let collectedSymbols = 0;
  let exhausted = false;

  const visit = (path: string, visibility: ProjectVisibility): void => {
    if (exhausted || visiting.has(path)) return;
    const previousVisibility = visited.get(path);
    if (previousVisibility === "all" || previousVisibility === visibility) return;
    visited.set(path, visibility);
    const source = project.sources.get(path);
    if (source === undefined || source.length > MAX_PROJECT_COMPLETION_FILE_CODE_UNITS) return;
    if (
      parsedFiles >= MAX_PROJECT_COMPLETION_FILES
      || parsedCodeUnits + source.length > MAX_PROJECT_COMPLETION_TOTAL_CODE_UNITS
    ) return;
    const parsed = cache.read(path, source);
    if (!parsed) return;
    parsedFiles += 1;
    parsedCodeUnits += source.length;
    visiting.add(path);
    for (const event of parsed.events) {
      if (event.kind === "symbol") {
        if (visibility === "all" || event.completion.symbolKind !== "variable") {
          if (collectedSymbols >= MAX_PROJECT_COMPLETION_SYMBOLS) {
            exhausted = true;
            break;
          }
          completions.set(
            `${event.completion.symbolKind}:${event.completion.label}`,
            event.completion,
          );
          collectedSymbols += 1;
        }
        continue;
      }
      if (followedReferences >= MAX_PROJECT_COMPLETION_REFERENCES) {
        exhausted = true;
        break;
      }
      followedReferences += 1;
      visit(
        event.reference.path,
        visibility === "all" && event.reference.kind === "include" ? "all" : "callable",
      );
    }
    visiting.delete(path);
  };

  for (const reference of rootProjectReferences(state)) {
    if (followedReferences >= MAX_PROJECT_COMPLETION_REFERENCES) break;
    followedReferences += 1;
    visit(reference.path, reference.kind === "include" ? "all" : "callable");
  }
  return [...completions.values()];
}
