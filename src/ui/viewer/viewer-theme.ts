import { type BufferGeometry, Color, type Mesh, type MeshStandardMaterial, type Scene } from "three";

import type { ThemeTokens } from "../../application/theme/theme-schema";

export type ViewerThemeColors = Pick<ThemeTokens["viewer"], "background" | "mesh">;

export interface ViewerThemeTarget {
  readonly scene: Scene;
  readonly mesh?: Mesh<BufferGeometry, MeshStandardMaterial>;
}

export function applyViewerTheme(target: ViewerThemeTarget, colors: ViewerThemeColors): void {
  if (target.scene.background instanceof Color) {
    target.scene.background.set(colors.background);
  } else {
    target.scene.background = new Color(colors.background);
  }
  target.mesh?.material.color.set(colors.mesh);
}
