import type { WorkspaceLayoutState } from "../layout/workspace-layout";

export function sameLayout(left: WorkspaceLayoutState, right: WorkspaceLayoutState): boolean {
  return (Object.keys(left) as (keyof WorkspaceLayoutState)[]).every(
    (key) => left[key] === right[key],
  );
}
