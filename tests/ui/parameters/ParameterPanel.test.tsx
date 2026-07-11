// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactDestination } from "../../../src/application/files/artifact-destination";
import { encodeParameterSets } from "../../../src/application/parameters/parameter-set-codec";
import {
  createParameterState,
  parameterDocument,
  reduceParameterState,
} from "../../../src/application/parameters/parameter-state";
import { ParameterPanel } from "../../../src/ui/parameters/ParameterPanel";

const source = `/* [Dimensions] */
// Overall width
width = 60; // [20:5:200]
depth = 40;
enabled = true;
title = "Box";
origin = [0, 1, 2];
style = "round"; // [round:Rounded, square:Square]
/* [Hidden] */
$fn = 48;
cube([width, depth, 10]);`;

function parameterFile(source: string, size = new TextEncoder().encode(source).byteLength): File {
  return {
    size,
    text: vi.fn().mockResolvedValue(source),
  } as unknown as File;
}

function stateWithSavedSet() {
  let state = createParameterState([{ documentId: "doc-a", revision: 0, source }]);
  state = reduceParameterState(state, {
    kind: "set-value",
    documentId: "doc-a",
    name: "width",
    value: 85,
  });
  state = reduceParameterState(state, {
    kind: "save-set",
    documentId: "doc-a",
    name: "Wide",
  });
  return parameterDocument(state, "doc-a");
}

