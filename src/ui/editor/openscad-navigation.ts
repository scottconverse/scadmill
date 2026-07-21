import { parseProjectPath } from "../../application/files/project-path";
import { parser } from "./generated/openscad-parser";
import {
  type ProjectReference,
  type ProjectSymbolKind,
  resolveProjectReferencePath,
} from "./openscad-project-index";

export interface OpenScadSourceLocation {
  readonly path: string;
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly column: number;
}

export interface OpenScadDefinition extends OpenScadSourceLocation {
  readonly label: string;
  readonly symbolKind: ProjectSymbolKind;
  readonly detail: string;
}

export interface OpenScadReference extends OpenScadSourceLocation {
  readonly label: string;
  readonly symbolKind: ProjectSymbolKind;
}

interface ParsedFile {
  readonly definitions: readonly OpenScadDefinition[];
  readonly references: readonly OpenScadReference[];
  readonly projectReferences: readonly ProjectReference[];
}

type OpenScadSyntaxNode = ReturnType<typeof parser.parse>["topNode"];

const MAX_NAVIGATION_FILES = 512;
const MAX_NAVIGATION_ITEMS_PER_FILE = 16_384;

function location(source: string, path: string, from: number, to: number): OpenScadSourceLocation {
  const before = source.slice(0, from);
  const lastBreak = Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
  const line = (before.match(/\r\n|\r|\n/gu)?.length ?? 0) + 1;
  return { path, from, to, line, column: from - lastBreak };
}

function directName(node: OpenScadSyntaxNode): OpenScadSyntaxNode | null {
  return node.getChild("Identifier")
    ?? node.getChild("SpecialVariable")
    ?? node.getChild("Builtin");
}

function definitionFromNode(
  source: string,
  path: string,
  node: OpenScadSyntaxNode,
): OpenScadDefinition | undefined {
  const symbolKind = node.name === "ModuleDeclaration"
    ? "module"
    : node.name === "FunctionDeclaration"
      ? "function"
      : node.name === "AssignmentStatement"
        ? "variable"
        : undefined;
  if (!symbolKind) return undefined;
  const name = directName(node);
  if (!name) return undefined;
  const label = source.slice(name.from, name.to);
  const parameters = symbolKind === "variable" ? null : node.getChild("ParameterList");
  return {
    ...location(source, path, name.from, name.to),
    label,
    symbolKind,
    detail: parameters ? source.slice(name.from, parameters.to) : "variable",
  };
}

function projectReferenceFromNode(
  source: string,
  path: string,
  node: OpenScadSyntaxNode,
): ProjectReference | undefined {
  if (node.name !== "IncludeStatement" && node.name !== "UseStatement") return undefined;
  const pathNode = node.getChild("Path");
  if (!pathNode) return undefined;
  const literal = source.slice(pathNode.from, pathNode.to);
  if (!literal.startsWith("<") || !literal.endsWith(">")) return undefined;
  try {
    return {
      kind: node.name === "IncludeStatement" ? "include" : "use",
      path: resolveProjectReferencePath(path, literal.slice(1, -1)),
    };
  } catch {
    return undefined;
  }
}

function isBindingIdentifier(node: OpenScadSyntaxNode): boolean {
  const parent = node.parent;
  if (!parent || directName(parent) !== node) return false;
  return parent.name === "ModuleDeclaration"
    || parent.name === "FunctionDeclaration"
    || parent.name === "AssignmentStatement"
    || parent.name === "Parameter"
    || parent.name === "Binding"
    || parent.name === "NamedArgument";
}

function referenceFromNode(
  source: string,
  path: string,
  node: OpenScadSyntaxNode,
): OpenScadReference | undefined {
  if (node.name !== "Identifier" && node.name !== "SpecialVariable") return undefined;
  if (isBindingIdentifier(node)) return undefined;
  const parent = node.parent;
  const symbolKind = parent?.name === "ModuleCallStatement"
    ? "module"
    : parent?.name === "FunctionCall"
      ? "function"
      : "variable";
  return {
    ...location(source, path, node.from, node.to),
    label: source.slice(node.from, node.to),
    symbolKind,
  };
}

