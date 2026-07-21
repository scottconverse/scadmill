import { useMemo, useState } from "react";

import {
  type ArtifactDestination,
  UNAVAILABLE_ARTIFACT_DESTINATION,
} from "../../application/files/artifact-destination";
import type {
  CustomizerParameter,
  ParameterValue,
} from "../../application/parameters/customizer-schema";
import type {
  ParameterAction,
  ParameterDocumentState,
} from "../../application/parameters/parameter-state";
import { messages } from "../../messages/en";
import { ParameterSetExchange } from "./ParameterSetExchange";

export interface ParameterPanelProps {
  readonly artifactDestination?: ArtifactDestination;
  readonly documentId: string;
  readonly state: ParameterDocumentState;
  readonly onAction: (action: ParameterAction) => void;
  readonly onWrite: () => void;
}

type WithoutDocument<T> = T extends { readonly documentId: string }
  ? Omit<T, "documentId">
  : never;
type LocalParameterAction = WithoutDocument<ParameterAction>;

interface ParameterInputProps {
  readonly parameter: CustomizerParameter;
  readonly value: ParameterValue;
  readonly onValue: (value: ParameterValue) => void;
}

const VECTOR_AXES = ["x", "y", "z", "w"] as const;

function currentValue(state: ParameterDocumentState, parameter: CustomizerParameter): ParameterValue {
  return Object.hasOwn(state.overrides, parameter.name)
    ? (state.overrides[parameter.name] as ParameterValue)
    : parameter.defaultValue;
}

function ParameterInput({ parameter, value, onValue }: ParameterInputProps) {
  const label = parameter.description ?? parameter.name;
  switch (parameter.control.kind) {
    case "checkbox":
      return (
        <input
          aria-label={label}
          checked={value === true}
          onChange={(event) => onValue(event.currentTarget.checked)}
          type="checkbox"
        />
      );
    case "text":
      return (
        <input
          aria-label={label}
          onChange={(event) => onValue(event.currentTarget.value)}
          type="text"
          value={typeof value === "string" ? value : ""}
        />
      );
    case "number":
      return (
        <input
          aria-label={label}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (Number.isFinite(next)) onValue(next);
          }}
          step={parameter.control.step}
          type="number"
          value={typeof value === "number" ? value : 0}
        />
      );
    case "slider":
      return (
        <span className="parameter-slider">
          <input
            aria-label={label}
            max={parameter.control.maximum}
            min={parameter.control.minimum}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (Number.isFinite(next)) onValue(next);
            }}
            step={parameter.control.step ?? "any"}
            type="range"
            value={typeof value === "number" ? value : parameter.control.minimum}
          />
          <output>{typeof value === "number" ? value : parameter.control.minimum}</output>
        </span>
      );
    case "dropdown": {
      const options = parameter.control.options;
      const selected = options.findIndex((option) => Object.is(option.value, value));
      return (
        <select
          aria-label={label}
          onChange={(event) => {
            const option = options[Number(event.currentTarget.value)];
            if (option) onValue(option.value);
          }}
          value={selected < 0 ? "" : String(selected)}
        >
          {selected < 0 && <option value="" disabled>{String(value)}</option>}
          {options.map((option, index) => (
            <option
              key={`${typeof option.value}:${String(option.value)}:${option.label}`}
              value={index}
            >{option.label}</option>
          ))}
        </select>
      );
    }
    case "vector": {
      const vector = Array.isArray(value) ? value : parameter.defaultValue;
      if (!Array.isArray(vector)) return null;
      return (
        <span className="parameter-vector">
          {vector.map((component, index) => (
            <input
              aria-label={messages.vectorComponent(parameter.name, index)}
              key={`${parameter.name}-${VECTOR_AXES[index] ?? `component-${index}`}`}
              onChange={(event) => {
                const next = event.currentTarget.valueAsNumber;
                if (!Number.isFinite(next)) return;
                const updated = [...vector];
                updated[index] = next;
                onValue(updated);
              }}
              step="any"
              type="number"
              value={component}
            />
          ))}
        </span>
      );
    }
  }
}

