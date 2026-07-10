// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRenderKeybindings } from "../../../src/ui/render/use-render-keybindings";
import { createKeybindingSettings } from "../../../src/application/commands/default-keybindings";

const keybindings = createKeybindingSettings();

describe("useRenderKeybindings", () => {
  it("maps F5 to preview and F6 to full while ignoring repeats and disabled state", () => {
    const onPreview = vi.fn();
    const onFull = vi.fn();
    const onCancel = vi.fn();
    const view = renderHook(
      ({ disabled, rendering }) => useRenderKeybindings({
        disabled,
        rendering,
        keybindings,
        onPreview,
        onFull,
        onCancel,
      }),
      { initialProps: { disabled: false, rendering: false } },
    );
    const preview = new KeyboardEvent("keydown", { key: "F5", cancelable: true });
    const full = new KeyboardEvent("keydown", { key: "F6", cancelable: true });
    window.dispatchEvent(preview);
    window.dispatchEvent(full);

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onFull).toHaveBeenCalledTimes(1);
    expect(preview.defaultPrevented).toBe(true);
    expect(full.defaultPrevented).toBe(true);

    view.rerender({ disabled: true, rendering: false });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F5", repeat: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F6" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onFull).toHaveBeenCalledTimes(1);
  });

  it("maps Escape to cancel only while rendering with viewer focus", () => {
    const onCancel = vi.fn();
    const viewer = document.createElement("section");
    viewer.className = "viewer-panel";
    const control = document.createElement("button");
    viewer.append(control);
    document.body.append(viewer);
    control.focus();
    const view = renderHook(
      ({ rendering }) => useRenderKeybindings({
        disabled: rendering,
        rendering,
        keybindings,
        onPreview: vi.fn(),
        onFull: vi.fn(),
        onCancel,
      }),
      { initialProps: { rendering: true } },
    );

    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    control.dispatchEvent(escapeEvent);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(escapeEvent.defaultPrevented).toBe(true);

    view.rerender({ rendering: false });
    control.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    viewer.remove();
  });

  it("uses injected runtime bindings instead of the defaults", () => {
    const onPreview = vi.fn();
    renderHook(() => useRenderKeybindings({
      disabled: false,
      rendering: false,
      keybindings: createKeybindingSettings({ renderPreview: "Alt+R" }),
      onPreview,
      onFull: vi.fn(),
      onCancel: vi.fn(),
    }));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F5" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", altKey: true }));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch a global render command after a focused surface handles the key", () => {
    const onPreview = vi.fn();
    renderHook(() => useRenderKeybindings({
      disabled: false,
      rendering: false,
      keybindings,
      onPreview,
      onFull: vi.fn(),
      onCancel: vi.fn(),
    }));
    const handled = new KeyboardEvent("keydown", { key: "F5", cancelable: true });
    handled.preventDefault();

    window.dispatchEvent(handled);

    expect(onPreview).not.toHaveBeenCalled();
  });

  it("falls through to preview when its shared viewer-cancel binding is inactive", () => {
    const onPreview = vi.fn();
    const onCancel = vi.fn();
    const overlapping = createKeybindingSettings({ cancelRender: "F5" });
    const view = renderHook(
      ({ rendering }) => useRenderKeybindings({
        disabled: rendering,
        rendering,
        keybindings: overlapping,
        onPreview,
        onFull: vi.fn(),
        onCancel,
      }),
      { initialProps: { rendering: false } },
    );

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "F5",
      cancelable: true,
    }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    const viewer = document.createElement("section");
    viewer.className = "viewer-panel";
    const control = document.createElement("button");
    viewer.append(control);
    document.body.append(viewer);
    view.rerender({ rendering: true });
    control.dispatchEvent(new KeyboardEvent("keydown", {
      key: "F5",
      bubbles: true,
      cancelable: true,
    }));

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    viewer.remove();
  });
});
