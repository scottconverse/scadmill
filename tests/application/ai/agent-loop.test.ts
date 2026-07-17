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
      { maxRounds: 3 },
    );
    expect(result.state.status).toBe("completed");
    expect(result.state.rounds).toBe(1);
    expect(result.toolResults).toEqual([{ kind: "3d", diagnostics: [], tool: "render_preview" }]);
    expect(calls[1]).toContain("tool-result");
  });

  it("caps a deliberately looping model without making an extra tool call", async () => {
    const call = vi.fn(async () => ({ ok: true }));
    const result = await runAgentLoop(
      [{ role: "user", content: "loop" }],
      async () => ({ toolCall: { name: "get_diagnostics", arguments: {} } }),
      { call },
      new AbortController().signal,
      { maxRounds: 2 },
    );
    expect(result.state).toMatchObject({ status: "capped", rounds: 2, maxRounds: 2 });
    expect(call).toHaveBeenCalledTimes(2);
  });
});
