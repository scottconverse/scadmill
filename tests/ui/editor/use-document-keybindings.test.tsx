// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDocumentWorkspace } from "../../../src/application/documents/document-workspace";
import { useDocumentKeybindings } from "../../../src/ui/editor/use-document-keybindings";

const workspace = createDocumentWorkspace([
  { id: "document-main", path: "main.scad", source: "cube(10);" },
  { id: "document-wheel", path: "parts/wheel.scad", source: "cylinder(4);" },
], "document-main");

describe("useDocumentKeybindings", () => {
  it("routes close, reopen, and next/previous tab defaults", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const onReopen = vi.fn();
    renderHook(() => useDocumentKeybindings({ workspace, onActivate, onClose, onReopen }));

    const next = new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, cancelable: true });
    window.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(true);
    expect(onActivate).toHaveBeenLastCalledWith("document-wheel");

    const previous = new KeyboardEvent("keydown", {
      key: "Tab",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(previous);
    expect(previous.defaultPrevented).toBe(true);
    expect(onActivate).toHaveBeenLastCalledWith("document-wheel");

    const close = new KeyboardEvent("keydown", { key: "w", ctrlKey: true, cancelable: true });
    window.dispatchEvent(close);
    expect(close.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledWith("document-main");

    const reopen = new KeyboardEvent("keydown", {
      key: "t",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(reopen);
    expect(reopen.defaultPrevented).toBe(true);
    expect(onReopen).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated or already-handled key events", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const onReopen = vi.fn();
    renderHook(() => useDocumentKeybindings({ workspace, onActivate, onClose, onReopen }));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    const handled = new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);

    expect(onActivate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onReopen).not.toHaveBeenCalled();
  });
});
