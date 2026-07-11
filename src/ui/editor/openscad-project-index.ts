import { parseProjectPath } from "../../application/files/project-path";
import { parser } from "./generated/openscad-parser";

export type ProjectSymbolKind = "function" | "module" | "variable";
export type ProjectVisibility = "all" | "callable";

export interface ProjectReference {
  readonly kind: "include" | "use";
  readonly path: string;
}

export interface ProjectIndexedSymbol {
  readonly label: string;
  readonly symbolKind: ProjectSymbolKind;
  readonly detail: string;
  readonly projectPath: string;
}

export type ProjectFileEvent =
  | { readonly kind: "reference"; readonly reference: ProjectReference }
  | { readonly kind: "symbol"; readonly symbol: ProjectIndexedSymbol };

type OpenScadSyntaxNode = ReturnType<typeof parser.parse>["topNode"];
type OpenScadTree = ReturnType<typeof parser.parse>;
type ProjectFileParser = (
  source: string,
  projectPath: string,
  isCancelled: () => boolean,
) => Promise<readonly ProjectFileEvent[]>;

export const MAX_PROJECT_INDEX_FILE_CODE_UNITS = 2_100_000;
export const MAX_PROJECT_INDEX_TOTAL_CODE_UNITS = 8_000_000;
const MAX_PROJECT_INDEX_FILES = 512;
const MAX_PROJECT_INDEX_REFERENCES = 512;
const MAX_PROJECT_INDEX_SYMBOLS = 4_096;
const MAX_PROJECT_INDEX_EVENTS = 16_384;
const MAX_PROJECT_INDEX_DEPTH = 128;
const MAX_PROJECT_INDEX_CACHE_CODE_UNITS = 16_000_000;
const MAX_PROJECT_INDEX_CACHE_FILES = 256;

