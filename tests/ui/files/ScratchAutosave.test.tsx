// @vitest-environment happy-dom
import { render, waitFor } from "@testing-library/react";
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

it("debounces a dirty scratch buffer into durable autosave and reloads it cleanly", async () => {
  let saved: string | null = null;
  const persistence: ScratchAutosavePersistence = {
    load: () => saved,
    save: (source) => { saved = source; },
  };
  const runtime = createWorkbenchRuntime(engine());
  await runtime.dispatch({
    kind: "edit-document",
    origin: "user",
    documentId: "document-main",
    source: "cube(88);",
  });

  render(<ScratchAutosave delayMs={0} persistence={persistence} runtime={runtime} />);

  await waitFor(() => expect(saved).toBe("cube(88);"));
  await waitFor(() => expect(isDocumentDirty(runtime.documents.getState().documents[0])).toBe(false));
  const restarted = createWorkbenchRuntime(engine(), {
    initialScratchSource: persistence.load() ?? undefined,
  });
  expect(restarted.documents.getState().documents[0]).toMatchObject({
    source: "cube(88);",
    savedSource: "cube(88);",
  });
});

it("keeps an additional scratch tab dirty instead of overwriting the durable scratch slot", async () => {
  const persistence: ScratchAutosavePersistence = {
    load: () => "cube(10);",
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
});
