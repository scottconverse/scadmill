import { unzipSync, type UnzipFileInfo } from "fflate";

import type { ParsedModelMesh, ParsedModelPart } from "./model-mesh";

const MODEL_PATH = "3D/3dmodel.model";
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_MODEL_BYTES = 512 * 1024 * 1024;
const MAX_OBJECTS = 4_096;
const MAX_TRIANGLES = 2_500_000;
const DEFAULT_COLOR = `#${"F9D72C"}`;
const ATTRIBUTE = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/gu;
const COLOR_GROUP = /<(?:[\w.-]+:)?colorgroup\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?colorgroup\s*>/giu;
const COLOR = /<(?:[\w.-]+:)?color\b([^>]*)\/?\s*>/giu;
const OBJECT = /<(?:[\w.-]+:)?object\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?object\s*>/giu;
const VERTEX = /<(?:[\w.-]+:)?vertex\b([^>]*)\/?\s*>/giu;
const TRIANGLE = /<(?:[\w.-]+:)?triangle\b([^>]*)\/?\s*>/giu;
const CANONICALIZATION_TOKEN = /<!--[\s\S]*?-->|<(?:[\w.-]+:)?metadata\b[^>]*>(?:[\s\S]*?)<\/(?:[\w.-]+:)?metadata\s*>|<(?:[\w.-]+:)?metadata\b[^>]*\/\s*>|<(?:[\w.-]+:)?(?:basematerials|colorgroup|compositematerials|multiproperties|texture2dgroup)\b[^>]*>(?:[\s\S]*?)<\/(?:[\w.-]+:)?(?:basematerials|colorgroup|compositematerials|multiproperties|texture2dgroup)\s*>|\s+(?:(?:[\w.-]+:)?UUID|name|partnumber|pid|pindex|p1|p2|p3)\s*=\s*"[^"]*"|\s+/giu;

function attributes(source: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1];
    const value = match[2];
    if (name && value !== undefined) result.set(name, value);
  }
  return result;
}

function requiredAttribute(values: ReadonlyMap<string, string>, name: string, context: string): string {
  const value = values.get(name);
  if (value === undefined || value.length === 0) throw new Error(`3MF ${context} is missing ${name}.`);
  return value;
}

function finiteCoordinate(value: string, context: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`3MF ${context} contains a non-finite coordinate.`);
  return parsed;
}

