// @vitest-environment happy-dom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProjectPortabilityController } from "../../../src/application/files/project-portability";
import { ShareLinkCopyError } from "../../../src/application/files/project-portability";
import { messages } from "../../../src/messages/en";
import { ProjectPortabilityPanel } from "../../../src/ui/files/ProjectPortabilityPanel";

function controller(
  overrides: Partial<ProjectPortabilityController> = {},
): ProjectPortabilityController {
  return {
    artifactSavingAvailable: true,
    copyShareLink: async () => "https://studio.example/#scadmill-share=v1.payload",
    exportProjectZip: async () => ({ location: "project.zip" }),
    importProjectZip: async () => ({ displayName: "project" }),
    openStartupShare: async () => null,
    ...overrides,
  };
}

describe("ProjectPortabilityPanel", () => {
  it("creates and copies a share link with visible success feedback", async () => {
    const copyShareLink = vi.fn(async () => "https://studio.example/#scadmill-share=v1.payload");
    const view = render(<ProjectPortabilityPanel controller={controller({ copyShareLink })} />);
    const panel = within(view.container);

    expect(panel.getByText(
      "Share links contain your complete source. Anyone with the link can read it.",
      { exact: true },
    )).toHaveAttribute("role", "note");

    fireEvent.click(panel.getByRole("button", { name: messages.copyShareLink }));

    await waitFor(() => expect(copyShareLink).toHaveBeenCalledOnce());
    expect(panel.getByRole("status")).toHaveTextContent(messages.shareLinkCopied);
    expect(panel.getByRole("textbox", { name: messages.shareLinkValue })).toHaveValue(
      "https://studio.example/#scadmill-share=v1.payload",
    );
  });

  it("shows the generated link for manual copy when clipboard permission is denied", async () => {
    const href = "https://studio.example/#scadmill-share=v1.payload";
    const view = render(<ProjectPortabilityPanel controller={controller({
      copyShareLink: async () => { throw new ShareLinkCopyError(href); },
    })} />);
    const panel = within(view.container);

    fireEvent.click(panel.getByRole("button", { name: messages.copyShareLink }));

    expect(await panel.findByRole("textbox", { name: messages.shareLinkValue })).toHaveValue(href);
    expect(panel.getByRole("alert")).toHaveTextContent(messages.shareLinkCopyManually);
  });

  it("opens a startup share and shows a dismissible origin banner", async () => {
    const view = render(<ProjectPortabilityPanel controller={controller({
      openStartupShare: async () => ({ source: "cube(4);", origin: "maker.example" }),
    })} />);
    const panel = within(view.container);

    expect(await panel.findByText(messages.sharedSourceBanner("maker.example"))).toBeVisible();
    fireEvent.click(panel.getByRole("button", { name: messages.dismissSharedSourceBanner }));
    expect(panel.queryByText(messages.sharedSourceBanner("maker.example"))).not.toBeInTheDocument();
  });

  it("downloads ZIP exports and imports a selected ZIP", async () => {
    const exportProjectZip = vi.fn(async () => ({ location: "assembly.zip" }));
    const importProjectZip = vi.fn(async () => ({ displayName: "assembly" }));
    const view = render(<ProjectPortabilityPanel controller={controller({
      exportProjectZip,
      importProjectZip,
    })} />);
    const panel = within(view.container);

    fireEvent.click(panel.getByRole("button", { name: messages.exportProjectZip }));
    expect(await panel.findByText(messages.projectZipExported("assembly.zip"))).toBeVisible();

    const file = new File([Uint8Array.of(1, 2, 3)], "assembly.zip", {
      type: "application/zip",
    });
    fireEvent.change(panel.getByLabelText(messages.importProjectZip), {
      target: { files: [file] },
    });
    await waitFor(() => expect(importProjectZip).toHaveBeenCalledWith(file));
    expect(panel.getByRole("status")).toHaveTextContent(messages.projectZipImported("assembly"));
  });

  it("surfaces archive size and unsafe-path errors without replacing the current status", async () => {
    const importProjectZip = vi.fn().mockRejectedValue(
      new Error('Invalid project path "../escape.scad": path must be project-relative.'),
    );
    const view = render(<ProjectPortabilityPanel controller={controller({ importProjectZip })} />);
    const panel = within(view.container);
    const file = new File([Uint8Array.of(1)], "unsafe.zip", { type: "application/zip" });

    fireEvent.change(panel.getByLabelText(messages.importProjectZip), {
      target: { files: [file] },
    });

    expect(await panel.findByRole("alert")).toHaveTextContent("../escape.scad");
    expect(panel.getByRole("alert")).toHaveTextContent(messages.projectZipImportFailedPrefix);
  });
});
