import {
  cloneParameterValue,
  type CustomizerParameter,
  isParameterValueCompatible,
  type ParameterValue,
  parameterValueToSource,
} from "./customizer-schema";

function parameterValuesEqual(left: ParameterValue, right: ParameterValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((component, index) => Object.is(component, right[index]));
  }
  return !Array.isArray(left) && !Array.isArray(right) && Object.is(left, right);
}

export function reconcileParameterOverrides(
  parameters: readonly CustomizerParameter[],
  previous: Readonly<Record<string, ParameterValue>>,
): Readonly<Record<string, ParameterValue>> {
  const reconciled: Record<string, ParameterValue> = {};
  for (const parameter of parameters) {
    if (parameter.hidden || !Object.hasOwn(previous, parameter.name)) continue;
    const value = previous[parameter.name];
    let ownedValue: ParameterValue;
    try {
      if (value === undefined) continue;
      ownedValue = cloneParameterValue(value);
    } catch {
      continue;
    }
    if (
      isParameterValueCompatible(ownedValue, parameter.defaultValue)
      && !parameterValuesEqual(ownedValue, parameter.defaultValue)
    ) {
      Object.defineProperty(reconciled, parameter.name, {
        configurable: true,
        enumerable: true,
        value: ownedValue,
        writable: true,
      });
    }
  }
  return reconciled;
}

export function writeParameterValues(
  source: string,
  parameters: readonly CustomizerParameter[],
  values: Readonly<Record<string, ParameterValue>>,
): string {
  const replacements: Array<{ readonly from: number; readonly to: number; readonly text: string }> = [];
  for (const parameter of parameters) {
    if (!Object.hasOwn(values, parameter.name)) continue;
    const value = values[parameter.name];
    let ownedValue: ParameterValue;
    try {
      if (value === undefined) throw new TypeError("Missing parameter value.");
      ownedValue = cloneParameterValue(value);
    } catch {
      throw new TypeError(`Invalid value for parameter "${parameter.name}".`);
    }
    if (!isParameterValueCompatible(ownedValue, parameter.defaultValue)) {
      throw new TypeError(`Invalid value for parameter "${parameter.name}".`);
    }
    if (
      parameter.valueRange.from < 0
      || parameter.valueRange.to < parameter.valueRange.from
      || parameter.valueRange.to > source.length
      || source.slice(parameter.valueRange.from, parameter.valueRange.to) !== parameter.defaultSource
    ) {
      throw new RangeError(`Parameter "${parameter.name}" does not belong to the current document.`);
    }
    if (
      Array.isArray(ownedValue)
      && Array.isArray(parameter.defaultValue)
      && parameter.componentRanges?.length === ownedValue.length
    ) {
      for (let index = 0; index < ownedValue.length; index += 1) {
        if (Object.is(ownedValue[index], parameter.defaultValue[index])) continue;
        const range = parameter.componentRanges[index];
        if (
          range === undefined
          || range.from < parameter.valueRange.from
          || range.to > parameter.valueRange.to
          || range.to < range.from
        ) {
          throw new RangeError(`Parameter "${parameter.name}" has invalid component ranges.`);
        }
        replacements.push({ from: range.from, to: range.to, text: parameterValueToSource(ownedValue[index] as number) });
      }
    } else {
      replacements.push({
        from: parameter.valueRange.from,
        to: parameter.valueRange.to,
        text: parameterValueToSource(ownedValue),
      });
    }
  }
  replacements.sort((left, right) => right.from - left.from);
  let rewritten = source;
  for (const replacement of replacements) {
    rewritten = rewritten.slice(0, replacement.from) + replacement.text + rewritten.slice(replacement.to);
  }
  return rewritten;
}
