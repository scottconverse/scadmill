import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import {
  applyThemeToRoot,
  createBrowserThemeHost,
  type ThemeHost,
  type ThemePreference,
} from "../application/theme/theme-runtime";
import { createThemeRegistry } from "../application/theme/theme-registry";
import type { ThemeTokens } from "../application/theme/theme-schema";

export function useThemeSelection(
  preference: ThemePreference,
  customThemes: readonly ThemeTokens[],
  injectedHost?: ThemeHost,
) {
  const host = useMemo(() => injectedHost ?? createBrowserThemeHost(), [injectedHost]);
  const [prefersDark, setPrefersDark] = useState(host.darkMode.matches);
  const registry = useMemo(() => createThemeRegistry(customThemes), [customThemes]);
  const theme = registry.resolve(preference, prefersDark);

  useEffect(() => {
    const update = (event: { matches: boolean }) => setPrefersDark(event.matches);
    setPrefersDark(host.darkMode.matches);
    host.darkMode.addEventListener("change", update);
    return () => host.darkMode.removeEventListener("change", update);
  }, [host]);

  useLayoutEffect(() => applyThemeToRoot(theme, host.root), [host.root, theme]);

  return theme;
}
