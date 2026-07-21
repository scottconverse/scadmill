import { parseBinaryStl } from "../geometry/stl";

export interface PrintabilityConfiguration {
  readonly buildVolumeMm: readonly [number, number, number];
  readonly nozzleDiameterMm: number;
}

export interface PrintabilityReport {
  readonly manifold: {
    readonly status: "pass" | "fail";
    readonly boundaryEdges: number;
    readonly nonManifoldEdges: number;
  };
  readonly buildVolume: {
    readonly status: "pass" | "fail";
    readonly modelSizeMm: readonly [number, number, number];
    readonly configuredMm: readonly [number, number, number];
  };
  readonly minimumFeature:
    | { readonly status: "pass"; readonly nozzleDiameterMm: number }
    | { readonly status: "warning"; readonly detectedMm: number; readonly nozzleDiameterMm: number }
    | { readonly status: "not-checked"; readonly reason: string };
  readonly overhangs: { readonly status: "not-checked" };
}

interface Vertex {
  readonly point: readonly [number, number, number];
}

const MAX_FEATURE_VERTICES = 100_000;

function validateConfiguration(configuration: PrintabilityConfiguration): void {
  if (!configuration.buildVolumeMm.every((value) => Number.isFinite(value) && value > 0 && value <= 100_000)) {
    throw new Error("Configured build volume dimensions must be finite positive millimetres.");
  }
  if (!Number.isFinite(configuration.nozzleDiameterMm)
    || configuration.nozzleDiameterMm <= 0
    || configuration.nozzleDiameterMm > 100) {
    throw new Error("Configured nozzle diameter must be a finite positive millimetre value.");
  }
}

function coordinateKey(value: number): string {
  return Object.is(value, -0) ? "0" : Math.fround(value).toString();
}

function vertexKey(point: readonly [number, number, number]): string {
  return `${coordinateKey(point[0])},${coordinateKey(point[1])},${coordinateKey(point[2])}`;
}

function edgeKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function meshTopology(positions: Float32Array) {
  const vertices: Vertex[] = [];
  const vertexIds = new Map<string, number>();
  const edges = new Map<string, number>();
  const adjacency = new Set<string>();
  for (let offset = 0; offset < positions.length; offset += 9) {
    const triangle: number[] = [];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const vertexOffset = offset + vertex * 3;
      const point: [number, number, number] = [
        positions[vertexOffset],
        positions[vertexOffset + 1],
        positions[vertexOffset + 2],
      ];
      const key = vertexKey(point);
      let id = vertexIds.get(key);
      if (id === undefined) {
        id = vertices.length;
        vertexIds.set(key, id);
        vertices.push({ point });
      }
      triangle.push(id);
    }
    for (const [left, right] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
      const key = edgeKey(left, right);
      edges.set(key, (edges.get(key) ?? 0) + 1);
      adjacency.add(key);
    }
  }
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edges.values()) {
    if (count === 1) boundaryEdges += 1;
    else if (count !== 2) nonManifoldEdges += 1;
  }
  return { vertices, adjacency, boundaryEdges, nonManifoldEdges };
}

function sampledMinimumFeature(
  vertices: readonly Vertex[],
  adjacency: ReadonlySet<string>,
  nozzleDiameterMm: number,
): number | undefined {
  const cells = new Map<string, number[]>();
  let detected: number | undefined;
  const cellCoordinate = (value: number) => Math.floor(value / nozzleDiameterMm);
  for (let id = 0; id < vertices.length; id += 1) {
    const point = vertices[id].point;
    const cell = point.map(cellCoordinate) as [number, number, number];
    for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) {
      const candidates = cells.get(`${cell[0] + x}:${cell[1] + y}:${cell[2] + z}`) ?? [];
      for (const candidate of candidates) {
        if (adjacency.has(edgeKey(id, candidate))) continue;
        const other = vertices[candidate].point;
        const distance = Math.hypot(point[0] - other[0], point[1] - other[1], point[2] - other[2]);
        if (distance > 0 && distance < nozzleDiameterMm && (detected === undefined || distance < detected)) {
          detected = distance;
        }
      }
    }
    const ownCell = `${cell[0]}:${cell[1]}:${cell[2]}`;
    cells.set(ownCell, [...(cells.get(ownCell) ?? []), id]);
  }
  return detected;
}

export function analyzePrintability(
  binaryStl: Uint8Array,
  configuration: PrintabilityConfiguration,
): PrintabilityReport {
  validateConfiguration(configuration);
  const mesh = parseBinaryStl(binaryStl);
  const topology = meshTopology(mesh.positions);
  const manifold = topology.boundaryEdges === 0 && topology.nonManifoldEdges === 0;
  const buildVolumePass = mesh.bounds.size.every((value, axis) => value <= configuration.buildVolumeMm[axis]);
  let minimumFeature: PrintabilityReport["minimumFeature"];
  if (topology.vertices.length > MAX_FEATURE_VERTICES) {
    minimumFeature = { status: "not-checked", reason: `mesh exceeds the ${MAX_FEATURE_VERTICES}-vertex heuristic limit` };
  } else {
    const detected = sampledMinimumFeature(topology.vertices, topology.adjacency, configuration.nozzleDiameterMm);
    minimumFeature = detected !== undefined
      ? { status: "warning", detectedMm: detected, nozzleDiameterMm: configuration.nozzleDiameterMm }
      : manifold
        ? { status: "pass", nozzleDiameterMm: configuration.nozzleDiameterMm }
        : { status: "not-checked", reason: "no non-adjacent surface samples were available" };
  }
  return {
    manifold: {
      status: manifold ? "pass" : "fail",
      boundaryEdges: topology.boundaryEdges,
      nonManifoldEdges: topology.nonManifoldEdges,
    },
    buildVolume: {
      status: buildVolumePass ? "pass" : "fail",
      modelSizeMm: mesh.bounds.size,
      configuredMm: [...configuration.buildVolumeMm],
    },
    minimumFeature,
    overhangs: { status: "not-checked" },
  };
}

function millimetres(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function dimensions(values: readonly [number, number, number]): string {
  return values.map(millimetres).join(" × ");
}

export function printabilityReportLines(report: PrintabilityReport): readonly string[] {
  const manifold = `Manifold: ${report.manifold.status.toUpperCase()} (mesh topology check; ${report.manifold.boundaryEdges} boundary edges, ${report.manifold.nonManifoldEdges} non-manifold edges)`;
  const buildVolume = `Build volume: ${report.buildVolume.status.toUpperCase()} (bounding box ${dimensions(report.buildVolume.modelSizeMm)} mm vs configured ${dimensions(report.buildVolume.configuredMm)} mm)`;
  const minimumFeature = report.minimumFeature.status === "warning"
    ? `Minimum feature: WARNING (sampled non-adjacent surface separation ${millimetres(report.minimumFeature.detectedMm)} mm vs configured ${millimetres(report.minimumFeature.nozzleDiameterMm)} mm nozzle)`
    : report.minimumFeature.status === "pass"
      ? `Minimum feature: PASS (no sampled non-adjacent surface separation below the configured ${millimetres(report.minimumFeature.nozzleDiameterMm)} mm nozzle)`
      : `Minimum feature: NOT CHECKED (${report.minimumFeature.reason})`;
  return [manifold, buildVolume, minimumFeature, "Overhangs: NOT CHECKED (no overhang analysis was run)"];
}
