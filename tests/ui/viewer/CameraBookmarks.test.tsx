// @vitest-environment happy-dom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDefaultViewerCamera } from "../../../src/application/viewer/viewer-state";
import { CameraBookmarks } from "../../../src/ui/viewer/CameraBookmarks";

describe("CameraBookmarks", () => {
  it("saves a named camera and recalls or deletes an existing bookmark", () => {
    const camera = createDefaultViewerCamera();
    const onSave = vi.fn();
    const onRecall = vi.fn();
    const onDelete = vi.fn();
    const bookmark = { id: "front", name: "Front detail", camera };
    const view = render(
      <CameraBookmarks
        bookmarks={[bookmark]}
        camera={camera}
        onDelete={onDelete}
        onRecall={onRecall}
        onSave={onSave}
      />,
    );

    fireEvent.change(view.getByRole("textbox", { name: "Camera bookmark name" }), {
      target: { value: "Assembly view" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save camera bookmark" }));
    expect(onSave).toHaveBeenCalledWith("Assembly view", camera);

    fireEvent.click(view.getByRole("button", { name: "Recall Front detail" }));
    expect(onRecall).toHaveBeenCalledWith(camera);
    fireEvent.click(view.getByRole("button", { name: "Delete Front detail" }));
    expect(onDelete).toHaveBeenCalledWith("front");
  });
});
