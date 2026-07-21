// @vitest-environment happy-dom
import { act, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { isDocumentDirty } from "../../../src/application/documents/document-workspace";
import type { EngineService } from "../../../src/application/engine/contracts";
import type { ScratchAutosavePersistence } from "../../../src/application/files/scratch-autosave";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { ScratchAutosave } from "../../../src/ui/files/ScratchAutosave";
import { messages } from "../../../src/messages/en";

function engine(): EngineService {
  return { render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn() };
}

it("debounces a dirty scratch buffer with its entry path and reloads it cleanly", async () => {
  let saved: ReturnType<ScratchAutosavePersistence["load"]> = null;
  const persistence: ScratchAutosavePersistence = {
    load: () => saved,
    save: (snapshot) => { saved = snapshot; },
  };
  const runtime = createWorkbenchRuntime(engine(), {
    initialScratchPath: "gear_knob.scad",
    initialScratchSource: "",
  });
  await runtime.dispatch({
    kind: "edit-document",
    origin: "user",
    documentId: "document-main",
    source: "cube(88);",
  });

  render(<ScratchAutosave delayMs={0} persistence={persistence} runtime={runtime} />);

  await waitFor(() => expect(saved).toEqual({
    path: "gear_knob.scad",
    source: "cube(88);",
  }));
  await waitFor(() => expect(isDocumentDirty(runtime.documents.getState().documents[0])).toBe(false));
  const restored = persistence.load();
  const restarted = createWorkbenchRuntime(engine(), {
    initialScratchPath: restored?.path,
    initialScratchSource: restored?.source,
  });
  expect(restarted.documents.getState().documents[0]).toMatchObject({
    path: "gear_knob.scad",
    source: "cube(88);",
    savedSource: "cube(88);",
  });
});

it("keeps an additional scratch tab dirty instead of overwriting the durable scratch slot", async () => {
  const persistence: ScratchAutosavePersistence = {
    load: () => ({ path: "Untitled", source: "cube(10);" }),
    save: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine(), {
    initialScratchPath: "Untitled",
    initialScratchSource: "cube(10);",
  });
  await runtime.dispatch({ kind: "new-scratch-document", origin: "user" });
  const additional = runtime.documents.getState().activeDocumentId;
  await runtime.dispatch({
    kind: "edit-document",
    origin: "user",
    documentId: additional,
    source: "sphere(6);",
  });

  const view = render(
    <ScratchAutosave delayMs={0} persistence={persistence} runtime={runtime} />,
  );

  expect(await view.findByRole("alert")).toHaveTextContent(messages.additionalScratchNotPersisted);
  expect(persistence.save).not.toHaveBeenCalled();
  expect(runtime.documents.getState().documents.find(
    ({ id }) => id === additional,
  )).toMatchObject({ source: "sphere(6);", savedSource: "" });

  await act(async () => runtime.dispatch({
    kind: "activate-document",
    origin: "user",
    documentId: "document-main",
  }));
  await waitFor(() => expect(view.queryByRole("alert")).not.toBeInTheDocument());
});

it("persists a clean welcome sample when its primary scratch identity changes", async () => {
  const persistence: ScratchAutosavePersistence = {
    load: () => ({ path: "Untitled", source: "" }),
    save: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine(), {
    initialScratchPath: "Untitled",
    initialScratchSource: "",
  });
  render(<ScratchAutosave delayMs={60_000} persistence={persistence} runtime={runtime} />);

  await act(async () => runtime.dispatch({
    kind: "open-welcome-sample-confirmed",
    origin: "user",
    documentId: "document-main",
    path: "gear_knob.scad",
    source: "knob_diameter = 34; cylinder(d = knob_diameter, h = 14);",
  }));

  await waitFor(() => expect(persistence.save).toHaveBeenCalledWith({
    path: "gear_knob.scad",
    source: "knob_diameter = 34; cylinder(d = knob_diameter, h = 14);",
  }));
});
