import { useEffect, type RefObject } from "react";

import type { SettingsSection } from "../../application/settings/settings-schema";

export function numericValue(value: string, minimum: number, maximum: number): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function useInitialSettingsFocus(
  initialSection: SettingsSection | undefined,
  searchInput: RefObject<HTMLInputElement | null>,
): void {
  useEffect(() => {
    const target = initialSection
      ? document.getElementById(`settings-${initialSection}`)?.closest<HTMLElement>(".settings-section")
        ?.querySelector<HTMLElement>("select:not(:disabled), input:not(:disabled), textarea:not(:disabled)")
      : searchInput.current;
    target?.focus();
  }, [initialSection, searchInput]);
}
