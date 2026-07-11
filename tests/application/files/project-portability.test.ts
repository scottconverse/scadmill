import { describe, expect, it, vi } from "vitest";

import type { ArtifactSaveRequest } from "../../../src/application/files/artifact-destination";
import {
  createProjectPortabilityController,
  ShareLinkCopyError,
  type ProjectArchiveFile,
  type ProjectPortabilityPort,
} from "../../../src/application/files/project-portability";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";

function archiveFile(name: string, bytes: Uint8Array): ProjectArchiveFile {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

function port(overrides: Partial<ProjectPortabilityPort> = {}): ProjectPortabilityPort {
  return {
    artifacts: {
      available: true,
      save: async ({ suggestedName }) => ({ location: suggestedName }),
    },
    copyText: async () => undefined,
    currentHref: () => "https://studio.example/editor#old-fragment",
    currentProject: () => ({
      displayName: "Gear train",
      snapshot: createProjectSnapshot("gear-train", new Map([
        ["main.scad", "cube(7);"],
      ])),
    }),
    currentSource: () => "cube(7);",
    installImportedProject: async () => undefined,
    makeProjectId: () => "imported-project",
    openSharedScratch: async () => undefined,
    ...overrides,
  };
}

describe("project portability controller", () => {
  it("copies a fragment-only link and opens byte-identical Unicode source in a fresh session", async () => {
    const source = "// café ⚙\ntext(\"雪\");\n";
    let copied = "";
    const creator = createProjectPortabilityController(port({
      copyText: async (value) => { copied = value; },
      currentSource: () => source,
    }));

    await creator.copyShareLink();

    let opened = "";
    const freshSession = createProjectPortabilityController(port({
      currentHref: () => copied,
      openSharedScratch: async (value) => { opened = value; },
    }));
    const shared = await freshSession.openStartupShare();

    expect(new URL(copied).search).toBe("");
    expect(new URL(copied).hash).toMatch(/^#scadmill-share=v1\./u);
    expect(opened).toBe(source);
    expect(new TextEncoder().encode(opened)).toEqual(new TextEncoder().encode(source));
    expect(shared?.origin).toBe("studio.example");
  });

  it("keeps the generated href when clipboard permission is denied", async () => {
    const controller = createProjectPortabilityController(port({
      copyText: async () => { throw new DOMException("denied", "NotAllowedError"); },
    }));

    const rejected = await controller.copyShareLink().catch((reason: unknown) => reason);

    expect(rejected).toBeInstanceOf(ShareLinkCopyError);
    expect((rejected as ShareLinkCopyError).href).toMatch(/^https:\/\/studio\.example\/editor#scadmill-share=/u);
  });

  it("exports and imports a project ZIP without changing text or binary bytes", async () => {
    const binary = Uint8Array.of(0, 255, 65, 10);
    let saved: ArtifactSaveRequest | undefined;
    const exporter = createProjectPortabilityController(port({
      artifacts: {
        available: true,
        save: async (request) => {
          saved = request;
          return { location: "Gear train.zip" };
        },
      },
      currentProject: () => ({
        displayName: "Gear train",
        snapshot: createProjectSnapshot("gear-train", new Map<string, string | Uint8Array>([
          ["main.scad", "include <parts/pin.scad>;\n"],
          ["parts/pin.scad", "cylinder(3);\n"],
          ["assets/pixel.png", binary],
        ])),
      }),
    }));

    const exported = await exporter.exportProjectZip();
    expect(exported.location).toBe("Gear train.zip");
    expect(saved?.suggestedName).toBe("Gear train.zip");
    expect(saved?.mimeType).toBe("application/zip");

    let installed: Parameters<ProjectPortabilityPort["installImportedProject"]>[0] | undefined;
    const importer = createProjectPortabilityController(port({
      installImportedProject: async (project) => { installed = project; },
    }));
    await importer.importProjectZip(archiveFile("Gear train.zip", saved?.bytes ?? new Uint8Array()));

    expect(installed?.displayName).toBe("Gear train");
    expect(installed?.entryFile).toBe("main.scad");
    if (!installed) throw new Error("The imported project was not installed.");
    expect([...installed.snapshot.files]).toEqual([
      ["assets/pixel.png", binary],
      ["main.scad", "include <parts/pin.scad>;\n"],
      ["parts/pin.scad", "cylinder(3);\n"],
    ]);
  });

  it("rejects an oversized archive before reading it", async () => {
    const read = vi.fn(async () => new ArrayBuffer(8));
    const controller = createProjectPortabilityController(port(), { archiveByteLimit: 4 });

    await expect(controller.importProjectZip({
      name: "huge.zip",
      size: 8,
      arrayBuffer: read,
    })).rejects.toThrow(/archive is too large/iu);
    expect(read).not.toHaveBeenCalled();
  });

  it("does nothing at startup when the URL has no ScadMill share fragment", async () => {
    const open = vi.fn();
    const controller = createProjectPortabilityController(port({
      currentHref: () => "https://studio.example/editor#section",
      openSharedScratch: open,
    }));

    await expect(controller.openStartupShare()).resolves.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("opens a startup share only once when lifecycle effects call concurrently", async () => {
    const creator = createProjectPortabilityController(port({
      currentSource: () => "sphere(9);",
    }));
    const href = await creator.copyShareLink();
    const open = vi.fn(async () => undefined);
    const controller = createProjectPortabilityController(port({
      currentHref: () => href,
      openSharedScratch: open,
    }));

    const [first, second] = await Promise.all([
      controller.openStartupShare(),
      controller.openStartupShare(),
    ]);

    expect(first).toEqual(second);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
