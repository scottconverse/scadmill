import { auditThemeContrast } from "./theme-contrast";
import {
  parseThemeJson,
  type ThemeLoadIssue,
  type ThemeLoadResult,
} from "./theme-loader";

const OPAQUE_SRGB_HEX = /^#[0-9a-f]{6}$/iu;

export function parseCustomThemeJson(source: string): ThemeLoadResult {
  const parsed = parseThemeJson(source, (value) => OPAQUE_SRGB_HEX.test(value));
  if (!parsed.ok) return parsed;
  const issues: ThemeLoadIssue[] = auditThemeContrast(parsed.theme).map((failure) => ({
    code: "invalid-contrast",
    path: failure.pair.id,
    message: `${failure.pair.id} has ${failure.ratio.toFixed(2)}:1 contrast; ${failure.pair.minimum}:1 is required.`,
  }));
  return issues.length > 0 ? { ok: false, issues } : parsed;
}
