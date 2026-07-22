import { type BufferGeometry, Color, type Mesh, type MeshStandardMaterial, type Scene } from "three";

import type { ThemeTokens } from "../../application/theme/theme-schema";

export type ViewerThemeColors = Pick<ThemeTokens["viewer"], "background" | "mesh">
  & Partial<Omit<ThemeTokens["viewer"], "background" | "mesh">>;

export interface ViewerThemeTarget {
  readonly scene: Scene;
  readonly mesh?: Mesh<BufferGeometry, MeshStandardMaterial | MeshStandardMaterial[]>;
}

export function applyViewerTheme(target: ViewerThemeTarget, colors: ViewerThemeColors): void {
  if (target.scene.background instanceof Color) {
    target.scene.background.set(colors.background);
  } else {
    target.scene.background = new Color(colors.background);
  }
  const material = target.mesh?.material;
  if (!material) return;
  for (const item of Array.isArray(material) ? material : [material]) {
    if (item.vertexColors) item.color.setScalar(1);
    else item.color.set(colors.mesh);
  }
}
