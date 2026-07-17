export interface AiContextInputs {
  readonly source: string;
  readonly diagnostics: readonly string[];
  readonly parameters: readonly string[];
  readonly screenshotDataUrl?: string;
}

export interface AiContextToggles {
  readonly source: boolean;
  readonly diagnostics: boolean;
  readonly parameters: boolean;
  readonly screenshot: boolean;
}

export const DEFAULT_AI_CONTEXT_TOGGLES: AiContextToggles = Object.freeze({
  source: true,
  diagnostics: true,
  parameters: true,
  screenshot: false,
});

const MAX_SOURCE = 128_000;
const MAX_LIST_ITEM = 4_000;
const MAX_SCREENSHOT = 2_000_000;

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n[truncated]`;
}

export function buildAiContextMessage(inputs: AiContextInputs, toggles: AiContextToggles): string {
  const sections: string[] = [];
  if (toggles.source) sections.push(`<current-file>\n${bounded(inputs.source, MAX_SOURCE)}\n</current-file>`);
  if (toggles.diagnostics && inputs.diagnostics.length > 0) sections.push(`<diagnostics>\n${inputs.diagnostics.map((item) => bounded(item, MAX_LIST_ITEM)).join("\n")}\n</diagnostics>`);
  if (toggles.parameters && inputs.parameters.length > 0) sections.push(`<parameters>\n${inputs.parameters.map((item) => bounded(item, MAX_LIST_ITEM)).join("\n")}\n</parameters>`);
  if (toggles.screenshot && inputs.screenshotDataUrl) sections.push(`<viewer-screenshot>\n${bounded(inputs.screenshotDataUrl, MAX_SCREENSHOT)}\n</viewer-screenshot>`);
  return sections.join("\n\n");
}
