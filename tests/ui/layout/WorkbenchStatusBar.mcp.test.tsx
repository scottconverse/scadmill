// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { WorkbenchStatusBar } from "../../../src/ui/layout/WorkbenchStatusBar";

describe("Workbench MCP connection status", () => {
  it("announces a persistent external-agent connection status and shows the badge only while connected", () => {
    const base = {
      customThemes: [],
      cursor: { line: 1, column: 1 },
      diagnosticStatus: "No diagnostics yet",
      engineLabel: "OpenSCAD 2026.06.12",
      geometryStatus: null,
      renderStatus: "Ready",
      consoleVisible: false,
      consoleButtonRef: createRef<HTMLButtonElement>(),
      themePreference: "dark" as const,
      onFocusConsole: vi.fn(),
      onThemePreferenceChange: vi.fn(),
    };
    const view = render(<WorkbenchStatusBar {...base} mcpConnected={false} />);
    const status = screen.getByRole("status", { name: "External agent connection status" });
    expect(status).toHaveTextContent("No external agent connected");
    expect(status).toHaveClass("visually-hidden");

    view.rerender(<WorkbenchStatusBar {...base} mcpConnected />);
    expect(status).toHaveTextContent("External agent connected");
    expect(status).toHaveClass("external-agent-badge");
    expect(status).not.toHaveClass("visually-hidden");
  });
});
