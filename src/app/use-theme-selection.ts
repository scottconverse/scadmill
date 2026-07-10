import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import {
  applyThemeToRoot,
  createBrowserThemeHost,
  resolveTheme,
  type ThemeHost,
  type ThemePreference,
} from "../application/theme/theme-runtime";

export function useThemeSelection(preference: ThemePreference, injectedHost?: ThemeHost) {
  const host = useMemo(() => injectedHost ?? createBrowserThemeHost(), [injectedHost]);
  const [prefersDark, setPrefersDark] = useState(host.darkMode.matches);
  const theme = resolveTheme(preference, prefersDark);

  useEffect(() => {
    const update = (event: { matches: boolean }) => setPrefersDark(event.matches);
    setPrefersDark(host.darkMode.matches);
    host.darkMode.addEventListener("change", update);
    return () => host.darkMode.removeEventListener("change", update);
  }, [host]);

  useLayoutEffect(() => applyThemeToRoot(theme, host.root), [host.root, theme]);

  return theme;
}
