import {
  cloneParameterValue,
  type CustomizerParameter,
  type ParameterValue,
  parameterValueToSource,
} from "./customizer-schema";

export interface NamedParameterSet {
  readonly name: string;
  readonly values: Readonly<Record<string, ParameterValue>>;
}

export class ParameterSetFormatError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ParameterSetFormatError";
  }
}

const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const PARAMETER_NAME_PATTERN = /^\$?[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSetName(name: string): boolean {
  return typeof name === "string" && name.trim().length > 0;
}

function validParameterName(name: string): boolean {
  return typeof name === "string" && PARAMETER_NAME_PATTERN.test(name);
}

function defineOwn<T>(target: Record<string, T>, name: string, value: T): void {
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function storedValue(value: ParameterValue): string {
  if (typeof value === "string") return value;
  try {
    return parameterValueToSource(value);
  } catch (error) {
    throw new ParameterSetFormatError(
      error instanceof Error ? error.message : "Parameter value is invalid.",
    );
  }
}

function snapshotValue(value: ParameterValue): ParameterValue {
  try {
    return cloneParameterValue(value);
  } catch (error) {
    throw new ParameterSetFormatError(
      error instanceof Error ? error.message : "Parameter value is invalid.",
    );
  }
}

export function snapshotParameterSets(
  sets: readonly NamedParameterSet[],
): readonly NamedParameterSet[] {
  const names = new Set<string>();
  const snapshots: NamedParameterSet[] = [];
  for (const set of sets) {
    const name = set.name;
    const sourceValues = set.values;
    if (!validSetName(name) || names.has(name)) {
      throw new ParameterSetFormatError(`Invalid or duplicate parameter-set name: "${name}".`);
    }
    if (!isRecord(sourceValues)) {
      throw new ParameterSetFormatError(`Parameter set "${name}" must be an object.`);
    }
    names.add(name);
    const values: Record<string, ParameterValue> = {};
    for (const parameterName of Object.keys(sourceValues)) {
      if (!validParameterName(parameterName)) {
        throw new ParameterSetFormatError(`Invalid parameter name in set "${name}".`);
      }
      const value = sourceValues[parameterName];
      if (value === undefined) {
        throw new ParameterSetFormatError(`Missing value for parameter "${parameterName}".`);
      }
      defineOwn(values, parameterName, snapshotValue(value));
    }
    snapshots.push({ name, values });
  }
  return snapshots;
}

function finiteNumber(source: string): number | null {
  if (!NUMBER_PATTERN.test(source)) return null;
  const value = Number(source);
  return Number.isFinite(value) ? value : null;
}

function decodedValue(source: string, reference: ParameterValue): ParameterValue | null {
  if (typeof reference === "string") return source;
  if (typeof reference === "boolean") {
    return source === "true" ? true : source === "false" ? false : null;
  }
  if (typeof reference === "number") return finiteNumber(source);
  if (!source.startsWith("[") || !source.endsWith("]")) return null;
  const body = source.slice(1, -1).trim();
  if (body.length === 0) return null;
  const values = body.split(",").map((part) => finiteNumber(part.trim()));
  if (values.length !== reference.length || values.some((value) => value === null)) return null;
  return values as number[];
}

export function encodeParameterSets(sets: readonly NamedParameterSet[]): string {
  const parameterSets: Record<string, Record<string, string>> = {};
  for (const set of snapshotParameterSets(sets)) {
    const values: Record<string, string> = {};
    for (const name of Object.keys(set.values)) {
      defineOwn(values, name, storedValue(set.values[name] as ParameterValue));
    }
    defineOwn(parameterSets, set.name, values);
  }
  return JSON.stringify({ parameterSets, fileFormatVersion: "1" }, null, 2);
}

export function decodeParameterSets(
  source: string,
  parameters: readonly CustomizerParameter[],
): readonly NamedParameterSet[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new ParameterSetFormatError("Parameter-set file is not valid JSON.");
  }
  if (!isRecord(parsed)) throw new ParameterSetFormatError("Parameter-set root must be an object.");
  const rootKeys = Object.keys(parsed);
  if (
    rootKeys.length !== 2
    || !Object.hasOwn(parsed, "parameterSets")
    || !Object.hasOwn(parsed, "fileFormatVersion")
    || parsed.fileFormatVersion !== "1"
    || !isRecord(parsed.parameterSets)
  ) {
    throw new ParameterSetFormatError("Expected the exact OpenSCAD parameter-set JSON v1 shape.");
  }

  const schema = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const result: NamedParameterSet[] = [];
  for (const setName of Object.keys(parsed.parameterSets)) {
    if (!validSetName(setName)) throw new ParameterSetFormatError("Parameter-set name is empty.");
    const storedSet = parsed.parameterSets[setName];
    if (!isRecord(storedSet)) {
      throw new ParameterSetFormatError(`Parameter set "${setName}" must be an object.`);
    }
    const values: Record<string, ParameterValue> = {};
    for (const name of Object.keys(storedSet)) {
      if (!validParameterName(name)) {
        throw new ParameterSetFormatError(`Parameter set "${setName}" contains an invalid parameter name.`);
      }
      const stored = storedSet[name];
      if (typeof stored !== "string") {
        throw new ParameterSetFormatError(`Stored value for "${name}" must be a string.`);
      }
      const parameter = schema.get(name);
      if (parameter === undefined) continue;
      const value = decodedValue(stored, parameter.defaultValue);
      if (value === null) {
        throw new ParameterSetFormatError(`Stored value for "${name}" has the wrong type or shape.`);
      }
      defineOwn(values, name, value);
    }
    result.push({ name: setName, values });
  }
  return result;
}
