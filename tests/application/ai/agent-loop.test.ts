import { describe, expect, it, vi } from "vitest";

import { runAgentLoop } from "../../../src/application/ai/agent-loop";

describe("agent loop", () => {
  it("runs a scripted tool round and returns the tool result to the model", async () => {
    const calls: string[] = [];
    const model = vi.fn()
      .mockResolvedValueOnce({ toolCall: { name: "render_preview", arguments: { path: "main.scad" } } })
      .mockResolvedValueOnce({ text: "The render is healthy." });
    const result = await runAgentLoop(
      [{ role: "user", content: "check this model" }],
      async (messages) => { calls.push(messages.at(-1)?.content ?? ""); return model(messages, new AbortController().signal); },
      { call: async (tool) => ({ kind: "3d", diagnostics: [], tool: tool.name }) },
      new AbortController().signal,
      { enabled: true, maxRounds: 3 },
    );
    expect(result.state.status).toBe("completed");
    expect(result.state.rounds).toBe(1);
    expect(result.toolResults).toEqual([{ kind: "3d", diagnostics: [], tool: "render_preview" }]);
    expect(calls[1]).toContain('"kind":"3d"');
    expect(result.messages.slice(-2)).toEqual([
      { role: "tool", content: '{"kind":"3d","diagnostics":[],"tool":"render_preview"}', toolName: "render_preview" },
      { role: "assistant", content: "The render is healthy." },
    ]);
  });

  it("caps a deliberately looping model without making an extra tool call", async () => {
    const call = vi.fn(async () => ({ ok: true }));
    const result = await runAgentLoop(
      [{ role: "user", content: "loop" }],
      async () => ({ toolCall: { name: "get_diagnostics", arguments: {} } }),
      { call },
      new AbortController().signal,
      { enabled: true, maxRounds: 2 },
    );
    expect(result.state).toMatchObject({ status: "capped", rounds: 2, maxRounds: 2 });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("does not invoke a model or tool unless agent mode is explicitly enabled", async () => {
    const model = vi.fn(async () => ({ toolCall: { name: "read_file", arguments: { path: "main.scad" } } }));
    const call = vi.fn(async () => ({ content: "cube(1);" }));
    const result = await runAgentLoop(
      [{ role: "user", content: "inspect" }],
      model,
      { call },
      new AbortController().signal,
    );
    expect(result.state).toMatchObject({ enabled: false, status: "idle", rounds: 0 });
    expect(model).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });
});
