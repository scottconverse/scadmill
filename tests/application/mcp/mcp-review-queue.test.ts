import { describe, expect, it } from "vitest";
import { createMcpReviewQueue } from "../../../src/application/mcp/mcp-review-queue";

const review = (commandId: string) => ({ commandId, tool: "write_file" as const, arguments: { path: "main.scad", content: "cube(2);" }, createdAt: "2026-07-17T00:00:00.000Z" });

describe("MCP review queue", () => {
  it("bounds entries and removes only the approved or denied review", () => {
    const queue = createMcpReviewQueue(2);
    queue.enqueue(review("one"));
    queue.enqueue(review("two"));
    queue.enqueue(review("three"));
    expect(queue.list().map(({ commandId }) => commandId)).toEqual(["two", "three"]);
    expect(queue.approve("two")?.commandId).toBe("two");
    expect(queue.list().map(({ commandId }) => commandId)).toEqual(["three"]);
    expect(queue.deny("missing")).toBeUndefined();
  });

  it("replaces duplicate ids and clears deterministically", () => {
    const queue = createMcpReviewQueue();
    queue.enqueue(review("same"));
    queue.enqueue({ ...review("same"), arguments: { path: "main.scad", content: "cube(3);" } });
    expect(queue.list()).toHaveLength(1);
    expect(queue.list()[0]?.arguments.content).toBe("cube(3);");
    queue.clear();
    expect(queue.list()).toEqual([]);
  });
});
