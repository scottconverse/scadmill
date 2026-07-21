import type { ProjectFileContent } from "../files/project-snapshot";

function executableSource(source: string): string {
  const output = [...source];
  let mode: "block-comment" | "code" | "line-comment" | "string" = "code";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (mode === "line-comment") {
      if (character === "\n" || character === "\r") mode = "code";
      else output[index] = " ";
      continue;
    }
    if (mode === "block-comment") {
      if (character === "*" && next === "/") {
        output[index] = " ";
        output[index + 1] = " ";
        mode = "code";
        index += 1;
      } else if (character !== "\n" && character !== "\r") output[index] = " ";
      continue;
    }
    if (mode === "string") {
      if (character === "\\") {
        output[index] = " ";
        if (next !== undefined) output[++index] = " ";
      } else {
        if (character === '"') mode = "code";
        if (character !== "\n" && character !== "\r") output[index] = " ";
      }
      continue;
    }
    if (character === "/" && next === "/") {
      output[index] = " ";
      output[index + 1] = " ";
      mode = "line-comment";
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      mode = "block-comment";
      index += 1;
      continue;
    }
    if (character === '"') {
      output[index] = " ";
      mode = "string";
    }
  }
  return output.join("");
}

export function usesAnimationTime(source: string): boolean {
  return /(^|[^$A-Za-z0-9_])\$t(?![$A-Za-z0-9_])/u.test(executableSource(source));
}

function resolveDependency(
  from: string,
  reference: string,
  files: ReadonlyMap<string, ProjectFileContent>,
): string | undefined {
  const normalized = reference.replaceAll("\\", "/");
  const base = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const candidates = [`${base}/${normalized}`, normalized];
  for (const candidate of candidates) {
    const segments: string[] = [];
    for (const segment of candidate.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") segments.pop();
      else segments.push(segment);
    }
    const resolved = segments.join("/");
    if (files.has(resolved)) return resolved;
    const caseInsensitive = [...files.keys()].find(
      (path) => path.toLowerCase() === resolved.toLowerCase(),
    );
    if (caseInsensitive) return caseInsensitive;
  }
  return undefined;
}

export function projectUsesAnimationTime(
  entryFile: string,
  files: ReadonlyMap<string, ProjectFileContent>,
): boolean {
  const visited = new Set<string>();
  const pending = [entryFile];
  while (pending.length > 0) {
    const path = pending.shift();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    const content = files.get(path);
    if (typeof content !== "string") continue;
    if (usesAnimationTime(content)) return true;
    const executable = executableSource(content);
    for (const match of executable.matchAll(/\b(?:include|use)\s*<([^>\r\n]+)>/gu)) {
      const dependency = match[1]
        ? resolveDependency(path, match[1].trim(), files)
        : undefined;
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }
  return false;
}
