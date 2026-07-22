import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import ts from "typescript";

const UI_EXTENSIONS = new Set([".css", ".js", ".jsx", ".ts", ".tsx"]);
const IGNORED_SOURCE_DIRECTORIES = new Set(["dist", "node_modules", "target", "vendor"]);
const SOURCE_EXTENSION = /\.[^.]+$/u;
const MOJIBAKE = /(?:Ã.|Â.|â(?:€|€¦|‡).?|�)/u;
const IMPORT_SOURCE = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu;
const CSS_COLOR_FUNCTION =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|device-cmyk)\s*\([^)]*\)/giu;
const HEX_COLOR = /#[0-9a-f]{3,8}\b/giu;
const NUMERIC_COLOR = /\b0x[0-9a-f](?:_?[0-9a-f]){0,7}\b/giu;
const DECIMAL_COLOR = /\b(?:0|[1-9](?:_?[0-9]){0,7})\b/gu;
const WORD = /\b[a-z]+\b/giu;
const COLOR_PROPERTY =
  /\b(?:accent-?color|attenuation-?color|background(?:-?(?:color|image))?|border(?:(?:-?(?:block|inline))(?:-?(?:start|end))?|-?(?:top|right|bottom|left))?(?:-?color)?|box-?shadow|caret-?color|color|column-?rule(?:-?color)?|emissive|fill|flood-?color|lighting-?color|outline(?:-?color)?|scrollbar-?color|sheen-?color|specular(?:-?color)?|stop-?color|stroke|text-?(?:decoration|emphasis)(?:-?color)?|text-?shadow|-?webkit-?text-?(?:fill|stroke)-?color)\s*:\s*[^,;{}\n]*$/iu;