describe("ParameterPanel", () => {
  it("preserves noncontiguous repeated section labels as separate source-order groups", () => {
    const repeated = `/* [A] */
first = 1;
/* [B] */
second = 2;
/* [A] */
third = 3;
cube(first);`;
    const state = parameterDocument(
      createParameterState([{ documentId: "doc-a", revision: 0, source: repeated }]),
      "doc-a",
    );
    const view = render(
      <ParameterPanel documentId="doc-a" state={state} onAction={vi.fn()} onWrite={vi.fn()} />,
    );
    const groups = [...view.container.querySelectorAll(".parameter-panel-content details")];

    expect(groups.map((group) => group.querySelector("summary")?.textContent)).toEqual([
      "A",
      "B",
      "A",
    ]);
    expect(groups.map((group) => group.querySelector("code")?.textContent)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("renders grouped controls in source order while hiding Hidden parameters", () => {
    const state = parameterDocument(
      createParameterState([{ documentId: "doc-a", revision: 0, source }]),
      "doc-a",
    );
    const view = render(
      <ParameterPanel documentId="doc-a" state={state} onAction={vi.fn()} onWrite={vi.fn()} />,
    );

    expect(view.queryByText("Dimensions")).toBeVisible();
    expect(view.getByLabelText("Overall width")).toHaveAttribute("type", "range");
    expect(view.getByLabelText("depth")).toHaveAttribute("type", "number");
    expect(view.getByLabelText("enabled")).toHaveAttribute("type", "checkbox");
    expect(view.getByLabelText("title")).toHaveAttribute("type", "text");
    expect(view.getAllByLabelText(/origin component/)).toHaveLength(3);
    expect(view.getByLabelText("style")).toHaveRole("combobox");
    expect(view.queryByText("$fn")).not.toBeInTheDocument();
  });

  it("routes value, reset, write, and parameter-set actions without editing source itself", () => {
    const parameterState = reduceParameterState(
      createParameterState([{ documentId: "doc-a", revision: 0, source }]),
      { kind: "set-value", documentId: "doc-a", name: "width", value: 70 },
    );
    const state = parameterDocument(parameterState, "doc-a");
    const onAction = vi.fn();
    const onWrite = vi.fn();
    const view = render(
      <ParameterPanel documentId="doc-a" state={state} onAction={onAction} onWrite={onWrite} />,
    );

    fireEvent.change(view.getByLabelText("Overall width"), { target: { value: "85" } });
    expect(onAction).toHaveBeenCalledWith({
      kind: "set-value",
      documentId: "doc-a",
      name: "width",
      value: 85,
    });
    fireEvent.click(view.getByRole("button", { name: "Reset width" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "reset-value", documentId: "doc-a", name: "width" });
    fireEvent.click(view.getByRole("button", { name: "Reset all parameters" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "reset-all", documentId: "doc-a" });
    fireEvent.click(view.getByRole("button", { name: "Write values into source" }));
    expect(onWrite).toHaveBeenCalledOnce();

    fireEvent.change(view.getByLabelText("Parameter set name"), { target: { value: "Wide" } });
    fireEvent.click(view.getByRole("button", { name: "Save parameter set" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "save-set", documentId: "doc-a", name: "Wide" });
  });

  it("exports exact stock JSON bytes through the artifact destination", async () => {
    const state = stateWithSavedSet();
    const save = vi.fn().mockResolvedValue({ location: "C:/models/doc-a.json" });
    const artifactDestination: ArtifactDestination = { available: true, save };
    const view = render(
      <ParameterPanel
        artifactDestination={artifactDestination}
        documentId="doc-a"
        state={state}
        onAction={vi.fn()}
        onWrite={vi.fn()}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Export parameter sets JSON" }));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const request = save.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      suggestedName: "doc-a.json",
      mimeType: "application/json",
    });
    expect(new TextDecoder().decode(request.bytes)).toBe(encodeParameterSets(state.sets));
    expect(view.getByRole("status", { name: "Parameter set file status" })).toHaveTextContent(
      "C:/models/doc-a.json",
    );
  });

  it("imports stock JSON by replacing saved sets without changing source", async () => {
    const state = parameterDocument(
      createParameterState([{ documentId: "doc-a", revision: 0, source }]),
      "doc-a",
    );
    const onAction = vi.fn();
    const stockJson = JSON.stringify({
      parameterSets: { Stock: { width: "75", enabled: "false", unknown: "ignored" } },
      fileFormatVersion: "1",
    });
    const view = render(
      <ParameterPanel
        documentId="doc-a"
        state={state}
        onAction={onAction}
        onWrite={vi.fn()}
      />,
    );

    fireEvent.change(view.getByLabelText("Import parameter sets JSON"), {
      target: { files: [parameterFile(stockJson)] },
    });

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({
      kind: "replace-sets",
      documentId: "doc-a",
      sets: [{ name: "Stock", values: { width: 75, enabled: false } }],
    }));
    expect(view.getByRole("status", { name: "Parameter set file status" })).toHaveTextContent(
      "Imported 1 parameter set.",
    );
  });

  it("rejects oversized and malformed imports without reading or replacing sets", async () => {
    const state = parameterDocument(
      createParameterState([{ documentId: "doc-a", revision: 0, source }]),
      "doc-a",
    );
    const onAction = vi.fn();
    const oversized = parameterFile("{}", 1_048_577);
    const view = render(
      <ParameterPanel
        documentId="doc-a"
        state={state}
        onAction={onAction}
        onWrite={vi.fn()}
      />,
    );
    const input = view.getByLabelText("Import parameter sets JSON");

    fireEvent.change(input, { target: { files: [oversized] } });
    expect(oversized.text).not.toHaveBeenCalled();
    expect(view.getByRole("alert")).toHaveTextContent("1 MiB");
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { files: [parameterFile("not JSON")] } });
    await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent(
      "The parameter-set file was rejected",
    ));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("surfaces export failures and disables export when saving is unavailable", async () => {
    const state = stateWithSavedSet();
    const view = render(
      <ParameterPanel
        artifactDestination={{
          available: true,
          save: vi.fn().mockRejectedValue(new Error("disk full")),
        }}
        documentId="doc-a"
        state={state}
        onAction={vi.fn()}
        onWrite={vi.fn()}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Export parameter sets JSON" }));
    await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent(
      "Parameter sets could not be exported.",
    ));

    view.rerender(
      <ParameterPanel
        artifactDestination={{ available: false, save: vi.fn() }}
        documentId="doc-a"
        state={state}
        onAction={vi.fn()}
        onWrite={vi.fn()}
      />,
    );
    expect(view.getByRole("button", { name: "Export parameter sets JSON" })).toBeDisabled();
  });
});
