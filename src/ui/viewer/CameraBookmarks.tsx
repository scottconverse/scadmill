import { useState } from "react";

import type { CameraBookmark } from "../../application/viewer/camera-bookmarks";
import type { ViewerCameraState } from "../../application/viewer/viewer-state";
import { messages } from "../../messages/en";

export interface CameraBookmarksProps {
  readonly bookmarks: readonly CameraBookmark[];
  readonly camera: ViewerCameraState;
  readonly onSave: (name: string, camera: ViewerCameraState) => void;
  readonly onRecall: (camera: ViewerCameraState) => void;
  readonly onDelete: (bookmarkId: string) => void;
}

export function CameraBookmarks({
  bookmarks,
  camera,
  onSave,
  onRecall,
  onDelete,
}: CameraBookmarksProps) {
  const [name, setName] = useState("");
  const save = () => {
    const normalized = name.trim();
    if (!normalized) return;
    onSave(normalized, camera);
    setName("");
  };
  return (
    <section aria-label={messages.cameraBookmarks} className="camera-bookmarks">
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label>
          <span>{messages.cameraBookmarkName}</span>
          <input
            aria-label={messages.cameraBookmarkName}
            maxLength={80}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder={messages.cameraBookmarkPlaceholder}
            value={name}
          />
        </label>
        <button aria-label={messages.saveCameraBookmark} disabled={!name.trim()} type="submit">
          {messages.saveCameraBookmarkShort}
        </button>
      </form>
      {bookmarks.length > 0 && (
        <ol>
          {bookmarks.map((bookmark) => (
            <li key={bookmark.id}>
              <button aria-label={messages.recallCameraBookmark(bookmark.name)} onClick={() => onRecall(bookmark.camera)} type="button">
                {bookmark.name}
              </button>
              <button aria-label={messages.deleteCameraBookmark(bookmark.name)} onClick={() => onDelete(bookmark.id)} type="button">
                {messages.deleteCameraBookmarkShort}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
