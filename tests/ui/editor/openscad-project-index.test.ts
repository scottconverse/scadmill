import { describe, expect, it, vi } from "vitest";

import {
  indexOpenScadCurrentFileInWorker,
} from "../../../src/ui/editor/openscad-current-file-index";
import {
  indexOpenScadProject,
  MAX_PROJECT_INDEX_TOTAL_CODE_UNITS,
  OpenScadProjectIndexCache,
  type ProjectFileEvent,
  ProjectIndexWorkerRequestRegistry,
  resolveProjectReferencePath,
} from "../../../src/ui/editor/openscad-project-index";

describe("OpenSCAD project indexing budgets", () => {
  it("worker-indexes typed current-file symbols and root references structurally", () => {
    const source = [
      "include <lib.scad>",
      "module first() {}",
      "module target(size = 2) {}",
      "module malformed(size = 3",
    ].join("\n");

    const result = indexOpenScadCurrentFileInWorker(
      source,
      "main.scad",
      "tar",
      () => false,
    );

    expect(result.references).toEqual([{ kind: "include", path: "lib.scad" }]);
    expect(result.symbols).toEqual([expect.objectContaining({
      detail: "target(size = 2)",
      label: "target",
    })]);
  });

  it("does not spend the reference budget on non-exported child uses", async () => {
    const emptyReferences: ProjectFileEvent[] = Array.from(
      { length: 511 },
      (_, index) => ({
        kind: "reference",
        reference: { kind: "include", path: `empty-${index}.scad` },
      }),
    );
    const symbols = await indexOpenScadProject({
      documentPath: "main.scad",
      references: [{ kind: "use", path: "a.scad" }],
      readSource: () => Promise.resolve(""),
      parseFile: async (_source, path) => path === "a.scad"
        ? [
            ...emptyReferences,
            { kind: "reference", reference: { kind: "use", path: "hidden.scad" } },
            {
              kind: "symbol",
              symbol: {
                label: "from_a",
                symbolKind: "module",
                detail: "from_a()",
                projectPath: "a.scad",
              },
            },
          ]
        : path === "hidden.scad"
          ? [{
              kind: "symbol",
              symbol: {
                label: "hidden",
                symbolKind: "module",
                detail: "hidden()",
                projectPath: "hidden.scad",
              },
            }]
          : [],
      cache: new OpenScadProjectIndexCache(),
      isCancelled: () => false,
    });

    expect(symbols.map(({ label }) => label)).toContain("from_a");
    expect(symbols.map(({ label }) => label)).not.toContain("hidden");
  });

  it("normalizes safe declaring-file references and rejects non-portable or escaping paths", () => {
    expect(resolveProjectReferencePath("models/main.scad", "parts/root.scad"))
      .toBe("models/parts/root.scad");
    expect(resolveProjectReferencePath("models/parts/root.scad", "./sibling.scad"))
      .toBe("models/parts/sibling.scad");
    expect(resolveProjectReferencePath("models/parts/root.scad", "../common.scad"))
      .toBe("models/common.scad");

    for (const reference of [
      "../../../outside.scad",
      "/absolute.scad",
      "\\absolute.scad",
      "child\\file.scad",
      "bad\0file.scad",
      "NUL.scad",
      "bad./file.scad",
      "child//file.scad",
    ]) {
      expect(() => resolveProjectReferencePath("models/parts/root.scad", reference)).toThrow();
    }
  });

  it("retains cancellation only while its worker request is active", () => {
    const requests = new ProjectIndexWorkerRequestRegistry();

    requests.start(1);
    requests.cancel(1);
    expect(requests.isCancelled(1)).toBe(true);
    expect(requests.retainedRequestCount).toBe(1);

    requests.finish(1);
    requests.cancel(1);
    expect(requests.isCancelled(1)).toBe(false);
    expect(requests.retainedRequestCount).toBe(0);
  });

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
