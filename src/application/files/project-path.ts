declare const projectPathBrand: unique symbol;

export type ProjectPath = string & { readonly [projectPathBrand]: true };

export class ProjectPathError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`Invalid project path ${JSON.stringify(path)}: ${detail}`);
    this.name = "ProjectPathError";
    this.path = path;
  }
}

const reservedNames = new Set([
  "AUX",
  "CLOCK$",
  "CON",
  "CONIN$",
  "CONOUT$",
  "NUL",
  "PRN",
]);

function isReservedDeviceName(component: string): boolean {
  const stem = (component.split(".", 1)[0] ?? component).toUpperCase();
  if (reservedNames.has(stem)) return true;
  return /^(?:COM|LPT)(?:[1-9¹²³])$/.test(stem);
}

function validateComponent(path: string, component: string): void {
  if (component.length === 0 || component === "." || component === "..") {
    throw new ProjectPathError(path, "components must be non-empty and may not be dot segments");
  }
  if (component.includes(":")) {
    throw new ProjectPathError(path, "components may not contain a colon or alternate-data-stream separator");
  }
  if (component.endsWith(".") || component.endsWith(" ")) {
    throw new ProjectPathError(path, "components may not end in a dot or space");
  }
  if (isReservedDeviceName(component)) {
    throw new ProjectPathError(path, "components may not use reserved Windows device names");
  }
}

export function parseProjectPath(path: string): ProjectPath {
  if (
    path.length === 0
    || path.startsWith("/")
    || path.startsWith("\\")
    || path.includes("\\")
    || path.includes("\0")
  ) {
    throw new ProjectPathError(path, "path must be a normalized project-relative path");
  }
  const components = path.split("/");
  for (const component of components) validateComponent(path, component);
  return path as ProjectPath;
}

function collisionKey(path: string): string {
  return path.toLowerCase();
}

export function validateProjectLayout(paths: Iterable<string>): readonly ProjectPath[] {
  const parsed = [...paths].map(parseProjectPath);
  const filesByKey = new Map<string, ProjectPath>();
  for (const path of parsed) {
    const key = collisionKey(path);
    if (filesByKey.has(key)) {
      throw new ProjectPathError(path, "project file paths collide case-insensitively");
    }
    filesByKey.set(key, path);
  }

  for (const path of parsed) {
    const components = path.split("/");
    for (let length = 1; length < components.length; length += 1) {
      const parent = components.slice(0, length).join("/");
      if (filesByKey.has(collisionKey(parent))) {
        throw new ProjectPathError(parent, "a project file path is also a parent directory");
      }
    }
  }
  return parsed;
}
