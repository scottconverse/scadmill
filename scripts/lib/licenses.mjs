const ALLOWED_LICENSES = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "MPL-2.0",
  "PSF-2.0",
  "Zlib",
]);

const ALLOWED_EXCEPTIONS = new Set(["LLVM-exception"]);

function tokenize(expression) {
  const normalized = expression.replaceAll("/", " OR ");
  const tokens = normalized.match(/\(|\)|AND|OR|WITH|[A-Za-z0-9.+-]+/gu) ?? [];
  const compactInput = normalized.replaceAll(/\s+/gu, "");
  const compactTokens = tokens.join("").replaceAll(/\s+/gu, "");
  return compactInput === compactTokens ? tokens : [];
}

export function isAllowedLicenseExpression(expression) {
  if (typeof expression !== "string" || expression.trim().length === 0) {
    return false;
  }

  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    return false;
  }

  let index = 0;

  function parsePrimary() {
    if (tokens[index] === "(") {
      index += 1;
      const value = parseOr();
      if (tokens[index] !== ")") {
        throw new Error("unclosed license-expression group");
      }
      index += 1;
      return value;
    }

    const identifier = tokens[index];
    if (!identifier || ["AND", "OR", "WITH", ")"].includes(identifier)) {
      throw new Error("expected a license identifier");
    }
    index += 1;
    return ALLOWED_LICENSES.has(identifier);
  }

  function parseWith() {
    let value = parsePrimary();
    if (tokens[index] === "WITH") {
      index += 1;
      const exception = tokens[index];
      if (!exception || ["AND", "OR", "WITH", "(", ")"].includes(exception)) {
        throw new Error("expected a license exception");
      }
      index += 1;
      value = value && ALLOWED_EXCEPTIONS.has(exception);
    }
    return value;
  }

  function parseAnd() {
    let value = parseWith();
    while (tokens[index] === "AND") {
      index += 1;
      const right = parseWith();
      value = value && right;
    }
    return value;
  }

  function parseOr() {
    let value = parseAnd();
    while (tokens[index] === "OR") {
      index += 1;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  }

  try {
    const value = parseOr();
    return index === tokens.length && value;
  } catch {
    return false;
  }
}

export function findDisallowedPackages(packages) {
  return packages.filter(
    (candidate) => candidate.source !== null && !isAllowedLicenseExpression(candidate.license),
  );
}
