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

function isDenseFiniteNumberVector(value: readonly unknown[]): value is readonly number[] {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (
      !Object.hasOwn(value, index)
      || typeof value[index] !== "number"
      || !Number.isFinite(value[index])
    ) return false;
  }
  return true;
}

function isParameterValue(value: unknown): value is ParameterValue {
  return (
    typeof value === "boolean"
    || typeof value === "string"
    || (typeof value === "number" && Number.isFinite(value))
    || (Array.isArray(value) && isDenseFiniteNumberVector(value))
  );
}

export function isParameterValueCompatible(
  value: ParameterValue,
  reference: ParameterValue,
): boolean {
  if (Array.isArray(reference)) {
    return (
      Array.isArray(value)
      && value.length === reference.length
      && isDenseFiniteNumberVector(reference)
      && isDenseFiniteNumberVector(value)
    );
  }
  if (Array.isArray(value) || typeof value !== typeof reference) return false;
  return typeof value !== "number" || Number.isFinite(value);
}

export function cloneParameterValue(value: ParameterValue): ParameterValue {
  if (!isParameterValue(value)) {
    throw new TypeError(
      "Invalid parameter value: expected a finite scalar or non-empty dense vector of finite numbers.",
    );
  }
  return Array.isArray(value) ? [...value] : value;
}

export function parameterValueToSource(value: ParameterValue): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Parameter numbers must be finite.");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (!isDenseFiniteNumberVector(value)) {
    throw new TypeError("Parameter vectors must contain non-empty finite numbers.");
  }
  const components: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const component = value[index] as number;
    components.push(Object.is(component, -0) ? "0" : String(component));
  }
  return `[${components.join(", ")}]`;
}
