import { extractCustomizerParameters } from "./customizer-parser";
import {
  cloneParameterValue,
  type CustomizerParameter,
  isParameterValueCompatible,
  type ParameterValue,
} from "./customizer-schema";
import { reconcileParameterOverrides } from "./parameter-overrides";
import type { NamedParameterSet } from "./parameter-set-codec";

export interface ParameterDocumentSeed {
  readonly documentId: string;
  readonly revision: number;
  readonly source: string;
}

export interface ParameterDocumentState {
  readonly revision: number;
  readonly parameters: readonly CustomizerParameter[];
  readonly overrides: Readonly<Record<string, ParameterValue>>;
  readonly sets: readonly NamedParameterSet[];
  readonly selectedSet?: string;
}

export interface ParameterState {
  readonly documents: ReadonlyMap<string, ParameterDocumentState>;
}

export type ParameterAction =
  | (ParameterDocumentSeed & { readonly kind: "sync-source"; readonly replace?: boolean })
  | {
      readonly kind: "set-value";
      readonly documentId: string;
      readonly name: string;
      readonly value: ParameterValue;
    }
  | { readonly kind: "reset-value"; readonly documentId: string; readonly name: string }
  | { readonly kind: "reset-all"; readonly documentId: string }
  | { readonly kind: "save-set"; readonly documentId: string; readonly name: string }
  | { readonly kind: "apply-set"; readonly documentId: string; readonly name: string }
  | {
      readonly kind: "rename-set";
      readonly documentId: string;
      readonly from: string;
      readonly to: string;
    }
  | { readonly kind: "delete-set"; readonly documentId: string; readonly name: string }
  | { readonly kind: "replace-sets"; readonly documentId: string; readonly sets: readonly NamedParameterSet[] }
  | { readonly kind: "clear-overrides"; readonly documentId: string };