const CUSTOM_PROPERTY_VALUE = /(?:["']--[a-z0-9-]+["']|--[a-z0-9-]+)\s*:\s*[^;{}\n]*$/iu;
const COLOR_ATTRIBUTE =
  /\b(?:accentColor|backgroundColor|borderColor|color|fill|floodColor|lightingColor|outlineColor|stopColor|stroke)\s*=\s*(?:\{\s*)?["'`]?\s*$/iu;
const COLOR_CONSTRUCTOR = /\bnew\s+(?:(?:THREE|three)\.)?Color\s*\(\s*["'`]?\s*$/u;
const COLOR_METHOD =
  /(?:\.(?:setClearColor|setColorAt|setHex|setHSL|setRGB|setStyle)|\bcolor\.set)\s*\(\s*["'`]?\s*$/u;
const COLOR_OBJECT_CONSTRUCTOR =
  /\bnew\s+(?:THREE\.)?(?:[a-z]*Light|Fog(?:Exp2)?)\s*\(\s*$/iu;
const NUMERIC_COLOR_PROPERTY =
  /\b(?:backgroundColor|borderColor|color|fill|floodColor|lightingColor|outlineColor|stopColor|stroke)\s*:\s*$/u;
const COLOR_ASSIGNMENT = /\b(?:fillStyle|shadowColor|strokeStyle)\s*=\s*["'`]?\s*$/u;
const COMPOUND_COLOR_START =
  /\b(?:(?:repeating-)?(?:conic|linear|radial)-gradient|color-mix|contrast-color|light-dark|drop-shadow|new\s+(?:THREE\.)?(?:[a-z]*Light|Fog(?:Exp2)?))\s*\(/giu;
const CSS_VARIABLE_FALLBACK = /\bvar\s*\([^)]*,[^)]*$/iu;
const FRAGMENT_CONTEXT = /\b(?:href|id|xlinkHref|xlink:href)\b\s*[:=]\s*(?:\{\s*)?["'`]?\s*$/iu;
const URL_FRAGMENT_CONTEXT = /\burl\(\s*["'`]?\s*$/iu;
const SELECTOR_CONTEXT = /\bquerySelector(?:All)?\s*\(\s*["'`]?\s*$/u;
const URL_PATH_CONTEXT = /(?:https?:\/\/|file:\/\/|(?:\.\.?\/|\/))[^"'`\s]*$/iu;
const NAMED_COLORS = new Set([
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "transparent",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
  "accentcolor",
  "accentcolortext",
  "activetext",
  "buttonborder",
  "buttonface",
  "buttontext",
  "canvas",
  "canvastext",
  "field",
  "fieldtext",
  "graytext",
  "highlight",
  "highlighttext",
  "linktext",
  "mark",
  "marktext",
  "selecteditem",
  "selecteditemtext",
  "visitedtext",
]);

function maskRange(characters, start, end) {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== "\n" && characters[index] !== "\r") {
      characters[index] = " ";
    }
  }
}

function withoutComments(source, extension) {
  const characters = source.split("");

  if (extension === ".css") {
    let quote = null;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];

      if (quote) {
        if (character === "\\") {
          index += 1;
        } else if (character === quote) {
          quote = null;
        }
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "/" && next === "*") {
        const end = source.indexOf("*/", index + 2);
        const commentEnd = end < 0 ? source.length : end + 2;
        maskRange(characters, index, commentEnd);
        index = commentEnd - 1;
      }
    }
    return characters.join("");
  }

  const languageVariant = extension === ".jsx" || extension === ".tsx" ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, languageVariant, source);

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      maskRange(characters, scanner.getTokenPos(), scanner.getTextPos());
    }
  }

  return characters.join("");
}

function matches(source, pattern) {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)];
}

function isInStringContent(source, targetIndex) {
  const states = [];

  for (let index = 0; index < targetIndex; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    const state = states.at(-1);

    if (state?.type === "single" || state?.type === "double") {
      if (character === "\\") {
        index += 1;
      } else if (
        (state.type === "single" && character === "'") ||
        (state.type === "double" && character === '"')
      ) {
        states.pop();
      }
      continue;
    }

    if (state?.type === "template") {
      if (character === "\\") {
        index += 1;
      } else if (character === "`") {
        states.pop();
      } else if (character === "$" && next === "{") {
        states.push({ type: "template-expression", depth: 1 });
        index += 1;
      }
      continue;
    }

    if (state?.type === "template-expression") {
      if (character === "{") {
        state.depth += 1;
      } else if (character === "}") {
        state.depth -= 1;
        if (state.depth === 0) {
          states.pop();
        }
      } else if (character === "'") {
        states.push({ type: "single" });
      } else if (character === '"') {
        states.push({ type: "double" });
      } else if (character === "`") {
        states.push({ type: "template" });
      }
      continue;
    }

    if (character === "'") {
      states.push({ type: "single" });
    } else if (character === '"') {
      states.push({ type: "double" });
    } else if (character === "`") {
      states.push({ type: "template" });
    }
  }

  const state = states.at(-1)?.type;
  return state === "single" || state === "double" || state === "template";
}

function isInsideCompoundColorFunction(source, index) {
  const prefix = source.slice(Math.max(0, index - 1000), index);
  const starts = matches(prefix, COMPOUND_COLOR_START);

  for (const start of starts.toReversed()) {
    let depth = 0;
    for (let cursor = start.index; cursor < prefix.length; cursor += 1) {
      if (prefix[cursor] === "(") {
        depth += 1;
      } else if (prefix[cursor] === ")") {
        depth -= 1;
      }
    }
    if (depth > 0) {
      return true;
    }
  }

  return false;
}

function isColorContext(source, index) {
  const prefix = source.slice(Math.max(0, index - 400), index);
  return (
    COLOR_PROPERTY.test(prefix) ||
    COLOR_ATTRIBUTE.test(prefix) ||
    COLOR_CONSTRUCTOR.test(prefix) ||
    COLOR_METHOD.test(prefix) ||
    COLOR_ASSIGNMENT.test(prefix) ||
    CUSTOM_PROPERTY_VALUE.test(prefix) ||
    isInsideCompoundColorFunction(source, index) ||
    CSS_VARIABLE_FALLBACK.test(prefix)
  );
}

function isColorConstructorCall(source, index) {
  const prefix = source.slice(Math.max(0, index - 80), index);
  return /\bnew\s+(?:(?:THREE|three)\.)?$/u.test(prefix);
}

function isNumericColorContext(source, index) {
  const prefix = source.slice(Math.max(0, index - 160), index);
  return (
    COLOR_CONSTRUCTOR.test(prefix) ||
    COLOR_OBJECT_CONSTRUCTOR.test(prefix) ||
    COLOR_METHOD.test(prefix) ||
    NUMERIC_COLOR_PROPERTY.test(prefix)
  );
}

function fragmentContext(source, index) {
  const prefix = source.slice(Math.max(0, index - 120), index);
  const suffix = source.slice(index).replace(/^#[0-9a-f]{3,8}\b/iu, "");
  return {
    explicit:
      FRAGMENT_CONTEXT.test(prefix) ||
      URL_FRAGMENT_CONTEXT.test(prefix) ||
      SELECTOR_CONTEXT.test(prefix) ||
      URL_PATH_CONTEXT.test(prefix),
    selector: /^\s*(?:[.:>+~,{]|\[)/u.test(suffix),
  };
}

function isCustomPropertyWord(source, index) {
  return /--[a-z0-9-]*$/iu.test(source.slice(Math.max(0, index - 100), index));
}

function hardcodedColor(source, extension) {
  const searchable = withoutComments(source, extension);
  const isCss = extension === ".css";
  const candidates = matches(searchable, CSS_COLOR_FUNCTION)
    .filter(
      (match) =>
        !isColorConstructorCall(searchable, match.index) &&
        (isCss || isInStringContent(searchable, match.index) || isColorContext(searchable, match.index)),
    )
    .map((match) => ({
      index: match.index,
      literal: match[0],
    }));

  for (const match of matches(searchable, HEX_COLOR)) {
    const fragment = fragmentContext(searchable, match.index);
    if (
      !fragment.explicit &&
      (isColorContext(searchable, match.index) || !fragment.selector)
    ) {
      candidates.push({ index: match.index, literal: match[0] });
    }
  }

  for (const match of matches(searchable, NUMERIC_COLOR)) {
    if (isColorContext(searchable, match.index)) {
      candidates.push({ index: match.index, literal: match[0] });
    }
  }

  for (const match of matches(searchable, DECIMAL_COLOR)) {
    if (!isCss && isNumericColorContext(searchable, match.index)) {
      candidates.push({ index: match.index, literal: match[0] });
    }
  }

  for (const match of matches(searchable, WORD)) {
    if (
      NAMED_COLORS.has(match[0].toLowerCase()) &&
      (isCss || isInStringContent(searchable, match.index)) &&
      !isCustomPropertyWord(searchable, match.index) &&
      isColorContext(searchable, match.index)
    ) {
      candidates.push({ index: match.index, literal: match[0] });
    }
  }

  return candidates.sort((left, right) => left.index - right.index)[0]?.literal ?? null;
}

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function isLineCapExempt(relativePath) {
  return (
    relativePath.includes("/fixtures/") ||
    relativePath.includes("/generated/") ||
    /(?:\.generated|\.spec|\.test)\.[^.]+$/u.test(relativePath)
  );
}

function isCanonicalThemeSource(relativePath) {
  return relativePath === "src/theme/tokens.css";
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
    if (entry.isDirectory() && !IGNORED_SOURCE_DIRECTORIES.has(entry.name)) {
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
      moduleName.includes("platform-web") ||
      moduleName.includes("desktop-shell")
    ) {
      return moduleName;
    }
  }
  return null;
}

export async function scanSourcePolicy(root) {
  let files = [];
  try {
    files = await sourceFiles(resolve(root, "src"));
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const violations = [];
  for (const file of files) {
    const relativePath = toPosix(relative(root, file));
    const source = await readFile(file, "utf8");
    const physicalLines = physicalLineCount(source);
    const isSharedUi = /^src\/(?:app|ui)\//u.test(relativePath);
    if (isSharedUi && !isLineCapExempt(relativePath) && physicalLines > 400) {
      violations.push({
        file: relativePath,
        rule: "ui-file-length",
        message: `UI source has ${physicalLines} physical lines; the maximum is 400.`,
      });
    }

    const importedPlatform = isSharedUi ? platformModule(source) : null;
    if (importedPlatform) {
      violations.push({
        file: relativePath,
        rule: "platform-boundary",
        message: `Shared UI imports a platform-specific module: ${importedPlatform}.`,
      });
    }

    const mojibake = source.match(MOJIBAKE)?.[0];
    if (mojibake) {
      violations.push({
        file: relativePath,
        rule: "mojibake",
        message: `Source contains a common UTF-8 mojibake sequence: ${mojibake}.`,
      });
    }

    const extension = relativePath.match(SOURCE_EXTENSION)?.[0] ?? "";
    const colorLiteral = isCanonicalThemeSource(relativePath)
      ? null
      : hardcodedColor(source, extension);
    if (colorLiteral) {
      violations.push({
        file: relativePath,
        rule: "hardcoded-color",
        message: `Component source contains a hardcoded color literal: ${colorLiteral}.`,
      });
    }
  }

  return violations;
}
