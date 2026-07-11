import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  mirrorWebViewDevToolsPort,
  parseSourceMetadata,
  parseBinaryStl,
  processHasExited,
  scanFileForBytes,
  unwrapWebDriverValue,
  validatePackagedWorkspaceLayoutObservation,
  validatePackagedWorkspaceLayoutRestart,
  validateSourceMetadata,
  validateHarnessManifest,
  validateSandboxConfig,
  validateCredentialProbe,
  webViewAutomationArgument,
} from "../../scripts/lib/packaged-desktop-evidence.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function binaryStl(triangles: readonly (readonly [number, number, number])[][]): Uint8Array {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, triangleIndex) => {
    const offset = 84 + triangleIndex * 50;
    triangle.forEach((vertex, vertexIndex) => {
      vertex.forEach((coordinate, axis) => {
        view.setFloat32(offset + 12 + vertexIndex * 12 + axis * 4, coordinate, true);
      });
    });
  });
  return bytes;
}

describe("packaged desktop evidence helpers", () => {
  it("parses exact binary-STL triangle counts and finite bounds", () => {
    const evidence = parseBinaryStl(binaryStl([
      [[0, 0, 0], [10, 0, 0], [0, 10, 0]],
      [[10, 0, 10], [10, 10, 10], [0, 10, 10]],
    ]));

    expect(evidence).toEqual({
      triangleCount: 2,
      bounds: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] },
    });
  });

  it("rejects truncated and non-finite binary-STL payloads", () => {
    const truncated = binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]).subarray(0, 100);
    expect(() => parseBinaryStl(truncated)).toThrow("length");

    const nonFinite = binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]);
    new DataView(nonFinite.buffer).setFloat32(96, Number.NaN, true);
    expect(() => parseBinaryStl(nonFinite)).toThrow("finite");
  });

  it("unwraps successful WebDriver values and preserves remote errors", () => {
    expect(unwrapWebDriverValue({ value: { sessionId: "session-1" } })).toEqual({
      sessionId: "session-1",
    });
    expect(() => unwrapWebDriverValue({
      value: { error: "no such element", message: "missing button", stacktrace: "remote stack" },
    })).toThrow("no such element: missing button");
  });

  it("accepts only the exact credential target and expected Win32 state", () => {
    expect(validateCredentialProbe({
      target: "ai-api-key.dev.scadmill.app",
      found: true,
      lastError: 0,
    }, "ai-api-key.dev.scadmill.app", true)).toMatchObject({ found: true, lastError: 0 });
    expect(validateCredentialProbe({
      target: "ai-api-key.dev.scadmill.app",
      found: false,
      lastError: 1168,
    }, "ai-api-key.dev.scadmill.app", false)).toMatchObject({ found: false, lastError: 1168 });
    expect(() => validateCredentialProbe({
      target: "other",
      found: false,
      lastError: 1168,
    }, "ai-api-key.dev.scadmill.app", false)).toThrow("target");
  });

  it("validates one exact opaque project layout observation", () => {
    const workspaceIdentity = `desktop-project:${"a".repeat(64)}`;
    const storageKey = `scadmill.desktop-workspace-layout.v1:${workspaceIdentity}`;
    const serializedLayout = JSON.stringify({
      version: 1,
      activeRail: "files",
      dockOpen: true,
      editorOpen: true,
      viewerOpen: true,
      parameterOpen: true,
      consoleOpen: false,
      dockWidth: 300,
      viewerWidth: 480,
      parameterHeight: 220,
      consoleHeight: 180,
      narrowView: "code",
    });

    expect(validatePackagedWorkspaceLayoutObservation({
      dockWidth: 300,
      storageEntries: [{ key: storageKey, value: serializedLayout }],
    }, 300)).toEqual({
      dockWidth: 300,
      serializedLayout,
      storageKey,
      workspaceIdentity,
    });
  });

  it("rejects serialized layout evidence that could expose a raw project path", () => {
    const workspaceIdentity = `desktop-project:${"a".repeat(64)}`;
    const storageKey = `scadmill.desktop-workspace-layout.v1:${workspaceIdentity}`;
    const serializedLayout = JSON.stringify({
      version: 1,
      activeRail: "files",
      dockOpen: true,
      editorOpen: true,
      viewerOpen: true,
      parameterOpen: true,
      consoleOpen: false,
      dockWidth: 300,
      viewerWidth: 480,
      parameterHeight: 220,
      consoleHeight: 180,
      narrowView: "code",
      projectPath: "C:\\Users\\Scott\\Secret",
    });

    expect(() => validatePackagedWorkspaceLayoutObservation({
      dockWidth: 300,
      storageEntries: [{ key: storageKey, value: serializedLayout }],
    }, 300)).toThrow("layout value has the wrong shape");
  });

  it("rejects scratch, ambiguous, and wrong-width packaged layout observations", () => {
    const workspaceIdentity = `desktop-project:${"a".repeat(64)}`;
    const storageKey = `scadmill.desktop-workspace-layout.v1:${workspaceIdentity}`;
    const layout = {
      version: 1,
      activeRail: "files",
      dockOpen: true,
      editorOpen: true,
      viewerOpen: true,
      parameterOpen: true,
      consoleOpen: false,
      dockWidth: 300,
      viewerWidth: 480,
      parameterHeight: 220,
      consoleHeight: 180,
      narrowView: "code",
    };
    const entry = { key: storageKey, value: JSON.stringify(layout) };

    expect(() => validatePackagedWorkspaceLayoutObservation({
      dockWidth: 300,
      storageEntries: [{ ...entry, key: "scadmill.desktop-workspace-layout.v1:scratch" }],
    }, 300)).toThrow("opaque project identity");
    expect(() => validatePackagedWorkspaceLayoutObservation({
      dockWidth: 300,
      storageEntries: [entry, entry],
    }, 300)).toThrow("wrong shape or width");
    expect(() => validatePackagedWorkspaceLayoutObservation({
      dockWidth: 300,
      storageEntries: [{ ...entry, value: JSON.stringify({ ...layout, dockWidth: 292 }) }],
    }, 300)).toThrow("wrong dock width");
  });

  it("requires an exact layout round trip through fresh app and WebView processes", () => {
    const workspaceIdentity = `desktop-project:${"a".repeat(64)}`;
    const layout = {
      dockWidth: 300,
      serializedLayout: JSON.stringify({
        version: 1,
        activeRail: "files",
        dockOpen: true,
        editorOpen: true,
        viewerOpen: true,
        parameterOpen: true,
        consoleOpen: false,
        dockWidth: 300,
        viewerWidth: 480,
        parameterHeight: 220,
        consoleHeight: 180,
        narrowView: "code",
      }),
      storageKey: `scadmill.desktop-workspace-layout.v1:${workspaceIdentity}`,
      workspaceIdentity,
    };

    expect(validatePackagedWorkspaceLayoutRestart({
      applicationPid: 120,
      webViewPids: [121, 122],
      layout,
    }, {
      applicationPid: 220,
      webViewPids: [221, 222],
      layout: { ...layout },
    })).toEqual({
      exactLayoutRestored: true,
      freshApplicationProcess: true,
      freshWebViewProcesses: true,
    });
  });

  it("rejects retained processes and changed values in a layout restart observation", () => {
    const workspaceIdentity = `desktop-project:${"a".repeat(64)}`;
    const serializedLayout = JSON.stringify({
      version: 1,
      activeRail: "files",
      dockOpen: true,
      editorOpen: true,
      viewerOpen: true,
      parameterOpen: true,
      consoleOpen: false,
      dockWidth: 300,
      viewerWidth: 480,
      parameterHeight: 220,
      consoleHeight: 180,
      narrowView: "code",
    });
    const layout = {
      dockWidth: 300,
      serializedLayout,
      storageKey: `scadmill.desktop-workspace-layout.v1:${workspaceIdentity}`,
      workspaceIdentity,
    };
    const before = { applicationPid: 120, webViewPids: [121, 122], layout };

    expect(() => validatePackagedWorkspaceLayoutRestart(before, {
      applicationPid: 120,
      webViewPids: [221, 222],
      layout,
    })).toThrow("fresh application process");
    expect(() => validatePackagedWorkspaceLayoutRestart(before, {
      applicationPid: 220,
      webViewPids: [122, 222],
      layout,
    })).toThrow("fresh WebView processes");
    expect(() => validatePackagedWorkspaceLayoutRestart(before, {
      applicationPid: 220,
      webViewPids: [221, 222],
      layout: {
        ...layout,
        serializedLayout: serializedLayout.replace('"viewerWidth":480', '"viewerWidth":500'),
      },
    })).toThrow("restored exactly");
  });

  it("finds a sentinel split across streaming read boundaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-evidence-"));
    temporaryRoots.push(root);
    const path = join(root, "written.bin");
    await writeFile(path, Buffer.from("01234567SENTINEL-tail"));

    await expect(scanFileForBytes(path, Buffer.from("SENTINEL"), 12)).resolves.toBe(true);
    await expect(scanFileForBytes(path, Buffer.from("absent"), 12)).resolves.toBe(false);
  });

  it("mirrors the fresh WebView2 DevTools port file to EdgeDriver's expected parent", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-webview-port-"));
    temporaryRoots.push(root);
    const webViewRoot = join(root, "EBWebView");
    await mkdir(webViewRoot);

    const mirror = mirrorWebViewDevToolsPort(root, { timeoutMs: 1_000, intervalMs: 5 });
    await writeFile(join(webViewRoot, "DevToolsActivePort"), "54321\n/devtools/browser/fresh\n");

    await expect(mirror).resolves.toMatchObject({ copied: true });
    await expect(readFile(join(root, "DevToolsActivePort"), "utf8"))
      .resolves.toBe("54321\n/devtools/browser/fresh\n");
  });

  it("forces WebView2 remote debugging through the documented host-app switch", () => {
    expect(webViewAutomationArgument()).toBe(
      "--edge-webview-switches=--remote-debugging-port=0",
    );
  });

  it("binds evidence metadata to one source commit, branch, and release hash", () => {
    const appSha256 = "82".repeat(32);
    expect(validateSourceMetadata({
      baseCommit: "e6".repeat(20),
      branch: "agent/m2-r02-r03",
      applicationSha256: appSha256,
    }, appSha256)).toEqual({
      baseCommit: "e6".repeat(20),
      branch: "agent/m2-r02-r03",
      applicationSha256: appSha256,
    });
    expect(() => validateSourceMetadata({
      baseCommit: "e6".repeat(20),
      branch: "agent/m2-r02-r03",
      applicationSha256: "00".repeat(32),
    }, appSha256)).toThrow("release hash");
  });

  it("parses PowerShell UTF-8 source metadata without accepting a mismatched app", () => {
    const appSha256 = "82".repeat(32);
    const serialized = `\uFEFF${JSON.stringify({
      baseCommit: "e6".repeat(20),
      branch: "agent/m2-r02-r03",
      applicationSha256: appSha256,
    })}`;
    expect(parseSourceMetadata(serialized, appSha256)).toMatchObject({ branch: "agent/m2-r02-r03" });
    expect(() => parseSourceMetadata(serialized, "00".repeat(32))).toThrow("release hash");
  });

  it("requires an exact isolated-Sandbox harness manifest", () => {
    const sha256 = "ab".repeat(32);
    const manifest = {
      schemaVersion: 1,
      files: {
        config: { path: "scadmill-packaged-evidence.wsb", sha256 },
        credentialProbe: { path: "scripts/credential-probe.ps1", sha256 },
        helper: { path: "scripts/lib/packaged-desktop-evidence.mjs", sha256 },
        runner: { path: "scripts/run-packaged-desktop-evidence.mjs", sha256 },
        sandboxBootstrap: { path: "scripts/run-packaged-desktop-sandbox.ps1", sha256 },
        sourceMetadata: { path: "scripts/source-metadata.json", sha256 },
      },
      policy: {
        networking: "Disable",
        clipboardRedirection: "Disable",
        audioInput: "Disable",
        videoInput: "Disable",
        printerRedirection: "Disable",
        inputMappingsReadOnly: true,
        outputMappingReadOnly: false,
      },
    };
    expect(validateHarnessManifest(manifest)).toEqual(manifest);
    expect(() => validateHarnessManifest({
      ...manifest,
      policy: { ...manifest.policy, networking: "Enable" },
    })).toThrow("isolation policy");
  });

  it("checks the retained Sandbox config instead of trusting policy labels", () => {
    const config = `<Configuration>
      <Networking>Disable</Networking><AudioInput>Disable</AudioInput>
      <VideoInput>Disable</VideoInput><PrinterRedirection>Disable</PrinterRedirection>
      <ClipboardRedirection>Disable</ClipboardRedirection>
      <MappedFolders>
        <MappedFolder><SandboxFolder>C:\\ScadMillEvidence</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
        <MappedFolder><SandboxFolder>C:\\ScadMillEngine</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
        <MappedFolder><SandboxFolder>C:\\ScadMillWebView</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
        <MappedFolder><SandboxFolder>C:\\ScadMillEvidenceOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
      </MappedFolders>
      <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\ScadMillEvidence\\scripts\\run-packaged-desktop-sandbox.ps1</Command></LogonCommand>
    </Configuration>`;
    expect(validateSandboxConfig(config)).toMatchObject({ networking: "Disable" });
    expect(() => validateSandboxConfig(config.replace(
      "<Networking>Disable</Networking>",
      "<Networking>Enable</Networking>",
    ))).toThrow("Networking");
    expect(() => validateSandboxConfig(config.replace(
      "<Networking>Disable</Networking>",
      "<!-- <Networking>Disable</Networking> --><Networking>Enable</Networking>",
    ))).toThrow("comments");
  });

  it("treats a signal-terminated driver as exited without fabricating an exit code", () => {
    expect(processHasExited(null, null)).toBe(false);
    expect(processHasExited(0, null)).toBe(true);
    expect(processHasExited(null, "SIGTERM")).toBe(true);
  });
});