function parseFile(source: string, path: string): ParsedFile {
  const definitions: OpenScadDefinition[] = [];
  const references: OpenScadReference[] = [];
  const projectReferences: ProjectReference[] = [];
  const tree = parser.parse(source);
  let visited = 0;
  const visit = (node: OpenScadSyntaxNode): void => {
    if (visited >= MAX_NAVIGATION_ITEMS_PER_FILE) return;
    visited += 1;
    if (node.parent?.name === "Document") {
      const definition = definitionFromNode(source, path, node);
      if (definition) definitions.push(definition);
      const projectReference = projectReferenceFromNode(source, path, node);
      if (projectReference) projectReferences.push(projectReference);
    }
    const reference = referenceFromNode(source, path, node);
    if (reference) references.push(reference);
    let child = node.firstChild;
    while (child && visited < MAX_NAVIGATION_ITEMS_PER_FILE) {
      visit(child);
      child = child.nextSibling;
    }
  };
  visit(tree.topNode);
  return { definitions, references, projectReferences };
}

function parsedProject(sources: ReadonlyMap<string, string>): ReadonlyMap<string, ParsedFile> {
  const result = new Map<string, ParsedFile>();
  for (const [rawPath, source] of [...sources].sort(([left], [right]) => left.localeCompare(right))) {
    if (result.size >= MAX_NAVIGATION_FILES) break;
    try {
      const path = parseProjectPath(rawPath);
      result.set(path, parseFile(source, path));
    } catch {
      // Project navigation ignores non-portable paths rather than leaving the project root.
    }
  }
  return result;
}

function itemAt<T extends OpenScadSourceLocation>(
  items: readonly T[],
  position: number,
): T | undefined {
  return items.find(({ from, to }) => position >= from && position <= to);
}

function resolveDefinition(
  project: ReadonlyMap<string, ParsedFile>,
  documentPath: string,
  reference: Pick<OpenScadReference, "label" | "symbolKind">,
): OpenScadDefinition | undefined {
  const current = project.get(documentPath);
  const local = current?.definitions.find(
    ({ label, symbolKind }) => label === reference.label && symbolKind === reference.symbolKind,
  );
  if (local) return local;

  const visited = new Set<string>([documentPath]);
  const visit = (path: string, variablesVisible: boolean): OpenScadDefinition | undefined => {
    if (visited.size >= MAX_NAVIGATION_FILES || visited.has(path)) return undefined;
    visited.add(path);
    const file = project.get(path);
    if (!file) return undefined;
    const candidate = file.definitions.find(({ label, symbolKind }) =>
      label === reference.label
      && symbolKind === reference.symbolKind
      && (variablesVisible || symbolKind !== "variable")
    );
    if (candidate) return candidate;
    for (const child of file.projectReferences) {
      const found = visit(child.path, variablesVisible && child.kind === "include");
      if (found) return found;
    }
    return undefined;
  };

  for (const dependency of current?.projectReferences ?? []) {
    const found = visit(dependency.path, dependency.kind === "include");
    if (found) return found;
  }
  return undefined;
}

export function outlineOpenScadFile(
  source: string,
  path: string,
): readonly OpenScadDefinition[] {
  return parseFile(source, parseProjectPath(path)).definitions;
}

export function findOpenScadDefinition(
  sources: ReadonlyMap<string, string>,
  documentPath: string,
  position: number,
): OpenScadDefinition | undefined {
  let path: string;
  try {
    path = parseProjectPath(documentPath);
  } catch {
    return undefined;
  }
  const project = parsedProject(sources);
  const file = project.get(path);
  if (!file) return undefined;
  const definition = itemAt(file.definitions, position);
  if (definition) return definition;
  const reference = itemAt(file.references, position);
  return reference ? resolveDefinition(project, path, reference) : undefined;
}

export function findOpenScadReferences(
  sources: ReadonlyMap<string, string>,
  documentPath: string,
  position: number,
): readonly OpenScadReference[] {
  let path: string;
  try {
    path = parseProjectPath(documentPath);
  } catch {
    return [];
  }
  const project = parsedProject(sources);
  const file = project.get(path);
  if (!file) return [];
  const selected = itemAt(file.definitions, position) ?? itemAt(file.references, position);
  if (!selected) return [];
  const definition = "detail" in selected
    ? selected
    : resolveDefinition(project, path, selected);
  if (!definition) return [];
  return [...project.values()]
    .flatMap(({ references }) => references)
    .filter(({ label, symbolKind }) =>
      label === definition.label && symbolKind === definition.symbolKind
    )
    .sort((left, right) =>
      left.path.localeCompare(right.path) || left.from - right.from
    );
}
