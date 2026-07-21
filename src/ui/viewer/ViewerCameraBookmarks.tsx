import type { CameraBookmark } from "../../application/viewer/camera-bookmarks";
import type { ViewerCameraState } from "../../application/viewer/viewer-state";
import { CameraBookmarks } from "./CameraBookmarks";

export interface ViewerCameraBookmarksProps {
  readonly bookmarks: readonly CameraBookmark[];
  readonly camera: ViewerCameraState;
  readonly onDelete: (bookmarkId: string) => void;
  readonly onSave: (name: string, camera: ViewerCameraState) => void;
  readonly onRecall: (camera: ViewerCameraState) => void;
}

export function ViewerCameraBookmarks(props: ViewerCameraBookmarksProps) {
  return <CameraBookmarks bookmarks={props.bookmarks} camera={props.camera} onDelete={props.onDelete} onRecall={props.onRecall} onSave={props.onSave} />;
}
