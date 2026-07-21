// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SecretStore } from "../../../src/application/settings/secret-store";
import { AiProviderConfigurations } from "../../../src/ui/settings/AiProviderConfigurations";

describe("AiProviderConfigurations", () => {
  it("edits a stable provider/model pair and scopes its key outside settings", async () => {
    const load = vi.fn().mockResolvedValue("profile-key");
    const save = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    const secretStore = { persistence: "web-session", load, save, clear } as SecretStore;
    const onChange = vi.fn();
    const configurations = [{ id: "reviewer", label: "Review model", provider: "anthropic" as const, endpoint: "https://example.test/messages", model: "claude-review" }];
    const view = render(<AiProviderConfigurations configurations={configurations} onChange={onChange} persistWebSecret={false} secretStore={secretStore} />);
    await waitFor(() => expect(load).toHaveBeenCalledWith(false, "reviewer"));
    const key = view.getByDisplayValue("profile-key");
    expect(key).toHaveAttribute("type", "password");
    fireEvent.change(view.getByLabelText("Configuration name"), { target: { value: "Deep review" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...configurations[0], label: "Deep review" }]);
    fireEvent.change(key, { target: { value: "replacement-profile-key" } });
    fireEvent.click(view.getByRole("button", { name: "Save AI key" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("replacement-profile-key", false, "reviewer"));
    expect(JSON.stringify(configurations)).not.toContain("profile-key");
  });
});
