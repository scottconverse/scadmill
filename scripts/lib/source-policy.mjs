import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const UI_EXTENSIONS = new Set([".css", ".js", ".jsx", ".ts", ".tsx"]);
const SOURCE_EXTENSION = /\.[^.]+$/u;
const IMPORT_SOURCE = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu;
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^\n)]*\)/u;

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function isExempt(relativePath) {
  return (
    relativePath.includes("/fixtures/") ||
    relativePath.includes("/generated/") ||
    /(?:\.generated|\.spec|\.test)\.[^.]+$/u.test(relativePath)
  );
}

function physicalLineCount(source) {
  if (source.length === 0) {
    return 0;
  }
  const lines = source.split(/\r\n|\r|\n/u);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (entry.isFile() && UI_EXTENSIONS.has(entry.name.match(SOURCE_EXTENSION)?.[0] ?? "")) {
      files.push(path);
    }
  }
  return files;
}

function platformModule(source) {
  for (const match of source.matchAll(IMPORT_SOURCE)) {
    const moduleName = match[1];
    if (
      moduleName.startsWith("@tauri-apps/") ||
      moduleName.includes("platform-desktop") ||
      moduleName.includes("desktop-shell")
    ) {
      return moduleName;
    }
  }
  return null;
}

export async function scanSourcePolicy(root) {
  const files = [];
  for (const componentRoot of [resolve(root, "src", "ui"), resolve(root, "src", "app")]) {
    try {
      files.push(...(await sourceFiles(componentRoot)));
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }

  const violations = [];
  for (const file of files) {
    const relativePath = toPosix(relative(root, file));
    if (isExempt(relativePath)) {
      continue;
    }

    const source = await readFile(file, "utf8");
    const physicalLines = physicalLineCount(source);
    if (physicalLines > 400) {
      violations.push({
        file: relativePath,
        rule: "ui-file-length",
        message: `UI source has ${physicalLines} physical lines; the maximum is 400.`,
      });
    }

    const importedPlatform = platformModule(source);
    if (importedPlatform) {
      violations.push({
        file: relativePath,
        rule: "platform-boundary",
        message: `Shared UI imports a platform-specific module: ${importedPlatform}.`,
      });
    }

    const hardcodedColor = source.match(COLOR_LITERAL)?.[0];
    if (hardcodedColor) {
      violations.push({
        file: relativePath,
        rule: "hardcoded-color",
        message: `Component source contains a hardcoded color literal: ${hardcodedColor}.`,
      });
    }
  }

  return violations;
}
