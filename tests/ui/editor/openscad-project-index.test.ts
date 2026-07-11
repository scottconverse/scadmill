import { describe, expect, it, vi } from "vitest";

import {
  indexOpenScadProject,
  MAX_PROJECT_INDEX_TOTAL_CODE_UNITS,
  OpenScadProjectIndexCache,
  type ProjectFileEvent,
} from "../../../src/ui/editor/openscad-project-index";

describe("OpenSCAD project indexing budgets", () => {
  it("bounds aggregate source while retaining every symbol within the budget", async () => {
    const fileSize = 1_000_000;
    const fileCount = Math.floor(MAX_PROJECT_INDEX_TOTAL_CODE_UNITS / fileSize) + 1;
    const sources = new Map<string, string>(Array.from(
      { length: fileCount },
      (_, index) => [`file-${index}.scad`, " ".repeat(fileSize)] as const,
    ));
    const parseFile = vi.fn(async (_source: string, path: string) => {
      const index = Number(path.match(/\d+/u)?.[0]);
      const events: ProjectFileEvent[] = [{
        kind: "symbol",
        symbol: {
          label: `symbol_${index}`,
          symbolKind: "module",
          detail: `symbol_${index}()`,
          projectPath: path,
        },
      }];
      if (index + 1 < fileCount) {
        events.push({
          kind: "reference",
          reference: { kind: "include", path: `file-${index + 1}.scad` },
        });
        if (index + 1 === fileCount - 1) {
          events.push({
            kind: "reference",
            reference: { kind: "include", path: `file-${index + 1}.scad` },
          });
        }
      }
      return events;
    });

    const symbols = await indexOpenScadProject({
      documentPath: "main.scad",
      references: [{ kind: "include", path: "file-0.scad" }],
      readSource: (path) => Promise.resolve(sources.get(path)),
      parseFile,
      cache: new OpenScadProjectIndexCache(),
      isCancelled: () => false,
    });

    expect(symbols.map(({ label }) => label)).toContain("symbol_7");
    expect(symbols.map(({ label }) => label)).not.toContain("symbol_8");
    expect(parseFile).toHaveBeenCalledTimes(8);
  });
});
