import { parser } from "../../ui/editor/generated/openscad-parser";
import type {
  CustomizerParameter,
  DropdownOption,
  ParameterControl,
  ParameterScalarValue,
  ParameterValue,
  SourceRange,
} from "./customizer-schema";

type SyntaxNode = ReturnType<typeof parser.parse>["topNode"];

const PASS_THROUGH_STATEMENTS = new Set([
  "BlockComment",
  "EmptyStatement",
  "IncludeStatement",
  "LineComment",
  "UseStatement",
]);

function isVector(value: ParameterValue): value is readonly number[] {
  return Array.isArray(value);
}

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) result.push(child);
  return result;
}

function decodeString(source: string): string | null {
  if (!source.startsWith('"') || !source.endsWith('"')) return null;
  let decoded = "";
  for (let index = 1; index < source.length - 1; index += 1) {
    const character = source[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    index += 1;
    if (index >= source.length - 1) return null;
    const escaped = source[index];
    decoded += escaped === "n"
      ? "\n"
      : escaped === "r"
        ? "\r"
        : escaped === "t"
          ? "\t"
          : escaped;
  }
  return decoded;
}

function parseNumber(source: string): number | null {
  const trimmed = source.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function literalFromNode(node: SyntaxNode, source: string): ParameterValue | null {
  const text = source.slice(node.from, node.to);
  if (node.name === "Number") return parseNumber(text);
  if (node.name === "String") return decodeString(text);
  if (node.name === "Boolean") return text === "true" ? true : text === "false" ? false : null;
  if (node.name === "UnaryExpression") {
    const parts = children(node);
    if (parts.length !== 2 || parts[1]?.name !== "Number") return null;
    if (parts[0]?.name !== "Minus" && parts[0]?.name !== "Plus") return null;
    return parseNumber(text);
  }
  if (node.name !== "ListExpression") return null;
  const list = node.getChild("ListElements");
  if (list === null) return null;
  const elements = list.getChildren("ListElement");
  if (elements.length < 1) return null;
  const values: number[] = [];
  for (const element of elements) {
    const expression = element.firstChild;
    if (expression === null) return null;
    const value = literalFromNode(expression, source);
    if (typeof value !== "number") return null;
    values.push(value);
  }
  return values;
}

function vectorComponentRanges(node: SyntaxNode): readonly SourceRange[] | undefined {
  if (node.name !== "ListExpression") return undefined;
  const list = node.getChild("ListElements");
  if (list === null) return undefined;
  const ranges: SourceRange[] = [];
  for (const element of list.getChildren("ListElement")) {
    const expression = element.firstChild;
    if (expression === null) return undefined;
    ranges.push({ from: expression.from, to: expression.to });
  }
  return ranges;
}

function numberStep(source: string): number {
  const match = source.trim().match(
    /^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/,
  );
  if (match === null) return 1;
  const decimalPlaces = (match[1] ?? match[2] ?? "").length;
  const exponent = Number(match[3] ?? 0);
  const step = 10 ** (exponent - decimalPlaces);
  return Number.isFinite(step) && step > 0 ? step : 1;
}

function plainControl(value: ParameterValue, source: string): ParameterControl {
  if (typeof value === "boolean") return { kind: "checkbox" };
  if (typeof value === "string") return { kind: "text" };
  if (isVector(value)) return { kind: "vector", length: value.length };
  return { kind: "number", step: numberStep(source) };
}

function dropdownValue(source: string, reference: ParameterScalarValue): ParameterScalarValue | null {
  const value = source.trim();
  if (value.length === 0) return null;
  if (typeof reference === "string") {
    return value.startsWith('"') ? decodeString(value) : value;
  }
  if (typeof reference === "boolean") {
    return value === "true" ? true : value === "false" ? false : null;
  }
  return parseNumber(value);
}

function annotationControl(annotation: string, value: ParameterValue): ParameterControl | null {
  const trimmed = annotation.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const body = trimmed.slice(1, -1).trim();
  if (body.length === 0 || isVector(value)) return null;
  if (!body.includes(",") && body.includes(":")) {
    if (typeof value !== "number") return dropdownControl(body, value);
    const pieces = body.split(":").map((piece) => parseNumber(piece));
    if (
      (pieces.length !== 2 && pieces.length !== 3)
      || pieces.some((piece) => piece === null)
    ) return null;
    const [minimum, middle, last] = pieces as number[];
    const maximum = pieces.length === 2 ? middle : last;
    const step = pieces.length === 3 ? middle : undefined;
    if (minimum > maximum || (step !== undefined && step <= 0)) return null;
    return step === undefined
      ? { kind: "slider", minimum, maximum }
      : { kind: "slider", minimum, maximum, step };
  }
  return dropdownControl(body, value);
}

function dropdownControl(
  source: string,
  reference: ParameterScalarValue,
): ParameterControl | null {
  const options: DropdownOption[] = [];
  for (const rawOption of source.split(",")) {
    const separator = rawOption.indexOf(":");
    const rawValue = separator < 0 ? rawOption : rawOption.slice(0, separator);
    const rawLabel = separator < 0 ? rawValue : rawOption.slice(separator + 1);
    const value = dropdownValue(rawValue, reference);
    const label = rawLabel.trim();
    if (value === null || label.length === 0) return null;
    options.push({ value, label });
  }
  return options.length > 0 ? { kind: "dropdown", options } : null;
}

function commentBody(source: string, node: SyntaxNode): string {
  const comment = source.slice(node.from, node.to);
  return node.name === "LineComment"
    ? comment.slice(2).trim()
    : comment.slice(2, -2).trim();
}

function groupName(source: string, node: SyntaxNode): string | null {
  const match = commentBody(source, node).match(/^\[([^\]\r\n]+)\]$/);
  const name = match?.[1]?.trim() ?? "";
  return name.length > 0 ? name : null;
}

function isSameLine(source: string, left: number, right: number): boolean {
  return !/[\r\n]/.test(source.slice(left, right));
}

function precedingDescription(
  source: string,
  nodes: readonly SyntaxNode[],
  index: number,
): string | undefined {
  const previous = nodes[index - 1];
  if (previous?.name !== "LineComment") return undefined;
  const beforeComment = nodes[index - 2];
  if (
    beforeComment?.name === "AssignmentStatement"
    && isSameLine(source, beforeComment.to, previous.from)
  ) return undefined;
  const gap = source.slice(previous.to, nodes[index]?.from);
  if (!/^[ \t]*\r?\n[ \t]*$/.test(gap)) return undefined;
  const body = commentBody(source, previous);
  return body.startsWith("[") ? undefined : body || undefined;
}

function assignmentParts(node: SyntaxNode): {
  readonly name: SyntaxNode;
  readonly value: SyntaxNode;
} | null {
  const parts = children(node);
  const assignIndex = parts.findIndex((part) => part.name === "Assign");
  const name = parts[0];
  const value = parts[assignIndex + 1];
  return assignIndex === 1 && name !== undefined && value !== undefined ? { name, value } : null;
}

export function extractCustomizerParameters(source: string): readonly CustomizerParameter[] {
  const nodes = children(parser.parse(source).topNode);
  const parameters: CustomizerParameter[] = [];
  const names = new Set<string>();
  let group: string | null = null;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) continue;
    if (node.name === "BlockComment") {
      group = groupName(source, node) ?? group;
      continue;
    }
    if (node.name !== "AssignmentStatement") {
      if (!PASS_THROUGH_STATEMENTS.has(node.name)) break;
      continue;
    }
    const parts = assignmentParts(node);
    if (parts === null) continue;
    const value = literalFromNode(parts.value, source);
    const name = source.slice(parts.name.from, parts.name.to);
    if (value === null || names.has(name)) continue;

    const trailing = nodes[index + 1];
    const trailingBody = trailing?.name === "LineComment"
      && isSameLine(source, node.to, trailing.from)
      ? commentBody(source, trailing)
      : undefined;
    const annotated = trailingBody?.startsWith("[") === true;
    const annotation = annotated ? annotationControl(trailingBody ?? "", value) : null;
    const defaultSource = source.slice(parts.value.from, parts.value.to);
    const description = annotated
      ? precedingDescription(source, nodes, index)
      : trailingBody || precedingDescription(source, nodes, index);

    names.add(name);
    parameters.push({
      name,
      defaultValue: value,
      defaultSource,
      group,
      hidden: group === "Hidden",
      description,
      control: annotation ?? plainControl(value, defaultSource),
      assignmentRange: { from: node.from, to: node.to },
      nameRange: { from: parts.name.from, to: parts.name.to },
      valueRange: { from: parts.value.from, to: parts.value.to },
      componentRanges: isVector(value) ? vectorComponentRanges(parts.value) : undefined,
    });
  }
  return parameters;
}
