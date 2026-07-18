import { parser } from "./generated/openscad-parser";
import {
  abortError,
  MAX_PROJECT_INDEX_REFERENCES,
  type ProjectIndexedSymbol,
  type ProjectReference,
  projectFileEventFromNode,
} from "./openscad-project-index";

export interface CurrentFileIndexResult {
  readonly references: readonly ProjectReference[];
  readonly symbols: readonly ProjectIndexedSymbol[];
}

type OpenScadTree = ReturnType<typeof parser.parse>;

const MAX_CURRENT_FILE_MATCHES = 4_096;

function collectCurrentFileIndex(
  tree: OpenScadTree,
  source: string,
  projectPath: string,
  query: string,
  isCancelled: () => boolean,
): CurrentFileIndexResult {
  const references: ProjectReference[] = [];
  const symbols: ProjectIndexedSymbol[] = [];
  let node = tree.topNode.firstChild;
  while (node) {
    if (isCancelled()) throw abortError();
    const event = projectFileEventFromNode(source, node, projectPath);
    if (event?.kind === "reference" && references.length < MAX_PROJECT_INDEX_REFERENCES) {
      references.push(event.reference);
    } else if (
      event?.kind === "symbol"
      && event.symbol.label.startsWith(query)
      && symbols.length < MAX_CURRENT_FILE_MATCHES
    ) {
      symbols.push(event.symbol);
    }
    node = node.nextSibling;
  }
  return { references, symbols };
}

export function indexOpenScadCurrentFileInWorker(
  source: string,
  projectPath: string,
  query: string,
  isCancelled: () => boolean,
): CurrentFileIndexResult {
  if (isCancelled()) throw abortError();
  return collectCurrentFileIndex(parser.parse(source), source, projectPath, query, isCancelled);
}

export async function indexOpenScadCurrentFileCooperatively(
  source: string,
  projectPath: string,
  query: string,
  isCancelled: () => boolean,
): Promise<CurrentFileIndexResult> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (isCancelled()) throw abortError();
  const partial = parser.startParse(source);
  let tree: OpenScadTree | null = null;
  while (!tree) {
    for (let step = 0; step < 4_096 && !tree; step += 1) tree = partial.advance();
    if (isCancelled()) throw abortError();
    if (!tree) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return collectCurrentFileIndex(tree, source, projectPath, query, isCancelled);
}
