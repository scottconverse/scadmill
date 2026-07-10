// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App";
import type { EngineService, RenderFailure } from "../../src/application/engine/contracts";
import { messages } from "../../src/messages/en";

describe("App", () => {
  it("probes and starts the native engine exactly once under StrictMode", async () => {
    const result: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [],
      rawLog: "test result",
    };
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({ jobId: "render-1", done: Promise.resolve(result) }),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue({ version: "2021.01", path: "native", features: [] }),
      cancel: vi.fn(),
    };

    render(
      <StrictMode>
        <App engine={engine} />
      </StrictMode>,
    );

    expect(screen.getByText("Checking OpenSCAD…")).toBeVisible();
    await waitFor(() => expect(engine.render).toHaveBeenCalledTimes(1));
    expect(engine.version).toHaveBeenCalledTimes(1);
  });

  it("falls back to editor-only mode when the engine version probe rejects", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockRejectedValue(new Error("OpenSCAD executable not found")),
      cancel: vi.fn(),
    };

    const view = render(
      <StrictMode>
        <App engine={engine} />
      </StrictMode>,
    );
    const app = within(view.container);

    await waitFor(() => expect(app.queryByText("Checking OpenSCAD…")).not.toBeInTheDocument());
    expect(app.getAllByText(messages.engineUnavailable)).toHaveLength(2);
    expect(app.getByRole("button", { name: messages.renderPreview })).toBeDisabled();
    expect(engine.version).toHaveBeenCalledTimes(1);
    expect(engine.render).not.toHaveBeenCalled();
  });
});
