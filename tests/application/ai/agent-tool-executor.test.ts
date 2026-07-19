import { describe, expect, it, vi } from "vitest";

import { createAgentToolExecutor } from "../../../src/application/ai/agent-tool-executor";

describe("AI agent tool executor", () => {
  it("allows only FR-10.5 verbs and validates through the MCP schemas", async () => {
    const call = vi.fn(async () => ({ content: "cube(1);" }));
    const executor = createAgentToolExecutor({ call });
    await expect(executor.call(
      { name: "read_file", arguments: { path: "../secret.scad" } },
      new AbortController().signal,
    )).rejects.toThrow("project-relative");
    await expect(executor.call(
      { name: "export_model", arguments: { path: "main.scad", format: "stl-binary" } },
      new AbortController().signal,
    )).rejects.toThrow("not available in AI agent mode");
    expect(call).not.toHaveBeenCalled();
  });

  it("leaves mutations pending by default and auto-applies only an issued review", async () => {
    const handler = { call: vi.fn(async () => ({ status: "pending_review", commandId: "review-1" })) };
    const approvePending = vi.fn(async () => undefined);
    const reviewExecutor = createAgentToolExecutor(handler, { approvePending });
    await expect(reviewExecutor.call(
      { name: "write_file", arguments: { path: "main.scad", content: "cube(2);" } },
      new AbortController().signal,
    )).resolves.toEqual({ status: "pending_review", commandId: "review-1" });
    expect(approvePending).not.toHaveBeenCalled();

    const autoExecutor = createAgentToolExecutor(handler, { autoApply: true, approvePending });
    await expect(autoExecutor.call(
      { name: "write_file", arguments: { path: "main.scad", content: "cube(3);" } },
      new AbortController().signal,
    )).resolves.toEqual({ status: "applied", commandId: "review-1" });
    expect(approvePending).toHaveBeenCalledWith("review-1");
  });

  it("fails closed on cancellation before tool execution", async () => {
    const call = vi.fn(async () => ({ ok: true }));
    const controller = new AbortController();
    controller.abort();
    await expect(createAgentToolExecutor({ call }).call(
      { name: "get_diagnostics", arguments: {} },
      controller.signal,
    )).rejects.toThrow("cancelled");
    expect(call).not.toHaveBeenCalled();
  });

  it("does not auto-apply a tool result that completes after cancellation", async () => {
    let resolve: ((value: unknown) => void) | undefined;
    const handler = { call: vi.fn(() => new Promise<unknown>((done) => { resolve = done; })) };
    const approvePending = vi.fn(async () => undefined);
    const controller = new AbortController();
    const pending = createAgentToolExecutor(handler, { autoApply: true, approvePending }).call(
      { name: "write_file", arguments: { path: "main.scad", content: "cube(4);" } },
      controller.signal,
    );
    controller.abort();
    resolve?.({ status: "pending_review", commandId: "late" });
    await expect(pending).rejects.toThrow("cancelled");
    expect(approvePending).not.toHaveBeenCalled();
  });
});