function nonnegativeIndex(value: string, context: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`3MF ${context} contains an invalid index.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`3MF ${context} contains an invalid index.`);
  return parsed;
}

function xmlText(source: string): string {
  return source.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\dA-F]+);/giu, (entity) => {
    const body = entity.slice(1, -1);
    if (body === "amp") return "&";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    const numeric = body.toLowerCase().startsWith("#x")
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    return Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
      ? String.fromCodePoint(numeric)
      : String.fromCodePoint(0xfffd);
  });
}

function displayColor(source: string): { readonly css: string; readonly rgb: readonly [number, number, number] } {
  if (!/^#[\dA-F]{6}(?:[\dA-F]{2})?$/iu.test(source)) {
    throw new Error("3MF Color encoding contains an invalid color value.");
  }
  const css = source.slice(0, 7).toUpperCase();
  return {
    css,
    rgb: [1, 3, 5].map((offset) => Number.parseInt(css.slice(offset, offset + 2), 16) / 255) as [number, number, number],
  };
}

function modelXml(archive: Uint8Array, maxModelBytes = MAX_MODEL_BYTES): string {
  if (archive.byteLength === 0 || archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("3MF archive exceeds the supported size.");
  }
  let oversized = false;
  const entries = unzipSync(archive, {
    filter: (entry: UnzipFileInfo) => {
      if (entry.name !== MODEL_PATH) return false;
      if (entry.originalSize <= 0 || entry.originalSize > maxModelBytes) {
        oversized = true;
        return false;
      }
      return true;
    },
  });
  if (oversized) throw new Error("3MF model XML exceeds the supported size.");
  const bytes = entries[MODEL_PATH];
  if (!bytes) throw new Error(`3MF archive is missing ${MODEL_PATH}.`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("3MF model XML is not valid UTF-8.");
  }
}

/**
 * Returns a deterministic representation of the 3MF geometry graph. ZIP
 * packaging, generated metadata/UUIDs, names, and material/color assignments
 * are presentation details and deliberately do not participate. Meshes,
 * topology, component/build references, and transforms remain represented.
 */
export function canonicalThreeMfGeometryBytes(
  archive: Uint8Array,
  maxModelBytes = MAX_MODEL_BYTES,
): Uint8Array {
  const xml = modelXml(archive, maxModelBytes);
  triangleCount(xml);
  unitScale(xml);
  const canonical = xml.replace(CANONICALIZATION_TOKEN, (token) =>
    token.trim().length === 0 ? " " : ""
  ).trim();
  return new TextEncoder().encode(`scadmill-3mf-geometry-v1\n${canonical}`);
}

function unitScale(xml: string): number {
  const opening = /<(?:[\w.-]+:)?model\b([^>]*)>/iu.exec(xml);
  if (!opening) throw new Error("3MF model root is missing.");
  const unit = attributes(opening[1] ?? "").get("unit") ?? "millimeter";
  const scale = {
    micron: 0.001,
    millimeter: 1,
    centimeter: 10,
    meter: 1_000,
    inch: 25.4,
    foot: 304.8,
  }[unit];
  if (scale === undefined) throw new Error(`3MF model uses unsupported unit ${unit}.`);
  return scale;
}

function colorGroups(xml: string): ReadonlyMap<string, readonly ReturnType<typeof displayColor>[]> {
  const groups = new Map<string, readonly ReturnType<typeof displayColor>[]>();
  for (const group of xml.matchAll(COLOR_GROUP)) {
    const id = requiredAttribute(attributes(group[1] ?? ""), "id", "color group");
    if (groups.has(id)) throw new Error(`3MF color group ${id} is duplicated.`);
    const colors = [...(group[2] ?? "").matchAll(COLOR)].map((entry) =>
      displayColor(requiredAttribute(attributes(entry[1] ?? ""), "color", "color entry"))
    );
    if (colors.length === 0) throw new Error(`3MF color group ${id} is empty.`);
    groups.set(id, colors);
  }
  return groups;
}

function triangleCount(xml: string): number {
  let count = 0;
  for (const _match of xml.matchAll(TRIANGLE)) {
    count += 1;
    if (count > MAX_TRIANGLES) throw new Error("3MF model exceeds the triangle limit.");
  }
  if (count === 0) throw new Error("3MF model contains no triangles.");
  return count;
}

function triangleNormal(points: readonly (readonly [number, number, number])[]): [number, number, number] {
  const [a, b, c] = points;
  if (!a || !b || !c) return [0, 0, 1];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal: [number, number, number] = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const magnitude = Math.hypot(...normal);
  return magnitude > 0 && Number.isFinite(magnitude)
    ? normal.map((component) => component / magnitude) as [number, number, number]
    : [0, 0, 1];
}

export function parseThreeMf(archive: Uint8Array): ParsedModelMesh {
  const xml = modelXml(archive);
  const scale = unitScale(xml);
  const groups = colorGroups(xml);
  const count = triangleCount(xml);
  const positions = new Float32Array(count * 9);
  const normals = new Float32Array(count * 9);
  const colors = new Float32Array(count * 9);
  const parts: ParsedModelPart[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let outputTriangle = 0;
  let objectCount = 0;

  for (const object of xml.matchAll(OBJECT)) {
    objectCount += 1;
    if (objectCount > MAX_OBJECTS) throw new Error("3MF model exceeds the object limit.");
    const objectAttributes = attributes(object[1] ?? "");
    const id = requiredAttribute(objectAttributes, "id", "object");
    const body = object[2] ?? "";
    const vertices = [...body.matchAll(VERTEX)].map((entry, index) => {
      const values = attributes(entry[1] ?? "");
      return (["x", "y", "z"] as const).map((axis) =>
        finiteCoordinate(requiredAttribute(values, axis, `object ${id} vertex ${index}`), `object ${id} vertex ${index}`) * scale
      ) as [number, number, number];
    });
    const offset = outputTriangle;
    let partColor = DEFAULT_COLOR;
    for (const triangle of body.matchAll(TRIANGLE)) {
      const values = attributes(triangle[1] ?? "");
      const indices = (["v1", "v2", "v3"] as const).map((name) =>
        nonnegativeIndex(requiredAttribute(values, name, `object ${id} triangle`), `object ${id} triangle`)
      );
      const points = indices.map((index) => vertices[index]);
      if (points.some((point) => point === undefined)) {
        throw new Error(`3MF object ${id} triangle references a missing vertex.`);
      }
      const pid = values.get("pid") ?? objectAttributes.get("pid");
      const fallbackIndex = values.get("p1") ?? objectAttributes.get("pindex") ?? "0";
      const material = ["p1", "p2", "p3"].map((name) => {
        const colorIndex = nonnegativeIndex(values.get(name) ?? fallbackIndex, `object ${id} triangle color`);
        const color = pid ? groups.get(pid)?.[colorIndex] : undefined;
        return color ?? displayColor(DEFAULT_COLOR);
      });
      partColor = material[0]?.css ?? DEFAULT_COLOR;
      const normal = triangleNormal(points as [typeof vertices[number], typeof vertices[number], typeof vertices[number]]);
      const base = outputTriangle * 9;
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const point = points[vertex] as [number, number, number];
        for (let axis = 0; axis < 3; axis += 1) {
          const target = base + vertex * 3 + axis;
          positions[target] = point[axis];
          normals[target] = normal[axis];
          colors[target] = material[vertex]?.rgb[axis] ?? 0;
          if (point[axis] < min[axis]) min[axis] = point[axis];
          if (point[axis] > max[axis]) max[axis] = point[axis];
        }
      }
      outputTriangle += 1;
    }
    if (outputTriangle > offset) {
      parts.push({
        id,
        name: xmlText(objectAttributes.get("name") ?? `Part ${parts.length + 1}`),
        color: partColor,
        triangleOffset: offset,
        triangleCount: outputTriangle - offset,
      });
    }
  }
  if (outputTriangle !== count) throw new Error("3MF triangle accounting is inconsistent.");
  return {
    triangleCount: count,
    positions,
    normals,
    colors,
    parts,
    bounds: {
      min,
      max,
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    },
  };
}