function projectReference(
  source: string,
  node: OpenScadSyntaxNode,
): ProjectReference | null {
  if (node.name !== "IncludeStatement" && node.name !== "UseStatement") return null;
  const pathNode = node.getChild("Path");
  if (!pathNode) return null;
  const literal = source.slice(pathNode.from, pathNode.to);
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

function callableSymbol(
  source: string,
  node: OpenScadSyntaxNode,
  symbolKind: "function" | "module",
  projectPath: string,
): ProjectIndexedSymbol | null {
  const name = node.getChild("Identifier");
  const parameters = node.getChild("ParameterList");
  if (!name || !parameters) return null;
  return {
    label: source.slice(name.from, name.to),
    symbolKind,
    detail: source.slice(name.from, parameters.to),
    projectPath,
  };
}

function variableSymbol(
  source: string,
  node: OpenScadSyntaxNode,
  projectPath: string,
): ProjectIndexedSymbol | null {
  const name = node.getChild("Identifier")
    ?? node.getChild("Builtin")
    ?? node.getChild("SpecialVariable");
  if (!name) return null;
  return {
    label: source.slice(name.from, name.to),
    symbolKind: "variable",
    detail: "variable",
    projectPath,
  };
}

function eventFromNode(
  source: string,
  node: OpenScadSyntaxNode,
  projectPath: string,
): ProjectFileEvent | null {
  const reference = projectReference(source, node);
  if (reference) return { kind: "reference", reference };
  const symbol = node.name === "ModuleDeclaration"
    ? callableSymbol(source, node, "module", projectPath)
    : node.name === "FunctionDeclaration"
      ? callableSymbol(source, node, "function", projectPath)
      : node.name === "AssignmentStatement"
        ? variableSymbol(source, node, projectPath)
        : null;
  return symbol ? { kind: "symbol", symbol } : null;
}

function collectEvents(
  tree: OpenScadTree,
  source: string,
  projectPath: string,
): readonly ProjectFileEvent[] {
  const events: ProjectFileEvent[] = [];
  let node = tree.topNode.firstChild;
  while (node && events.length < MAX_PROJECT_INDEX_EVENTS) {
    const event = eventFromNode(source, node, projectPath);
    if (event) events.push(event);
    node = node.nextSibling;
  }
  return events;
}

export async function parseProjectFileEventsInWorker(
  source: string,
  projectPath: string,
  isCancelled: () => boolean,
): Promise<readonly ProjectFileEvent[]> {
  if (isCancelled()) throw abortError();
  return collectEvents(parser.parse(source), source, projectPath);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function parseProjectFileEventsCooperatively(
  source: string,
  projectPath: string,
  isCancelled: () => boolean,
): Promise<readonly ProjectFileEvent[]> {
  await yieldToEventLoop();
  if (isCancelled()) throw abortError();
  const partial = parser.startParse(source);
  let tree: OpenScadTree | null = null;
  while (!tree) {
    for (let step = 0; step < 4_096 && !tree; step += 1) tree = partial.advance();
    if (isCancelled()) throw abortError();
    if (!tree) await yieldToEventLoop();
  }

  const events: ProjectFileEvent[] = [];
  let node = tree.topNode.firstChild;
  let traversed = 0;
  while (node && events.length < MAX_PROJECT_INDEX_EVENTS) {
    const event = eventFromNode(source, node, projectPath);
    if (event) events.push(event);
    node = node.nextSibling;
    traversed += 1;
    if (traversed % 4_096 === 0) {
      if (isCancelled()) throw abortError();
      await yieldToEventLoop();
    }
  }
  return events;
}

interface CachedProjectFile {
  readonly source: string;
  readonly events: readonly ProjectFileEvent[];
}

export class OpenScadProjectIndexCache {
  private readonly entries = new Map<string, CachedProjectFile>();
  private codeUnits = 0;

  async read(
    path: string,
    source: string,
    parseFile: ProjectFileParser,
    isCancelled: () => boolean,
  ): Promise<readonly ProjectFileEvent[]> {
    const existing = this.entries.get(path);
    if (existing?.source === source) {
      this.entries.delete(path);
      this.entries.set(path, existing);
      return existing.events;
    }
    if (existing) {
      this.entries.delete(path);
      this.codeUnits -= existing.source.length;
    }
    const events = await parseFile(source, path, isCancelled);
    while (
      this.entries.size > 0
      && (
        this.entries.size >= MAX_PROJECT_INDEX_CACHE_FILES
        || this.codeUnits + source.length > MAX_PROJECT_INDEX_CACHE_CODE_UNITS
      )
    ) {
      const oldestPath = this.entries.keys().next().value as string | undefined;
      if (oldestPath === undefined) break;
      const oldest = this.entries.get(oldestPath);
      this.entries.delete(oldestPath);
      this.codeUnits -= oldest?.source.length ?? 0;
    }
    this.entries.set(path, { source, events });
    this.codeUnits += source.length;
    return events;
  }
}

export interface ProjectIndexRequest {
  readonly documentPath: string;
  readonly references: readonly ProjectReference[];
  readonly readSource: (path: string) => Promise<string | undefined>;
  readonly parseFile: ProjectFileParser;
  readonly cache: OpenScadProjectIndexCache;
  readonly isCancelled: () => boolean;
}

export async function indexOpenScadProject(
  request: ProjectIndexRequest,
): Promise<readonly ProjectIndexedSymbol[]> {
  const completions = new Map<string, ProjectIndexedSymbol>();
  const requestSources = new Map<string, string | undefined>();
  const visiting = new Set<string>();
  let loadedFiles = 0;
  let loadedCodeUnits = 0;
  let followedReferences = 0;
  let collectedSymbols = 0;
  let processedEvents = 0;
  let exhausted = false;

  try {
    visiting.add(parseProjectPath(request.documentPath));
  } catch {
    return [];
  }

  const readEvents = async (path: string): Promise<readonly ProjectFileEvent[] | undefined> => {
    if (request.isCancelled()) throw abortError();
    let source = requestSources.get(path);
    if (!requestSources.has(path)) {
      source = await request.readSource(path);
      if (source === undefined) {
        requestSources.set(path, undefined);
        return undefined;
      }
      if (
        source.length > MAX_PROJECT_INDEX_FILE_CODE_UNITS
        || loadedFiles >= MAX_PROJECT_INDEX_FILES
        || loadedCodeUnits + source.length > MAX_PROJECT_INDEX_TOTAL_CODE_UNITS
      ) {
        requestSources.set(path, undefined);
        return undefined;
      }
      requestSources.set(path, source);
      loadedFiles += 1;
      loadedCodeUnits += source.length;
    }
    if (source === undefined) return undefined;
    return request.cache.read(path, source, request.parseFile, request.isCancelled);
  };

  const visit = async (
    path: string,
    visibility: ProjectVisibility,
    depth: number,
  ): Promise<void> => {
    if (exhausted || visiting.has(path) || depth > MAX_PROJECT_INDEX_DEPTH) return;
    visiting.add(path);
    try {
      const events = await readEvents(path);
      if (!events) return;
      for (const event of events) {
        processedEvents += 1;
        if (processedEvents > MAX_PROJECT_INDEX_EVENTS || request.isCancelled()) {
          exhausted = true;
          break;
        }
        if (event.kind === "symbol") {
          if (visibility === "all" || event.symbol.symbolKind !== "variable") {
            if (collectedSymbols >= MAX_PROJECT_INDEX_SYMBOLS) {
              exhausted = true;
              break;
            }
            completions.set(`${event.symbol.symbolKind}:${event.symbol.label}`, event.symbol);
            collectedSymbols += 1;
          }
          continue;
        }
        if (followedReferences >= MAX_PROJECT_INDEX_REFERENCES) {
          exhausted = true;
          break;
        }
        followedReferences += 1;
        await visit(
          event.reference.path,
          visibility === "all" && event.reference.kind === "include" ? "all" : "callable",
          depth + 1,
        );
      }
    } finally {
      visiting.delete(path);
    }
  };

  for (const reference of request.references) {
    if (followedReferences >= MAX_PROJECT_INDEX_REFERENCES || exhausted) break;
    followedReferences += 1;
    await visit(reference.path, reference.kind === "include" ? "all" : "callable", 1);
  }
  if (request.isCancelled()) throw abortError();
  return [...completions.values()];
}

export function abortError(): Error {
  const error = new Error("Project symbol indexing was aborted.");
  error.name = "AbortError";
  return error;
}