export function ParameterPanel({
  artifactDestination = UNAVAILABLE_ARTIFACT_DESTINATION,
  documentId,
  state,
  onAction,
  onWrite,
}: ParameterPanelProps) {
  const [setName, setSetName] = useState("");
  const groups = useMemo(() => {
    const grouped: Array<[string, CustomizerParameter[]]> = [];
    for (const parameter of state.parameters) {
      if (parameter.hidden) continue;
      const name = parameter.group ?? messages.parametersDefaultGroup;
      const group = grouped.at(-1);
      if (group?.[0] === name) group[1].push(parameter);
      else grouped.push([name, [parameter]]);
    }
    return grouped;
  }, [state.parameters]);
  const selectedSet = state.selectedSet ?? "";
  const dispatch = (action: LocalParameterAction) =>
    onAction({ ...action, documentId } as ParameterAction);

  return (
    <div className="parameter-panel-content">
      <div className="parameter-set-controls">
        <label>
          <span>{messages.parameterSet}</span>
          <select
            aria-label={messages.parameterSet}
            onChange={(event) => {
              if (event.currentTarget.value) {
                dispatch({ kind: "apply-set", name: event.currentTarget.value });
              } else {
                dispatch({ kind: "reset-all" });
              }
            }}
            value={selectedSet}
          >
            <option value="">{messages.parameterSetDesignDefault}</option>
            {state.sets.map(({ name }) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          <span>{messages.parameterSetName}</span>
          <input
            aria-label={messages.parameterSetName}
            onChange={(event) => setSetName(event.currentTarget.value)}
            type="text"
            value={setName}
          />
        </label>
        <div className="parameter-set-actions">
          <button
            aria-label={messages.saveParameterSet}
            disabled={!setName.trim()}
            onClick={() => dispatch({ kind: "save-set", name: setName.trim() })}
            type="button"
          >{messages.saveParameterSet}</button>
          <button
            aria-label={messages.renameParameterSet}
            disabled={!selectedSet || !setName.trim()}
            onClick={() => dispatch({ kind: "rename-set", from: selectedSet, to: setName.trim() })}
            type="button"
          >{messages.renameParameterSet}</button>
          <button
            aria-label={messages.deleteParameterSet}
            disabled={!selectedSet}
            onClick={() => dispatch({ kind: "delete-set", name: selectedSet })}
            type="button"
          >{messages.deleteParameterSet}</button>
        </div>
        <ParameterSetExchange
          artifactDestination={artifactDestination}
          documentId={documentId}
          parameters={state.parameters}
          sets={state.sets}
          onReplaceSets={(sets) => dispatch({ kind: "replace-sets", sets })}
        />
      </div>

      {groups.length === 0 ? <p>{messages.noParametersDetected}</p> : groups.map(([group, parameters]) => (
        <details key={`${group}:${parameters[0]?.name}`} open>
          <summary>{group}</summary>
          <div className="parameter-group">
            {parameters.map((parameter) => (
              <div className="parameter-control" key={parameter.name}>
                <div className="parameter-label">
                  <code>{parameter.name}</code>
                  {parameter.description && <span>{parameter.description}</span>}
                </div>
                <ParameterInput
                  parameter={parameter}
                  value={currentValue(state, parameter)}
                  onValue={(value) => dispatch({ kind: "set-value", name: parameter.name, value })}
                />
                <button
                  aria-label={messages.resetParameter(parameter.name)}
                  onClick={() => dispatch({ kind: "reset-value", name: parameter.name })}
                  type="button"
                >{messages.resetParameterAction}</button>
              </div>
            ))}
          </div>
        </details>
      ))}

      <div className="parameter-panel-actions">
        <button
          aria-label={messages.resetAllParameters}
          onClick={() => dispatch({ kind: "reset-all" })}
          type="button"
        >{messages.resetAllParameters}</button>
        <button
          aria-label={messages.writeParameterValues}
          disabled={Object.keys(state.overrides).length === 0}
          onClick={onWrite}
          type="button"
        >{messages.writeParameterValues}</button>
      </div>
    </div>
  );
}
