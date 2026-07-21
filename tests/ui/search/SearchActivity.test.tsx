// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchActivity } from "../../../src/ui/search/SearchActivity";

describe("SearchActivity", () => {
  it("searches project files, navigates results, and requires a replacement preview", async () => {
    const files = new Map([
      ["main.scad", "cube(1);\ncube(2);"],
      ["ignored.scad", "cube(3);"],
      [".scadmillignore", "ignored.scad"],
    ]);
    const onNavigate = vi.fn(() => Promise.resolve());
    const onApplyReplacements = vi.fn(() => Promise.resolve());
    render(
      <SearchActivity
        activePath="main.scad"
        loadSources={() => Promise.resolve(files)}
        onApplyReplacements={onApplyReplacements}
        onFindReferences={vi.fn()}
        onNavigate={onNavigate}
        outline={[]}
        references={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search project"), { target: { value: "cube" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await screen.findByText("2 matches in 2 files");
    fireEvent.click(screen.getByRole("button", { name: /main\.scad:1:1/u }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ path: "main.scad", line: 1 }));

    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "sphere" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview replace" }));
    expect(onApplyReplacements).not.toHaveBeenCalled();
    const confirmation = await screen.findByRole("button", { name: "Replace 2 matches" });
    fireEvent.click(confirmation);
    await waitFor(() => expect(onApplyReplacements).toHaveBeenCalledWith(
      expect.objectContaining({ matchCount: 2 }),
      files,
    ));
  });

  it("shows current-file symbols and reference navigation", () => {
    const onFindReferences = vi.fn();
    const onNavigate = vi.fn(() => Promise.resolve());
    render(
      <SearchActivity
        activePath="parts.scad"
        loadSources={() => Promise.resolve(new Map())}
        onApplyReplacements={() => Promise.resolve()}
        onFindReferences={onFindReferences}
        onNavigate={onNavigate}
        outline={[{ path: "parts.scad", from: 7, to: 14, line: 1, column: 8, label: "bracket", symbolKind: "module", detail: "bracket()" }]}
        references={[{ path: "main.scad", from: 0, to: 7, line: 1, column: 1, label: "bracket", symbolKind: "module" }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Find references to bracket" }));
    expect(onFindReferences).toHaveBeenCalledWith("parts.scad", 7);
    fireEvent.click(screen.getByRole("button", { name: "main.scad:1:1" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ path: "main.scad" }));
  });
});
