// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineVersionManagerPort } from "../../../src/application/engine/engine-version-manager";
import { EnginePinMismatchBanner } from "../../../src/ui/engine/EnginePinMismatchBanner";

describe("EnginePinMismatchBanner", () => {
  it("offers a settings fix when the project pin is not installed", async () => {
    const manager: EngineVersionManagerPort = {
      listInstalled: vi.fn(async () => [{
        version: "Y", executablePath: "C:/Y/openscad.exe",
        sha256: "B".repeat(64), source: "managed" as const,
      }]),
      listOfficial: vi.fn(async () => []),
      installOfficial: vi.fn(),
    };
    const onFix = vi.fn();
    const view = render(<EnginePinMismatchBanner manager={manager} projectPin="X" onFix={onFix} />);

    expect(await view.findByText(/requires openscad x/i)).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: /fix engine version/i }));
    expect(onFix).toHaveBeenCalledOnce();
  });

  it("stays absent when the pinned version is installed", async () => {
    const listInstalled = vi.fn(async () => [{
        version: "X", executablePath: "C:/X/openscad.exe",
        sha256: "A".repeat(64), source: "managed" as const,
      }]);
    const manager: EngineVersionManagerPort = {
      listInstalled,
      listOfficial: vi.fn(async () => []),
      installOfficial: vi.fn(),
    };
    const view = render(<EnginePinMismatchBanner manager={manager} projectPin="X" onFix={vi.fn()} />);
    await waitFor(() => expect(listInstalled).toHaveBeenCalledOnce());
    expect(view.queryByRole("alert")).toBeNull();
  });
});