function requireName(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must be non-empty.`);
}

function defineValue(
  target: Record<string, ParameterValue>,
  name: string,
  value: ParameterValue,
): void {
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    value: cloneParameterValue(value),
    writable: true,
  });
}

function valuesEqual(left: ParameterValue, right: ParameterValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  }
  return !Array.isArray(left) && !Array.isArray(right) && Object.is(left, right);
}

export function parameterRecordsEqual(
  left: Readonly<Record<string, ParameterValue>>,
  right: Readonly<Record<string, ParameterValue>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((name) =>
      Object.hasOwn(right, name)
      && valuesEqual(left[name] as ParameterValue, right[name] as ParameterValue)
    );
}

function initialDocument(seed: ParameterDocumentSeed): ParameterDocumentState {
  requireName(seed.documentId, "Document id");
  if (!Number.isInteger(seed.revision) || seed.revision < 0) {
    throw new Error("Document revision must be a non-negative integer.");
  }
  return {
    revision: seed.revision,
    parameters: extractCustomizerParameters(seed.source),
    overrides: {},
    sets: [],
  };
}

function setDocument(
  state: ParameterState,
  documentId: string,
  document: ParameterDocumentState,
): ParameterState {
  const documents = new Map(state.documents);
  documents.set(documentId, document);
  return { documents };
}

function requiredDocument(state: ParameterState, documentId: string): ParameterDocumentState {
  requireName(documentId, "Document id");
  const document = state.documents.get(documentId);
  if (!document) throw new Error(`Unknown parameter document: ${documentId}.`);
  return document;
}

function withValue(
  document: ParameterDocumentState,
  name: string,
  value: ParameterValue,
): ParameterDocumentState {
  const parameter = document.parameters.find((candidate) => candidate.name === name);
  if (!parameter) throw new Error(`Unknown customizer parameter: ${name}.`);
  if (parameter.hidden) throw new Error(`Hidden customizer parameter cannot be overridden: ${name}.`);
  if (!isParameterValueCompatible(value, parameter.defaultValue)) {
    throw new TypeError(`Value for ${name} is not compatible with its source default.`);
  }
  const overrides: Record<string, ParameterValue> = {};
  for (const [existingName, existingValue] of Object.entries(document.overrides)) {
    if (existingName !== name) defineValue(overrides, existingName, existingValue);
  }
  if (!valuesEqual(value, parameter.defaultValue)) defineValue(overrides, name, value);
  return { ...document, overrides, selectedSet: undefined };
}

function effectiveValues(document: ParameterDocumentState): Readonly<Record<string, ParameterValue>> {
  const values: Record<string, ParameterValue> = {};
  for (const parameter of document.parameters) {
    defineValue(
      values,
      parameter.name,
      Object.hasOwn(document.overrides, parameter.name)
        ? (document.overrides[parameter.name] as ParameterValue)
        : parameter.defaultValue,
    );
  }
  return values;
}

function applyValues(
  document: ParameterDocumentState,
  values: Readonly<Record<string, ParameterValue>>,
): ParameterDocumentState {
  let next = document;
  for (const [name, value] of Object.entries(values)) {
    const parameter = document.parameters.find((candidate) => candidate.name === name);
    if (
      parameter === undefined
      || parameter.hidden
      || !isParameterValueCompatible(value, parameter.defaultValue)
    ) continue;
    next = withValue(next, name, value);
  }
  return next;
}

export function createParameterState(
  seeds: readonly ParameterDocumentSeed[] = [],
): ParameterState {
  const documents = new Map<string, ParameterDocumentState>();
  for (const seed of seeds) {
    if (documents.has(seed.documentId)) throw new Error(`Duplicate parameter document: ${seed.documentId}.`);
    documents.set(seed.documentId, initialDocument(seed));
  }
  return { documents };
}

export function parameterDocument(
  state: ParameterState,
  documentId: string,
): ParameterDocumentState {
  return requiredDocument(state, documentId);
}

export function reduceParameterState(state: ParameterState, action: ParameterAction): ParameterState {
  if (action.kind === "sync-source") {
    const previous = state.documents.get(action.documentId);
    if (previous && !action.replace && action.revision <= previous.revision) return state;
    const parsed = initialDocument(action);
    return setDocument(state, action.documentId, previous && !action.replace
      ? {
          ...previous,
          revision: action.revision,
          parameters: parsed.parameters,
          overrides: reconcileParameterOverrides(parsed.parameters, previous.overrides),
          selectedSet: undefined,
        }
      : parsed);
  }

  const document = requiredDocument(state, action.documentId);
  switch (action.kind) {
    case "set-value": {
      const next = withValue(document, action.name, action.value);
      if (parameterRecordsEqual(document.overrides, next.overrides)) {
        return state;
      }
      return setDocument(state, action.documentId, next);
    }
    case "reset-value": {
      const parameter = document.parameters.find(({ name }) => name === action.name);
      if (!parameter) throw new Error(`Unknown customizer parameter: ${action.name}.`);
      return setDocument(state, action.documentId, withValue(document, action.name, parameter.defaultValue));
    }
    case "reset-all":
    case "clear-overrides":
      return setDocument(state, action.documentId, { ...document, overrides: {}, selectedSet: undefined });
    case "save-set": {
      requireName(action.name, "Parameter-set name");
      const saved = { name: action.name, values: effectiveValues(document) };
      return setDocument(state, action.documentId, {
        ...document,
        sets: [...document.sets.filter(({ name }) => name !== action.name), saved],
        selectedSet: action.name,
      });
    }
    case "apply-set": {
      const selected = document.sets.find(({ name }) => name === action.name);
      if (!selected) throw new Error(`Unknown parameter set: ${action.name}.`);
      return setDocument(state, action.documentId, {
        ...applyValues(document, selected.values),
        selectedSet: action.name,
      });
    }
    case "rename-set": {
      requireName(action.to, "Parameter-set name");
      if (!document.sets.some(({ name }) => name === action.from)) {
        throw new Error(`Unknown parameter set: ${action.from}.`);
      }
      if (action.from !== action.to && document.sets.some(({ name }) => name === action.to)) {
        throw new Error(`Parameter set already exists: ${action.to}.`);
      }
      return setDocument(state, action.documentId, {
        ...document,
        sets: document.sets.map((set) => set.name === action.from ? { ...set, name: action.to } : set),
        selectedSet: document.selectedSet === action.from ? action.to : document.selectedSet,
      });
    }
    case "delete-set":
      return setDocument(state, action.documentId, {
        ...document,
        sets: document.sets.filter(({ name }) => name !== action.name),
        selectedSet: document.selectedSet === action.name ? undefined : document.selectedSet,
      });
    case "replace-sets":
      return setDocument(state, action.documentId, {
        ...document,
        sets: action.sets.map((set) => ({ name: set.name, values: { ...set.values } })),
        selectedSet: undefined,
      });
  }
}
