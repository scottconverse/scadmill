export interface ProjectTextSearchOptions {
  readonly query: string;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly maximumMatches?: number;
}

export interface ProjectTextMatch {
  readonly path: string;
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly column: number;
  readonly text: string;
}

export interface ProjectTextSearchResult {
  readonly matches: readonly ProjectTextMatch[];
  readonly searchedFiles: number;
  readonly ignoredFiles: readonly string[];
  readonly truncated: boolean;
}

export interface ProjectTextReplacementOptions extends ProjectTextSearchOptions {
  readonly replacement: string;
}

export interface ProjectTextReplacementFile {
  readonly path: string;
  readonly source: string;
  readonly replacements: number;
}

export interface ProjectTextReplacementPlan {
  readonly files: readonly ProjectTextReplacementFile[];
  readonly matchCount: number;
}

const DEFAULT_MAXIMUM_MATCHES = 5_000;
const IDENTIFIER_CHARACTER = /[A-Za-z0-9_$]/u;

function requireQuery(query: string): string {
  if (!query) throw new Error("Project search query must be non-empty.");
  if (query.length > 4_096) throw new Error("Project search query is too long.");
  return query;
}

function maximumMatches(value: number | undefined): number {
  const maximum = value ?? DEFAULT_MAXIMUM_MATCHES;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 100_000) {
    throw new Error("Project search match limit is invalid.");
  }
  return maximum;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

interface IgnoreRule {
  readonly ignored: boolean;
  readonly pattern: RegExp;
}

function globBody(pattern: string): string {
  let result = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        result += ".*";
        index += 1;
      } else {
        result += "[^/]*";
      }
    } else if (character === "?") {
      result += "[^/]";
    } else {
      result += character ? escapeRegex(character) : "";
    }
  }
  return result;
}

function compileIgnoreRule(rawLine: string): IgnoreRule | undefined {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) return undefined;
  const ignored = !line.startsWith("!");
  let pattern = ignored ? line : line.slice(1);
  if (!pattern) return undefined;
  const directory = pattern.endsWith("/");
  if (directory) pattern = pattern.slice(0, -1);
  const rooted = pattern.startsWith("/");
  if (rooted) pattern = pattern.slice(1);
  const hasSlash = pattern.includes("/");
  const prefix = rooted || hasSlash ? "^" : "(?:^|/)";
  const suffix = directory ? "(?:/.*)?$" : "$";
  return { ignored, pattern: new RegExp(`${prefix}${globBody(pattern)}${suffix}`, "u") };
}

function ignoreRules(files: ReadonlyMap<string, string>): readonly IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const path of [".gitignore", ".scadmillignore"]) {
    const source = files.get(path);
    if (source === undefined) continue;
    for (const line of source.split(/\r?\n/u)) {
      const rule = compileIgnoreRule(line);
      if (rule) rules.push(rule);
    }
  }
  return rules;
}

function ignoredPath(path: string, rules: readonly IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.pattern.test(path)) ignored = rule.ignored;
  }
  return ignored;
}

function wholeWord(source: string, from: number, to: number): boolean {
  const before = from > 0 ? source[from - 1] : undefined;
  const after = to < source.length ? source[to] : undefined;
  return !(before && IDENTIFIER_CHARACTER.test(before))
    && !(after && IDENTIFIER_CHARACTER.test(after));
}

function lineLocation(source: string, offset: number) {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  let line = 1;
  for (let index = 0; index < lineStart; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  const lineEnd = source.indexOf("\n", offset);
  return {
    line,
    column: offset - lineStart + 1,
    text: source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).replace(/\r$/u, "").slice(0, 500),
  };
}

function fileMatches(
  path: string,
  source: string,
  options: ProjectTextSearchOptions,
  remaining: number,
): { readonly matches: readonly ProjectTextMatch[]; readonly more: boolean } {
  const query = requireQuery(options.query);
  const flags = options.caseSensitive ? "gu" : "giu";
  const expression = new RegExp(escapeRegex(query), flags);
  const matches: ProjectTextMatch[] = [];
  let match = expression.exec(source);
  while (match) {
    const from = match.index;
    const to = from + match[0].length;
    if (!options.wholeWord || wholeWord(source, from, to)) {
      if (matches.length >= remaining) return { matches, more: true };
      matches.push({ path, from, to, ...lineLocation(source, from) });
    }
    match = expression.exec(source);
  }
  return { matches, more: false };
}

export function searchProjectText(
  files: ReadonlyMap<string, string>,
  options: ProjectTextSearchOptions,
): ProjectTextSearchResult {
  requireQuery(options.query);
  const maximum = maximumMatches(options.maximumMatches);
  const rules = ignoreRules(files);
  const ignoredFiles: string[] = [];
  const matches: ProjectTextMatch[] = [];
  let searchedFiles = 0;
  let truncated = false;
  for (const [path, source] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    if (ignoredPath(path, rules)) {
      ignoredFiles.push(path);
      continue;
    }
    searchedFiles += 1;
    const result = fileMatches(path, source, options, maximum - matches.length);
    matches.push(...result.matches);
    if (result.more || matches.length >= maximum) {
      truncated = result.more || [...files.keys()].some((candidate) => candidate.localeCompare(path) > 0);
      break;
    }
  }
  return { matches, searchedFiles, ignoredFiles, truncated };
}

export function planProjectTextReplacement(
  files: ReadonlyMap<string, string>,
  options: ProjectTextReplacementOptions,
): ProjectTextReplacementPlan {
  const result = searchProjectText(files, options);
  if (result.truncated) {
    throw new Error("Project replacement cannot run from a truncated search result.");
  }
  const byPath = new Map<string, ProjectTextMatch[]>();
  for (const match of result.matches) {
    const matches = byPath.get(match.path) ?? [];
    matches.push(match);
    byPath.set(match.path, matches);
  }
  const replacements = [...byPath].map(([path, matches]) => {
    const original = files.get(path);
    if (original === undefined) throw new Error(`Project search source ${path} disappeared.`);
    let source = original;
    for (const match of [...matches].reverse()) {
      source = `${source.slice(0, match.from)}${options.replacement}${source.slice(match.to)}`;
    }
    return { path, source, replacements: matches.length };
  });
  return { files: replacements, matchCount: result.matches.length };
}
