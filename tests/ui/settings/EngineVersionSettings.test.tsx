// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineVersionManagerPort } from "../../../src/application/engine/engine-version-manager";
import { EngineVersionSettings } from "../../../src/ui/settings/EngineVersionSettings";

describe("EngineVersionSettings", () => {
  it("lists exact checksums and pins the selected installed version", async () => {
    const manager: EngineVersionManagerPort = {
      listInstalled: vi.fn(async () => [
        { version: "X", executablePath: "C:/X/openscad.exe", sha256: "A".repeat(64), source: "managed" },
        { version: "Y", executablePath: "C:/Y/openscad.exe", sha256: "B".repeat(64), source: "configured" },
      ] as const),
      listOfficial: vi.fn(async () => []),
      installOfficial: vi.fn(),
    };
    const onPin = vi.fn(async () => undefined);
    const view = render(<EngineVersionSettings manager={manager} onPin={onPin} project projectPin="X" />);

    expect(await view.findByText(`A`.repeat(64))).toBeVisible();
    fireEvent.change(view.getByRole("combobox", { name: "Project engine version" }), { target: { value: "Y" } });
    fireEvent.click(view.getByRole("button", { name: "Pin version to project" }));

    await waitFor(() => expect(onPin).toHaveBeenCalledWith("Y"));
  });

  it("requires a project before enabling the pin action", async () => {
    const manager: EngineVersionManagerPort = {
      listInstalled: vi.fn(async () => [
        { version: "X", executablePath: "C:/X/openscad.exe", sha256: "A".repeat(64), source: "managed" },
      ] as const),
      listOfficial: vi.fn(async () => []),
      installOfficial: vi.fn(),
    };
    const view = render(<EngineVersionSettings manager={manager} onPin={vi.fn()} project={false} />);
    await view.findByText(`A`.repeat(64));
    expect(view.getByRole("button", { name: "Pin version to project" })).toBeDisabled();
    expect(view.getByText(/open a project folder/i)).toBeVisible();
  });

  it("shows the official archive checksum and installs only after the user clicks", async () => {
    const listInstalled = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        version: "2026.06.12", executablePath: "C:/managed/openscad.exe",
        sha256: "D".repeat(64), source: "managed",
      }]);
    const installOfficial = vi.fn(async () => ({
      version: "2026.06.12", executablePath: "C:/managed/openscad.exe",
      sha256: "D".repeat(64), source: "managed" as const,
    }));
    const manager: EngineVersionManagerPort = {
      listInstalled,
      listOfficial: vi.fn(async () => [{
        id: "windows-2026.06.12-x86_64", version: "2026.06.12",
        platform: "Windows x86-64", archiveSha256: "A".repeat(64),
      }]),
      installOfficial,
    };
    const onInventoryChanged = vi.fn();
    const view = render(<EngineVersionSettings manager={manager} onPin={vi.fn()} onInventoryChanged={onInventoryChanged} project />);

    expect(await view.findByText("A".repeat(64))).toBeVisible();
    expect(installOfficial).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: /download official openscad 2026\.06\.12/i }));

    await waitFor(() => expect(installOfficial).toHaveBeenCalledWith("windows-2026.06.12-x86_64"));
    expect(await view.findByText("D".repeat(64))).toBeVisible();
    expect(onInventoryChanged).toHaveBeenCalledOnce();
  });
});
