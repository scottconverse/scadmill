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

export function isParameterValueCompatible(
  value: ParameterValue,
  reference: ParameterValue,
): boolean {
  if (Array.isArray(reference)) {
    return (
      Array.isArray(value)
      && value.length === reference.length
      && value.length > 0
      && value.every((component) => typeof component === "number" && Number.isFinite(component))
    );
  }
  if (Array.isArray(value) || typeof value !== typeof reference) return false;
  return typeof value !== "number" || Number.isFinite(value);
}

export function cloneParameterValue(value: ParameterValue): ParameterValue {
  return Array.isArray(value) ? [...value] : value;
}

export function parameterValueToSource(value: ParameterValue): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Parameter numbers must be finite.");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (
    value.length < 1
    || value.some((component) => !Number.isFinite(component))
  ) {
    throw new TypeError("Parameter vectors must contain non-empty finite numbers.");
  }
  return `[${value.map((component) => (Object.is(component, -0) ? "0" : String(component))).join(", ")}]`;
}
