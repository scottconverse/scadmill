export type ParameterScalarValue = number | boolean | string;
export type ParameterValue = ParameterScalarValue | readonly number[];

export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export interface DropdownOption {
  readonly value: ParameterScalarValue;
  readonly label: string;
}

export type ParameterControl =
  | { readonly kind: "slider"; readonly minimum: number; readonly maximum: number; readonly step?: number }
  | { readonly kind: "dropdown"; readonly options: readonly DropdownOption[] }
  | { readonly kind: "checkbox" }
  | { readonly kind: "number"; readonly step: number }
  | { readonly kind: "text" }
  | { readonly kind: "vector"; readonly length: number };

export interface CustomizerParameter {
  readonly name: string;
  readonly defaultValue: ParameterValue;
  readonly defaultSource: string;
  readonly group: string | null;
  readonly hidden: boolean;
  readonly description?: string;
  readonly control: ParameterControl;
  readonly assignmentRange: SourceRange;
  readonly nameRange: SourceRange;
  readonly valueRange: SourceRange;
  readonly componentRanges?: readonly SourceRange[];
}

function snapshotDenseFiniteNumberVector(value: readonly unknown[]): number[] | null {
  const length = value.length;
  if (!Number.isSafeInteger(length) || length <= 0 || length > 0xffff_ffff) return null;
  const snapshot: number[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) return null;
    const component = value[index];
    if (typeof component !== "number" || !Number.isFinite(component)) return null;
    snapshot.push(component);
  }
  return snapshot;
}

export function isParameterValueCompatible(
  value: ParameterValue,
  reference: ParameterValue,
): boolean {
  if (Array.isArray(reference)) {
    if (!Array.isArray(value)) return false;
    const referenceSnapshot = snapshotDenseFiniteNumberVector(reference);
    const valueSnapshot = snapshotDenseFiniteNumberVector(value);
    return referenceSnapshot !== null
      && valueSnapshot !== null
      && valueSnapshot.length === referenceSnapshot.length;
  }
  if (Array.isArray(value) || typeof value !== typeof reference) return false;
  return typeof value !== "number" || Number.isFinite(value);
}

export function cloneParameterValue(value: ParameterValue): ParameterValue {
  if (Array.isArray(value)) {
    const snapshot = snapshotDenseFiniteNumberVector(value);
    if (snapshot) return snapshot;
  } else if (
    typeof value === "boolean"
    || typeof value === "string"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new TypeError(
    "Invalid parameter value: expected a finite scalar or non-empty dense vector of finite numbers.",
  );
}

export function parameterValueToSource(value: ParameterValue): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Parameter numbers must be finite.");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  const snapshot = snapshotDenseFiniteNumberVector(value);
  if (!snapshot) {
    throw new TypeError("Parameter vectors must contain non-empty finite numbers.");
  }
  const components = snapshot.map((component) => Object.is(component, -0) ? "0" : String(component));
  return `[${components.join(", ")}]`;
}
