import type { Bounds2 } from "./svg-viewport";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_ENGINE_SVG_CODE_UNITS = 5_000_000;

const allowedAttributes = new Map<string, ReadonlySet<string>>([
  ["svg", new Set(["height", "preserveAspectRatio", "version", "viewBox", "width", "xmlns"])],
  ["g", new Set(["fill", "id", "opacity", "stroke", "stroke-width", "transform"])],
  [
    "path",
    new Set([
      "clip-rule",
      "d",
      "fill",
      "fill-opacity",
      "fill-rule",
      "id",
      "opacity",
      "stroke",
      "stroke-linecap",
      "stroke-linejoin",
      "stroke-opacity",
      "stroke-width",
      "transform",
      "vector-effect",
    ]),
  ],
  ["title", new Set()],
  ["desc", new Set()],
]);

function unsafeAttribute(name: string, value: string): boolean {
  const normalizedName = name.toLowerCase();
  if (
    normalizedName.startsWith("on")
    || normalizedName === "href"
    || normalizedName.endsWith(":href")
    || normalizedName === "src"
    || normalizedName === "style"
  ) {
    return true;
  }
  if (normalizedName === "xmlns") return value !== SVG_NAMESPACE;
  return /url\s*\(|@import|(?:data|file|https?|javascript):/i.test(value);
}

export function sanitizeEngineSvg(source: string, bounds?: Bounds2): string {
  if (source.length > MAX_ENGINE_SVG_CODE_UNITS) {
    throw new Error("Engine SVG is too large to display safely.");
  }
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror")) {
    throw new Error("Engine SVG is malformed.");
  }
  const root = document.documentElement;
  if (root.localName !== "svg" || root.namespaceURI !== SVG_NAMESPACE) {
    throw new Error("Engine SVG root is unsupported.");
  }

  const elements = [root, ...root.querySelectorAll("*")];
  for (const element of elements) {
    const allowed = allowedAttributes.get(element.localName);
    if (!allowed || element.namespaceURI !== SVG_NAMESPACE) {
      throw new Error(`Engine SVG contains an unsupported element: ${element.localName}.`);
    }
    for (const attribute of [...element.attributes]) {
      if (!allowed.has(attribute.name) || unsafeAttribute(attribute.name, attribute.value)) {
        throw new Error(`Engine SVG contains an unsafe or unsupported attribute: ${attribute.name}.`);
      }
    }
  }
  if (bounds) {
    const values = [...bounds.min, ...bounds.max];
    const width = bounds.max[0] - bounds.min[0];
    const height = bounds.max[1] - bounds.min[1];
    if (!values.every(Number.isFinite) || width <= 0 || height <= 0) {
      throw new Error("Engine SVG bounds must be finite with positive dimensions.");
    }
    root.setAttribute("width", `${width}mm`);
    root.setAttribute("height", `${height}mm`);
    root.setAttribute("viewBox", `${bounds.min[0]} ${-bounds.max[1]} ${width} ${height}`);
  }
  return new XMLSerializer().serializeToString(root);
}
