import { describe, expect, it, vi } from "vitest";

import {
  OpenScadProjectIndexClient,
  type ProjectIndexWorkerLike,
} from "../../../src/ui/editor/openscad-project-index-client";

class ResultWorker implements ProjectIndexWorkerLike {
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: ((event: { readonly message?: string }) => void) | null = null;
  readonly terminate = vi.fn();
  readonly messages: unknown[] = [];

  postMessage(message: unknown): void {
    this.messages.push(message);
    const value = message as Record<string, unknown>;
    if (value.type === "index-project") {
      queueMicrotask(() => this.onmessage?.({ data: {
        type: "read-project-source",
        requestId: value.requestId,
        path: "lib.scad",
      } }));
    } else if (value.type === "project-source") {
      queueMicrotask(() => this.onmessage?.({ data: {
        type: "project-index-result",
        requestId: value.requestId,
        symbols: [{
          label: "part",
          symbolKind: "module",
          detail: "part(size = 3)",
          projectPath: "lib.scad",
        }],
      } }));
    }
  }
}

describe("OpenSCAD project index worker client", () => {
  it("uses the injected worker and reads only the path requested by that worker", async () => {
    const worker = new ResultWorker();
    const factory = vi.fn(() => worker);
    const get = vi.fn((path: string) => path === "lib.scad" ? "module part(size = 3) {}" : undefined);
    const client = new OpenScadProjectIndexClient(factory);

    const symbols = await client.index({
      documentPath: "main.scad",
      references: [{ kind: "include", path: "lib.scad" }],
      sources: { get },
    }, new AbortController().signal);

    expect(factory).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith("lib.scad");
    expect(symbols).toEqual([{
      label: "part",
      symbolKind: "module",
      detail: "part(size = 3)",
      projectPath: "lib.scad",
    }]);
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates and falls back cooperatively when the worker reports an error", async () => {
    const worker = new ResultWorker();
    worker.postMessage = vi.fn((message: unknown) => {
      const value = message as Record<string, unknown>;
      if (value.type === "index-project") {
        queueMicrotask(() => worker.onmessage?.({ data: {
          type: "project-index-error",
          requestId: value.requestId,
        } }));
      }
    });
    const client = new OpenScadProjectIndexClient(() => worker);

    const symbols = await client.index({
      documentPath: "main.scad",
      references: [{ kind: "include", path: "lib.scad" }],
      sources: { get: () => "module recovered() {}" },
    }, new AbortController().signal);

    expect(symbols).toContainEqual(expect.objectContaining({ label: "recovered" }));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("cancels an unfinished request without accepting a late worker result", async () => {
    const worker = new ResultWorker();
    worker.postMessage = vi.fn((message: unknown) => {
      worker.messages.push(message);
    });
    const client = new OpenScadProjectIndexClient(() => worker);
    const controller = new AbortController();
    const pending = client.index({
      documentPath: "main.scad",
      references: [{ kind: "include", path: "lib.scad" }],
      sources: { get: () => "module ignored() {}" },
    }, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.messages).toContainEqual(expect.objectContaining({
      type: "cancel-project-index",
    }));
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("does not clone an over-limit source into the worker", async () => {
    const worker = new ResultWorker();
    const client = new OpenScadProjectIndexClient(() => worker);

    await client.index({
      documentPath: "main.scad",
      references: [{ kind: "include", path: "lib.scad" }],
      sources: { get: () => " ".repeat(2_100_001) },
    }, new AbortController().signal);

    expect(worker.messages).toContainEqual({
      type: "project-source",
      requestId: 1,
      path: "lib.scad",
      source: undefined,
    });
    client.dispose();
  });

  it("falls back every outstanding request when posting a later request fails", async () => {
    const worker = new ResultWorker();
    let indexPosts = 0;
    worker.postMessage = vi.fn((message: unknown) => {
      const value = message as Record<string, unknown>;
      if (value.type !== "index-project") return;
      indexPosts += 1;
      if (indexPosts === 2) throw new Error("post failed");
    });
    const client = new OpenScadProjectIndexClient(() => worker);
    const firstController = new AbortController();
    const first = client.index({
      documentPath: "main.scad",
      references: [{ kind: "include", path: "first.scad" }],
      sources: { get: () => "module first() {}" },
    }, firstController.signal);
    const second = client.index({
      documentPath: "main.scad",
      references: [{ kind: "include", path: "second.scad" }],
      sources: { get: () => "module second() {}" },
    }, new AbortController().signal);

    const firstOutcome = await Promise.race([
      first,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);
    if (firstOutcome === "timeout") firstController.abort();

    expect(firstOutcome).not.toBe("timeout");
    expect(firstOutcome).toContainEqual(expect.objectContaining({ label: "first" }));
    await expect(second).resolves.toContainEqual(expect.objectContaining({ label: "second" }));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
