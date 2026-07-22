import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Window } from "happy-dom";

import { afterEach, describe, expect, it } from "vitest";

import {
  CLICK_PACKAGED_BUTTON_SCRIPT,
  clickVisibleEnabledButton,
  createCdpSocketLease,
  FIND_PACKAGED_TEXTAREA_CONTROL_SCRIPT,
  FOCUS_PACKAGED_TEXTAREA_CONTROL_SCRIPT,
  PACKAGED_WORKBENCH_EDITOR_SELECTOR,
  insertTextThroughCdp,
  mcpEndpointManifestPath,
  mirrorWebViewDevToolsPort,
  parseBinaryStl,
  parseSourceMetadata,
  parseWindowsNetstatTcpListeners,
  processHasExited,
  READ_PACKAGED_CONTROL_VALUE_SCRIPT,
  READ_PACKAGED_PAGE_URL_SCRIPT,
  SET_PACKAGED_CONTROL_VALUE_SCRIPT,
  sanitizeMcpEndpointManifest,
  sanitizeMcpTranscript,
  scanFileForBytes,
  setVisibleEnabledControl,
  setVisibleEnabledTextArea,
  unwrapWebDriverValue,
  validateCredentialProbe,
  validateHarnessManifest,
  validateMcpEndpointManifest,
  validateMcpListenerObservation,
  validatePackagedWorkspaceLayoutObservation,
  validatePackagedWorkspaceLayoutRestart,
  validateSandboxConfig,
  validateSourceMetadata,
  webViewAutomationArgument,
} from "../../scripts/lib/packaged-desktop-evidence.mjs";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

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
  it("selects the focused workbench editor when History mounts read-only CodeMirror panes", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <section class="history-panel">
        <div class="cm-content" data-editor="history-current"></div>
        <div class="cm-content" data-editor="history-snapshot"></div>
      </section>
      <section class="editor-panel">
        <div class="editor-group editor-group-focused">
          <div class="cm-content" data-editor="workbench"></div>
        </div>
      </section>
    `;

    expect(window.document.querySelectorAll(".cm-content")).toHaveLength(3);
    expect(window.document.querySelector(PACKAGED_WORKBENCH_EDITOR_SELECTOR)
      ?.getAttribute("data-editor")).toBe("workbench");
  });

  it("derives the exact Windows MCP manifest identity from the absolute executable path", () => {
    expect(mcpEndpointManifestPath(
      "C:\\Program Files\\ScadMill\\scadmill.exe",
      "C:\\Users\\sandbox\\AppData\\Local\\Temp",
    )).toMatch(/^C:\\Users\\sandbox\\AppData\\Local\\Temp\\scadmill-mcp-[0-9a-f]{24}\.json$/u);
    expect(mcpEndpointManifestPath(
      "C:/PROGRAM FILES/ScadMill/scadmill.exe",
      "C:\\Users\\sandbox\\AppData\\Local\\Temp",
    )).toBe(mcpEndpointManifestPath(
      "C:\\Program Files\\ScadMill\\scadmill.exe",
      "C:\\Users\\sandbox\\AppData\\Local\\Temp",
    ));
    expect(() => mcpEndpointManifestPath("scadmill.exe", "C:\\Temp"))
      .toThrow("absolute executable");
    for (const ambiguous of ["\\Temp", "/tmp", "C:Temp"]) {
      expect(() => mcpEndpointManifestPath(
        "C:\\Program Files\\ScadMill\\scadmill.exe",
        ambiguous,
      )).toThrow("absolute executable");
    }
  });

  it("validates the exact loopback MCP endpoint manifest for the GUI process", () => {
    expect(validateMcpEndpointManifest).toBeTypeOf("function");
    const guiPid = 4_242;
    const manifest = {
      version: 1,
      address: "127.0.0.1",
      port: 49_152,
      token: "a1".repeat(32),
      pid: guiPid,
      process_start_id: "01dc5a1b2c3d4e5f",
    };

    expect(validateMcpEndpointManifest(manifest, guiPid)).toEqual(manifest);
    for (const invalid of [
      { ...manifest, version: 2 },
      { ...manifest, address: "0.0.0.0" },
      { ...manifest, port: 0 },
      { ...manifest, port: 65_536 },
      { ...manifest, port: 49_152.5 },
      { ...manifest, token: "A1".repeat(32) },
      { ...manifest, token: "a1".repeat(31) },
      { ...manifest, pid: guiPid + 1 },
      { ...manifest, process_start_id: "0000000000000000" },
      { ...manifest, process_start_id: "01DC5A1B2C3D4E5F" },
      { ...manifest, extra: true },
    ]) expect(() => validateMcpEndpointManifest(invalid, guiPid)).toThrow("MCP endpoint manifest");
  });

  it("requires no listener while MCP is off and one exact GUI-owned listener while on", () => {
    expect(validateMcpListenerObservation).toBeTypeOf("function");
    const endpoint = { address: "127.0.0.1", port: 49_152, pid: 4_242 };
    const authenticatedManifest = {
      ...endpoint,
      version: 1,
      token: "a1".repeat(32),
      process_start_id: "01dc5a1b2c3d4e5f",
    };

    expect(validateMcpListenerObservation([], false, endpoint)).toEqual([]);
    expect(validateMcpListenerObservation([endpoint], true, endpoint)).toEqual([endpoint]);
    expect(validateMcpListenerObservation([endpoint], true, authenticatedManifest)).toEqual([endpoint]);
    expect(() => validateMcpListenerObservation([endpoint], false, endpoint)).toThrow(
      "MCP listener observation",
    );
    expect(() => validateMcpListenerObservation([], true, endpoint)).toThrow(
      "MCP listener observation",
    );
    expect(() => validateMcpListenerObservation([
      { ...endpoint, pid: endpoint.pid + 1 },
    ], true, endpoint)).toThrow("MCP listener observation");
    expect(() => validateMcpListenerObservation([
      endpoint,
      endpoint,
    ], true, endpoint)).toThrow("MCP listener observation");
  });

  it("parses Windows netstat TCP listeners for literal process inspection", () => {
    expect(parseWindowsNetstatTcpListeners([
      "Active Connections",
      "",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    127.0.0.1:49152        0.0.0.0:0              LISTENING       4242",
      "  TCP    [::1]:49153            [::]:0                 LISTENING       4243",
      "  TCP    127.0.0.1:49154        127.0.0.1:61200        ESTABLISHED     4244",
    ].join("\r\n"))).toEqual([
      { address: "127.0.0.1", port: 49_152, pid: 4_242 },
      { address: "[::1]", port: 49_153, pid: 4_243 },
    ]);
    expect(() => parseWindowsNetstatTcpListeners(null)).toThrow("netstat output");
  });

  it("uses literal netstat PID inspection without treating the enabled table as the functional proof", async () => {
    const runner = await readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8");

    expect(runner).toContain('run("netstat.exe", ["-ano", "-p", "tcp"]');
    expect(runner).toContain("parseWindowsNetstatTcpListeners(result.stdout)");
    expect(runner).not.toContain("Get-NetTCPConnection");
    expect(runner).not.toContain("tcpListenersForPort");
    expect(runner).toContain("tcpEndpointReachable(endpointRecord.endpoint)");
    expect(runner).toContain("endpointReachable: false");
  });

  it("omits the MCP token from retained endpoint and transcript evidence", () => {
    expect([sanitizeMcpEndpointManifest, sanitizeMcpTranscript].every(
      (candidate) => typeof candidate === "function",
    )).toBe(true);
    const token = "a1".repeat(32);
    const manifest = {
      version: 1,
      address: "127.0.0.1",
      port: 49_152,
      token,
      pid: 4_242,
      process_start_id: "01dc5a1b2c3d4e5f",
    };
    const transcript = {
      handshake: `SCADMILL-MCP/1 ${token}\n`,
      messages: [
        { direction: "client", text: `before-${token}-after`, token },
        { direction: "server", text: "safe response" },
      ],
    };

    expect(sanitizeMcpEndpointManifest(manifest)).toEqual({
      version: 1,
      address: "127.0.0.1",
      port: 49_152,
      pid: 4_242,
      processIdentityBound: true,
    });
    const sanitizedTranscript = sanitizeMcpTranscript(transcript, token);
    expect(sanitizedTranscript).toEqual({
      handshake: "SCADMILL-MCP/1 [REDACTED]\n",
      messages: [
        { direction: "client", text: "before-[REDACTED]-after" },
        { direction: "server", text: "safe response" },
      ],
    });
    expect(JSON.stringify({ manifest: sanitizeMcpEndpointManifest(manifest), sanitizedTranscript }))
      .not.toContain(token);
  });

  it("walks the packaged MCP lifecycle through a real relay process and literal off-state inspection", async () => {
    const runner = await readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8");
    const defaultOff = runner.indexOf('record("mcp-default-off-process-inspection-passed"');
    const childLaunch = runner.indexOf('spawn(application, ["--mcp-stdio"]');
    const initialize = runner.indexOf('mcpClient.request("initialize"');
    const listTools = runner.indexOf('mcpClient.request("tools/list"');
    const render = runner.indexOf('name: "render_preview"');
    const diagnostics = runner.indexOf('name: "get_diagnostics"');
    const write = runner.indexOf('name: "write_file"');
    const pendingDiff = runner.indexOf('"02-mcp-pending-diff.png"');
    const toggleOff = runner.indexOf('record("mcp-toggle-off-process-inspection-passed"');

    expect(defaultOff).toBeGreaterThanOrEqual(0);
    expect(childLaunch).toBeGreaterThanOrEqual(0);
    expect(initialize).toBeGreaterThan(defaultOff);
    expect(listTools).toBeGreaterThan(initialize);
    expect(render).toBeGreaterThan(listTools);
    expect(diagnostics).toBeGreaterThan(render);
    expect(write).toBeGreaterThan(diagnostics);
    expect(pendingDiff).toBeGreaterThan(write);
    expect(toggleOff).toBeGreaterThan(pendingDiff);
    expect(runner).toContain("validateMcpListenerObservation");
    expect(runner).toContain("sanitizeMcpTranscript");
    expect(runner).toContain("stdio: [\"pipe\", \"pipe\", \"pipe\"]");
    expect(runner).not.toContain("if (payload?.pid !== pid) continue");
    expect(runner).toContain("never ignore a crash-retained token");
  });

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

  it("selects the one current-width layout while retaining a prior project's valid layout", () => {
    const currentIdentity = `desktop-project:${"a".repeat(64)}`;
    const priorIdentity = `desktop-project:${"b".repeat(64)}`;
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
    const currentValue = JSON.stringify(layout);

    expect(validatePackagedWorkspaceLayoutObservation({
      dockWidth: 300,
      storageEntries: [
        {
          key: `scadmill.desktop-workspace-layout.v1:${priorIdentity}`,
          value: JSON.stringify({ ...layout, dockWidth: 260 }),
        },
        {
          key: `scadmill.desktop-workspace-layout.v1:${currentIdentity}`,
          value: currentValue,
        },
      ],
    }, 300)).toEqual({
      dockWidth: 300,
      serializedLayout: currentValue,
      storageKey: `scadmill.desktop-workspace-layout.v1:${currentIdentity}`,
      workspaceIdentity: currentIdentity,
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

  it("observes the implicit HR separator through a concrete DOM selector", async () => {
    const runner = await readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8");

    expect(runner).toContain("querySelectorAll('hr[aria-label]')");
    expect(runner).not.toContain("querySelectorAll('[role=\"separator\"]')");
  });

  it("dismisses the fresh-profile welcome dialog before editing the packaged model", async () => {
    const runner = await readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8");
    const dismissWelcome = runner.indexOf('await dismissWelcome(client);');
    const editCube = runner.indexOf('await replaceEditorSource(client, cubeSource);');
    const sessionCount = [...runner.matchAll(/await client\.createSession\(args\.app, args\.webview\);/gu)].length;
    const disabledChecks = [...runner.matchAll(/await assertWelcomeStaysDisabled\(client\);/gu)].length;

    expect(dismissWelcome).toBeGreaterThan(0);
    expect(editCube).toBeGreaterThan(dismissWelcome);
    expect(runner).toContain("document.querySelector('.welcome-modal-layer')");
    expect(runner).toContain("await client.clickElement(startupToggle);");
    expect(runner).toContain("await client.clickElement(closeWelcome);");
    expect(disabledChecks).toBe(sessionCount);
  });

  it("validates the versioned scratch snapshot during packaged restart evidence", async () => {
    const runner = await readFile(
      join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"),
      "utf8",
    );

    expect(runner).toContain("scadmill.scratch-autosave.v2");
    expect(runner).toContain("saved?.version === 2");
    expect(runner).toContain("saved.path === 'Untitled'");
    expect(runner).toContain("saved.source === cubeSource");
    expect(runner).not.toContain("localStorage.getItem('scadmill.scratch-autosave.v1')");
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

  it("retries a transient WebView2 DevTools port sharing lock within the existing bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-webview-port-lock-"));
    temporaryRoots.push(root);
    const webViewRoot = join(root, "EBWebView");
    await mkdir(webViewRoot);
    await writeFile(join(webViewRoot, "DevToolsActivePort"), "54321\n/devtools/browser/fresh\n");
    let attempts = 0;
    const readFileImpl = async (path: string) => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("temporarily locked"), { code: "EBUSY" });
      }
      return readFile(path);
    };

    await expect(mirrorWebViewDevToolsPort(root, {
      intervalMs: 5,
      timeoutMs: 1_000,
      readFileImpl,
    }))
      .resolves.toMatchObject({ copied: true });
    expect(attempts).toBe(2);

    const permanent = Object.assign(new Error("access denied"), { code: "EACCES" });
    await expect(mirrorWebViewDevToolsPort(root, {
      intervalMs: 5,
      timeoutMs: 1_000,
      readFileImpl: async () => { throw permanent; },
    })).rejects.toBe(permanent);
  });

  it("forces WebView2 remote debugging through the documented host-app switch", () => {
    expect(webViewAutomationArgument()).toBe(
      "--edge-webview-switches=--remote-debugging-port=0",
    );
  });

  it("grants the copied fixed WebView runtime AppContainer access before driver launch", async () => {
    const bootstrap = await readFile(
      join(process.cwd(), "scripts", "windows", "run-packaged-desktop-sandbox.ps1"),
      "utf8",
    );
    const allPackages = bootstrap.indexOf('"*S-1-15-2-2:(OI)(CI)(RX)"');
    const restrictedPackages = bootstrap.indexOf('"*S-1-15-2-1:(OI)(CI)(RX)"');
    const aclCommand = bootstrap.indexOf('& icacls.exe "$local\\webview" /grant $grant /T /C /Q');
    const runnerLaunch = bootstrap.indexOf('& "$local\\tools\\node.exe" @arguments');

    expect(allPackages).toBeGreaterThanOrEqual(0);
    expect(restrictedPackages).toBeGreaterThan(allPackages);
    expect(aclCommand).toBeGreaterThan(restrictedPackages);
    expect(runnerLaunch).toBeGreaterThan(aclCommand);
  });

  it("places the Visual C++ runtime beside the packaged app before launch", async () => {
    const [bootstrap, wrapper, runner] = await Promise.all([
      readFile(
        join(process.cwd(), "scripts", "windows", "run-packaged-desktop-sandbox.ps1"),
        "utf8",
      ),
      readFile(
        join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"),
        "utf8",
      ),
      readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8"),
    ]);
    const runtimeCopy = bootstrap.indexOf(
      'Copy-Item -LiteralPath "$local\\tools\\vcruntime140.dll" -Destination "$local\\app\\vcruntime140.dll" -Force -ErrorAction Stop',
    );
    const companionCopy = bootstrap.indexOf(
      'Copy-Item -LiteralPath "$local\\tools\\vcruntime140_1.dll" -Destination "$local\\app\\vcruntime140_1.dll" -Force -ErrorAction Stop',
    );
    const runnerLaunch = bootstrap.indexOf('& "$local\\tools\\node.exe" @arguments');

    expect(runtimeCopy).toBeGreaterThanOrEqual(0);
    expect(companionCopy).toBeGreaterThan(runtimeCopy);
    expect(runnerLaunch).toBeGreaterThan(companionCopy);
    expect(wrapper).toContain(
      '[Parameter(Mandatory = $true)] [string] $VisualCppRuntimeCompanion',
    );
    expect(wrapper).toContain(
      'Copy-Item -LiteralPath $visualCppRuntimeCompanionPath -Destination (Join-Path $stage "tools\\vcruntime140_1.dll")',
    );
    expect(runner).toContain('join(dirname(args["tauri-driver"]), "vcruntime140_1.dll")');
    expect(runner).toContain("1F2D41C4AA5DB0BC33EBF7B66D72943A817D7CE6CBE880502A9403823633093F");
  });

  it("binds evidence metadata to one clean source tree and its locked same-step build", () => {
    const appSha256 = "82".repeat(32);
    const metadata = {
      schemaVersion: 1,
      sourceCommit: "e6".repeat(20),
      sourceTree: "ab".repeat(20),
      branch: "agent/m2-r02-r03",
      canonicalApplication: "src/desktop-shell/src-tauri/target/release/scadmill.exe",
      applicationSha256: appSha256,
      worktree: { cleanBeforeBuild: true, cleanAfterBuild: true },
      lockfiles: {
        pnpm: { path: "pnpm-lock.yaml", sha256: "11".repeat(32) },
        nativeCargo: { path: "src/native-engine/Cargo.lock", sha256: "22".repeat(32) },
        desktopCargo: {
          path: "src/desktop-shell/src-tauri/Cargo.lock",
          sha256: "33".repeat(32),
        },
      },
      build: {
        startedAt: "2026-07-11T23:00:00.000Z",
        completedAt: "2026-07-11T23:02:00.000Z",
        commands: [
          "pnpm.cmd install --frozen-lockfile",
          "cargo.exe clean --manifest-path src/desktop-shell/src-tauri/Cargo.toml --target-dir src/desktop-shell/src-tauri/target",
          "pnpm.cmd exec tauri build --no-bundle --ci -- --locked",
        ],
        toolVersions: {
          node: "v24.17.0",
          pnpm: "11.7.0",
          cargo: "cargo 1.96.0 (example 2026-01-01)",
          rustc: "rustc 1.96.0 (example 2026-01-01)",
        },
      },
    };

    expect(validateSourceMetadata(metadata, appSha256)).toEqual(metadata);
    expect(() => validateSourceMetadata({
      ...metadata,
      applicationSha256: "00".repeat(32),
    }, appSha256)).toThrow("release hash");
    expect(() => validateSourceMetadata({
      ...metadata,
      worktree: { ...metadata.worktree, cleanBeforeBuild: false },
    }, appSha256)).toThrow("clean worktree");
    expect(() => validateSourceMetadata({
      ...metadata,
      build: { ...metadata.build, commands: metadata.build.commands.slice(1) },
    }, appSha256)).toThrow("locked build provenance");
  });

  it("parses PowerShell UTF-8 source metadata without accepting a mismatched app", () => {
    const appSha256 = "82".repeat(32);
    const serialized = `\uFEFF${JSON.stringify({
      schemaVersion: 1,
      sourceCommit: "e6".repeat(20),
      sourceTree: "ab".repeat(20),
      branch: "agent/m2-r02-r03",
      canonicalApplication: "src/desktop-shell/src-tauri/target/release/scadmill.exe",
      applicationSha256: appSha256,
      worktree: { cleanBeforeBuild: true, cleanAfterBuild: true },
      lockfiles: {
        pnpm: { path: "pnpm-lock.yaml", sha256: "11".repeat(32) },
        nativeCargo: { path: "src/native-engine/Cargo.lock", sha256: "22".repeat(32) },
        desktopCargo: {
          path: "src/desktop-shell/src-tauri/Cargo.lock",
          sha256: "33".repeat(32),
        },
      },
      build: {
        startedAt: "2026-07-11T23:00:00.000Z",
        completedAt: "2026-07-11T23:02:00.000Z",
        commands: [
          "pnpm.cmd install --frozen-lockfile",
          "cargo.exe clean --manifest-path src/desktop-shell/src-tauri/Cargo.toml --target-dir src/desktop-shell/src-tauri/target",
          "pnpm.cmd exec tauri build --no-bundle --ci -- --locked",
        ],
        toolVersions: {
          node: "v24.17.0",
          pnpm: "11.7.0",
          cargo: "cargo 1.96.0 (example 2026-01-01)",
          rustc: "rustc 1.96.0 (example 2026-01-01)",
        },
      },
    })}`;
    expect(parseSourceMetadata(serialized, appSha256)).toMatchObject({ branch: "agent/m2-r02-r03" });
    expect(() => parseSourceMetadata(serialized, "00".repeat(32))).toThrow("release hash");
  });

  it("fails closed before staging unless a clean HEAD is built at the canonical target", async () => {
    const wrapper = await readFile(
      join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"),
      "utf8",
    );
    const cleanBefore = wrapper.indexOf("Assert-CleanWorktree \"before build\"");
    const emptyOutput = wrapper.indexOf(
      "Get-ChildItem -LiteralPath $outputPath -Force -ErrorAction Stop",
    );
    const install = wrapper.indexOf('-Arguments @("install", "--frozen-lockfile")');
    const cargoClean = wrapper.indexOf('-Arguments @("clean", "--manifest-path"');
    const tauriBuild = wrapper.indexOf(
      '-Arguments @("exec", "tauri", "build", "--no-bundle", "--ci", "--", "--locked")',
    );
    const cleanAfter = wrapper.indexOf("Assert-CleanWorktree \"after build\"");
    const stageApplication = wrapper.indexOf(
      'Copy-Item -LiteralPath $applicationPath -Destination (Join-Path $stage "app\\scadmill.exe")',
    );
    const retainedConfig = wrapper.indexOf(
      'Copy-Item -LiteralPath $configPath -Destination (Join-Path $outputPath "sandbox-config.wsb")',
    );
    const launchClean = wrapper.indexOf('Assert-CleanWorktree "before Sandbox launch"');
    const launchTree = wrapper.indexOf('"launch source tree"');
    const sandboxLaunch = wrapper.indexOf('Start-Process -FilePath "WindowsSandbox.exe"');

    expect(wrapper).not.toContain("[string] $Application");
    expect(wrapper).toContain('git -C $repo status --porcelain=v1 --untracked-files=all');
    expect(wrapper).toContain(
      '$canonicalApplication = "src/desktop-shell/src-tauri/target/release/scadmill.exe"',
    );
    expect(wrapper).toContain(
      '-Arguments @("clean", "--manifest-path", $desktopManifest, "--target-dir", $desktopTarget) -WorkingDirectory $repo -LogPath $desktopCleanLog',
    );
    expect(wrapper).not.toContain('"--package", "scadmill-desktop"');
    for (const marker of [
      cleanBefore,
      emptyOutput,
      install,
      cargoClean,
      tauriBuild,
      cleanAfter,
      stageApplication,
      retainedConfig,
      launchClean,
      launchTree,
      sandboxLaunch,
    ]) expect(marker).toBeGreaterThanOrEqual(0);
    expect([
      cleanBefore,
      emptyOutput,
      install,
      cargoClean,
      tauriBuild,
      cleanAfter,
      stageApplication,
    ])
      .toEqual([...[
        cleanBefore,
        emptyOutput,
        install,
        cargoClean,
        tauriBuild,
        cleanAfter,
        stageApplication,
      ]].sort((left, right) => left - right));
    expect(stageApplication).toBeGreaterThan(cleanAfter);
    expect(wrapper).not.toContain('-Arguments @("build", "--release", "--locked"');
    expect([retainedConfig, launchClean, launchTree, sandboxLaunch]).toEqual([
      ...[retainedConfig, launchClean, launchTree, sandboxLaunch].sort((left, right) => left - right),
    ]);
  });

  it("selects one exact pnpm application when the host PATH exposes multiple shims", async () => {
    const wrapper = await readFile(
      join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"),
      "utf8",
    );
    expect(wrapper).toContain(
      'Get-Command "pnpm.cmd" -CommandType Application -All -ErrorAction Stop |',
    );
    expect(wrapper).toContain("Select-Object -First 1");
    expect(wrapper).not.toContain(
      'Get-Command "pnpm.cmd" -CommandType Application -ErrorAction Stop\n',
    );
  });

  it("waits for the guest exit-code file to become readable before parsing it", async () => {
    const wrapper = await readFile(
      join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"),
      "utf8",
    );
    expect(wrapper).toContain("function Wait-SandboxExitCode");
    expect(wrapper).toContain("catch [IO.IOException]");
    expect(wrapper).toContain("[int]::TryParse(");
    expect(wrapper).toContain("Start-Sleep -Milliseconds 250");
    expect(wrapper).toContain("$exitCode = Wait-SandboxExitCode -Path $exitFile -Deadline $deadline");
    expect(wrapper).not.toContain("[int](Get-Content -Raw -LiteralPath $exitFile)");
  });

  it.runIf(process.platform === "win32")(
    "behaviorally waits for a complete strict guest exit code and fails closed",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "scadmill-exit-code-"));
      temporaryRoots.push(root);
      const wrapper = await readFile(
        join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"),
        "utf8",
      );
      const helperMatch = wrapper.match(
        /function Wait-SandboxExitCode[\s\S]*?\r?\n\}\r?\n(?=\r?\nif \(\$TimeoutSeconds)/u,
      );
      expect(helperMatch).not.toBeNull();
      const harness = join(root, "invoke-exit-code-wait.ps1");
      await writeFile(
        harness,
        `param([string] $ExitPath, [int] $DeadlineMilliseconds, [string] $ReadyPath)\n${helperMatch?.[0] ?? ""}\n[IO.File]::WriteAllText($ReadyPath, "ready")\ntry {\n  $value = Wait-SandboxExitCode -Path $ExitPath -Deadline ((Get-Date).AddMilliseconds($DeadlineMilliseconds))\n  [Console]::Out.Write("VALUE:$value")\n  exit 0\n} catch {\n  [Console]::Error.Write($_.Exception.Message)\n  exit 7\n}\n`,
        "utf8",
      );
      let invocation = 0;
      const startWait = (path: string, deadlineMilliseconds = 650) => {
        invocation += 1;
        const readyPath = join(root, `wait-ready-${invocation}.txt`);
        return {
          readyPath,
          result: execFileAsync(
            "powershell.exe",
            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              harness,
              path,
              String(deadlineMilliseconds),
              readyPath,
            ],
            { encoding: "utf8", timeout: 5_000, windowsHide: true },
          ),
        };
      };
      const waitUntilReady = async (readyPath: string) => {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          try {
            if ((await readFile(readyPath, "utf8")) === "ready") return;
          } catch {
            // The child has not reached the production helper yet.
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("The PowerShell exit-code harness did not become ready.");
      };
      const runWait = (path: string, deadlineMilliseconds = 650) =>
        startWait(path, deadlineMilliseconds).result;

      const zero = join(root, "zero.txt");
      const nonzero = join(root, "nonzero.txt");
      await writeFile(zero, "0\r\n", "utf8");
      await writeFile(nonzero, "9\n", "utf8");
      await expect(runWait(zero)).resolves.toMatchObject({ stdout: "VALUE:0" });
      await expect(runWait(nonzero)).resolves.toMatchObject({ stdout: "VALUE:9" });

      for (const [name, contents] of [
        ["empty", ""],
        ["whitespace", " \r\n"],
        ["partial", "+"],
        ["malformed", "not-an-exit-code"],
        ["overflow", "2147483648"],
      ] as const) {
        const path = join(root, `${name}.txt`);
        await writeFile(path, contents, "utf8");
        const waiting = startWait(path, 1_600);
        await waitUntilReady(waiting.readyPath);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await writeFile(path, "7", "utf8");
        await expect(waiting.result).resolves.toMatchObject({ stdout: "VALUE:7" });
      }

      for (const [name, contents] of [
        ["persistent-malformed", "not-an-exit-code"],
        ["persistent-overflow", "2147483648"],
      ] as const) {
        const path = join(root, `${name}.txt`);
        await writeFile(path, contents, "utf8");
        await expect(runWait(path)).rejects.toMatchObject({
          code: 7,
          stderr: "Timed out waiting for a complete packaged desktop evidence exit code.",
        });
      }

      const locked = join(root, "locked.txt");
      const lockReady = join(root, "lock-ready.txt");
      const lockHarness = join(root, "hold-exclusive-lock.ps1");
      await writeFile(locked, "1", "utf8");
      await writeFile(
        lockHarness,
        `param([string] $LockedPath, [string] $ReadyPath)\n$stream = [IO.File]::Open($LockedPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)\ntry {\n  [IO.File]::WriteAllText($ReadyPath, "ready")\n  Start-Sleep -Milliseconds 550\n} finally {\n  $stream.Dispose()\n}\n`,
        "utf8",
      );
      const lock = execFileAsync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          lockHarness,
          locked,
          lockReady,
        ],
        { encoding: "utf8", timeout: 5_000, windowsHide: true },
      );
      let ready = false;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
          ready = (await readFile(lockReady, "utf8")) === "ready";
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (ready) break;
      }
      expect(ready).toBe(true);
      await expect(runWait(locked, 2_000)).resolves.toMatchObject({ stdout: "VALUE:1" });
      await expect(lock).resolves.toMatchObject({ stderr: "" });

      const missing = join(root, "never-created.txt");
      await expect(runWait(missing)).rejects.toMatchObject({
        code: 7,
        stderr: "Timed out waiting for a complete packaged desktop evidence exit code.",
      });
    },
    25_000,
  );

  it("fails closed when packaged process inspection cannot complete", async () => {
    const [runner, wrapper] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8"),
      readFile(
        join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"),
        "utf8",
      ),
    ]);
    const hostInspections = [...wrapper.matchAll(/Get-CimInstance Win32_Process[^\r\n]*/gu)]
      .map(([line]) => line);

    expect(hostInspections).toHaveLength(2);
    for (const inspection of hostInspections) {
      expect(inspection).toContain("-ErrorAction Stop");
      expect(inspection).not.toContain("SilentlyContinue");
    }
    expect(
      hostInspections.some((inspection) =>
        inspection.includes("Name = 'WindowsSandboxRemoteSession.exe'"),
      ),
    ).toBe(true);
    expect(
      hostInspections.some((inspection) =>
        inspection.includes('ProcessId = $([int]$Identity.ProcessId)'),
      ),
    ).toBe(true);
    expect(runner).toContain("Get-Process -ErrorAction Stop | Where-Object");
    expect(runner).not.toContain("Get-CimInstance Win32_Process");
    expect(runner).not.toContain("Get-Process -ErrorAction SilentlyContinue");
    expect(runner).toContain(
      'const result = await run("powershell.exe", ["-NoProfile", "-Command", command]);',
    );
    expect(runner).not.toContain("exactAppProcesses(args.app).catch(() => [])");
  });

  it("rejects process rows whose identity properties cannot be read", async () => {
    const [runner, wrapper] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8"),
      readFile(
        join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"),
        "utf8",
      ),
    ]);

    const guestQuery = runner.indexOf("$candidates = @(Get-Process -ErrorAction Stop");
    const guestAmbiguityCheck = runner.indexOf(
      "@($candidates | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.Path) -or $null -eq $_.StartTime }).Count -ne 0",
    );
    const guestExactPathFilter = runner.indexOf(
      "$candidates | Where-Object { $_.Path -eq '",
    );
    expect(guestQuery).toBeGreaterThanOrEqual(0);
    expect(guestAmbiguityCheck).toBeGreaterThan(guestQuery);
    expect(guestExactPathFilter).toBeGreaterThan(guestAmbiguityCheck);
    expect(runner).toContain(
      "throw 'Cannot prove process identity because Path or StartTime is missing.'",
    );
    expect(runner).toContain("@{n='startedAt';e={$_.StartTime.ToUniversalTime().ToString('o')}}");
    expect(runner).toContain("startedAt === processToKill.startedAt");
    expect(runner).toContain("startedAt === lastVerifiedAppProcess.startedAt");

    const hostHelper = wrapper.indexOf("function Get-ExactSandboxSessions");
    const hostQuery = wrapper.indexOf(
      "Get-CimInstance Win32_Process -ErrorAction Stop -Filter \"Name = 'WindowsSandboxRemoteSession.exe'\"",
      hostHelper,
    );
    const hostAmbiguityCheck = wrapper.indexOf(
      "[string]::IsNullOrWhiteSpace([string]$_.CommandLine)",
      hostQuery,
    );
    const hostCommandLineSplit = wrapper.indexOf(
      "[ScadMill.NativeCommandLine]::Split([string]$_.CommandLine)",
      hostAmbiguityCheck,
    );
    const hostExactConfigFilter = wrapper.indexOf(
      "[string]::Equals($_, $ConfigPath, [StringComparison]::OrdinalIgnoreCase)",
      hostCommandLineSplit,
    );
    expect(hostHelper).toBeGreaterThanOrEqual(0);
    expect(hostQuery).toBeGreaterThan(hostHelper);
    expect(hostAmbiguityCheck).toBeGreaterThan(hostQuery);
    expect(hostCommandLineSplit).toBeGreaterThan(hostAmbiguityCheck);
    expect(hostExactConfigFilter).toBeGreaterThan(hostCommandLineSplit);
    expect(wrapper).toContain(
      'throw "Cannot prove Windows Sandbox session identity because a CommandLine is missing."',
    );
    expect(wrapper).toContain("function Wait-ExactSandboxSession");
    expect(wrapper).toContain("function Get-CapturedSandboxSession");
    const waitHelper = wrapper.slice(
      wrapper.indexOf("function Wait-ExactSandboxSession"),
      wrapper.indexOf("function Get-CapturedSandboxSession"),
    );
    expect(wrapper).toContain("function Test-SandboxSessionIdentityProperties");
    expect(waitHelper).toContain(
      "if ($matches.Count -eq 1 -and (Test-SandboxSessionIdentityProperties -Process $matches[0]))",
    );
    expect(waitHelper).toContain("return ConvertTo-SandboxSessionIdentity -Process $matches[0]");
    expect(wrapper).toContain(
      "$sessionIdentity = Wait-ExactSandboxSession -ConfigPath $configPath",
    );
    expect(wrapper).toContain("Get-CapturedSandboxSession -Identity $sessionIdentity");
    expect(wrapper.match(/Get-ExactSandboxSessions -ConfigPath \$ConfigPath/gu)).toHaveLength(1);
    const capturedHelper = wrapper.slice(
      wrapper.indexOf("function Get-CapturedSandboxSession"),
      wrapper.indexOf("if ($TimeoutSeconds -lt 60)"),
    );
    expect(capturedHelper.match(/return @\(\)/gu)).toHaveLength(2);
    expect(capturedHelper).not.toContain("identity changed before cleanup");
    expect(wrapper).not.toContain('-like "*$configPath*"');
    expect(wrapper).not.toContain(".CommandLine.IndexOf($ConfigPath");
  });

  it("submits the enabled desktop project form through native form semantics", async () => {
    const runner = await readFile(
      join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"),
      "utf8",
    );
    const helperStart = runner.indexOf("async function openDesktopProject");
    const helperEnd = runner.indexOf("\nconst args = parseArguments", helperStart);
    const helper = runner.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(helper).toContain("form instanceof HTMLFormElement");
    expect(helper).toContain("button instanceof HTMLButtonElement && !button.disabled");
    expect(helper).toContain("form.requestSubmit(button);");
    expect(helper).not.toContain("client.clickElement(projectOpenButton)");
  });

  it("wires the M4 helper after N2 with real cleanup and hashed Sandbox staging", async () => {
    const [runner, wrapper] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"), "utf8"),
    ]);
    expect(runner).toContain('from "./lib/m4-packaged-walkthrough.mjs"');
    expect(runner).toContain("execute/async");
    const n2 = runner.indexOf("const n2SoakSummary = await runN2Soak");
    const m4 = runner.indexOf("await runM4PackagedWalkthrough");
    const m4Cleanup = runner.indexOf('await record("m4-ai-sensitive-state-scanned"');
    const m4Final = runner.indexOf('await record("m4-final-artifacts-verified", finalM4Verification)');
    const credential = runner.indexOf("const syntheticSecret = `SCADMILL-OS-CREDENTIAL-");
    expect(n2).toBeGreaterThanOrEqual(0);
    expect(m4).toBeGreaterThan(n2);
    expect(m4Cleanup).toBeGreaterThan(m4);
    expect(m4Final).toBeGreaterThan(m4Cleanup);
    expect(credential).toBeGreaterThan(m4);
    expect(runner).toContain('join(process.env.USERPROFILE, "Documents", "ScadMillM4Walkthrough")');
    expect(runner).toContain('setControl(client, "MCP write-file permission", "deny")');
    expect(runner).toContain("writeFile(m4EvidencePath,");
    expect(runner).toContain("JSON.stringify(m4Evidence, null, 2)");
    expect(runner).toContain('aiConversationMode: "hosted-plus-manual"');
    expect(runner).toContain("m4McpLocalSource = sourceBefore");
    expect(runner).toContain("{ local: m4McpLocalSource, proposed: m4McpSource }");
    expect(runner).toContain('clickButton(client, "Clear AI key")');
    expect(runner).toContain('setControl(client, "AI provider", "none")');
    expect(runner).toContain("m4SecretScan");
    expect(runner).toContain("restartApplication: async (expectedSource, expectedProjectPath) => {");
    expect(runner).toContain('assert.equal(savedSource, expectedSource, "M4 restart source differs from the helper\'s cold-cache source.");');
    expect(runner).toContain('(await readFile(m4ProjectFile, "utf8")) === expectedSource');
    expect(runner).toContain("M4_DOM_SCRIPTS.thumbnailSnapshot");
    expect(runner).toContain("beforeCloseThumbnailSha256");
    expect(runner).toContain("beforeCloseThumbnailRenderIdentity");
    expect(runner).toContain("persistedThumbnailSha256");
    expect(runner).toContain("persistedThumbnailRenderIdentity");
    expect(runner).not.toContain(["expectedThumbnailRenderIdentity: `sha256:$", "{fingerprint(stlBytes).toLowerCase()}`"].join(""));
    expect(runner).not.toContain("expectedThumbnailRenderIdentity:");
    expect(runner).toContain("await openDesktopProject(client, m4ProjectDirectory, expectedSource);");
    const restartBlock = runner.indexOf("restartApplication: async (expectedSource, expectedProjectPath) => {");
    const preExitThumbnail = runner.indexOf("const beforeCloseThumbnail =", restartBlock);
    const processExit = runner.indexOf("await client.deleteSession();", restartBlock);
    const postRestartThumbnail = runner.indexOf("const persistedThumbnail =", restartBlock);
    const projectReopen = runner.indexOf("await openDesktopProject(client, m4ProjectDirectory, expectedSource);", restartBlock);
    expect(restartBlock).toBeGreaterThan(-1);
    expect(preExitThumbnail).toBeLessThan(processExit);
    expect(processExit).toBeLessThan(postRestartThumbnail);
    expect(postRestartThumbnail).toBeLessThan(projectReopen);
    expect(runner).toContain('await clickButton(client, "Save active file");\n  await waitFor(async () => (await readFile(m4ProjectFile, "utf8")) === m4InitialSource');
    expect(wrapper).toContain('Copy-Item -LiteralPath (Join-Path $repo "scripts\\lib\\m4-packaged-walkthrough.mjs")');
    expect(wrapper).toContain('Copy-Item -LiteralPath (Join-Path $repo "scripts\\lib\\m4-packaged-verifier.mjs")');
    expect(wrapper).toContain('m4PackagedWalkthrough = [ordered]@{ path = "scripts/lib/m4-packaged-walkthrough.mjs"');
    expect(wrapper).toContain('m4PackagedVerifier = [ordered]@{ path = "scripts/lib/m4-packaged-verifier.mjs"');
    expect(wrapper).toContain("$hostM4Output = @(& $nodePath $retainedM4Verifier @hostM4Arguments 2>&1)");
    expect(runner).toContain('await record("m4-final-artifacts-verified", finalM4Verification)');
  });

  it("limits packaged actions to visible controls and activates activity rails idempotently", async () => {
    const runner = await readFile(
      join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"),
      "utf8",
    );
    const helpers = runner.slice(
      runner.indexOf("async function clickButton"),
      runner.indexOf("async function clearDiagnosticConsole"),
    );
    expect(helpers).toContain("element.getClientRects().length > 0");
    expect(helpers).toContain("async function activateRail");
    expect(helpers).toContain("button.getAttribute('aria-pressed') !== 'true'");
    expect(helpers).toContain("visible activity rail");
    expect(runner).toContain("if (await setVisibleEnabledTextArea(client, label, value)) return");
    expect(runner).toContain("await setVisibleEnabledControl(client, label, value)");
    expect(runner).toContain("await clickVisibleEnabledButton(client, text)");
    expect(helpers.match(/getClientRects\(\)\.length > 0/gu)?.length).toBeGreaterThanOrEqual(5);
    const m4 = runner.slice(runner.indexOf("const m4InitialSource"));
    expect(m4).not.toContain('clickAria(client, "History")');
    expect(m4).not.toContain('clickAria(client, "Files")');
    expect(runner).toContain('activateRail: (title) => activateRail(client, title)');
  });

  it("waits within one bound for a delayed visible enabled button", async () => {
    let attempts = 0;
    const delays: number[] = [];
    await clickVisibleEnabledButton({
      execute: async (script: string, args: readonly unknown[]) => {
        expect(script).toBe(CLICK_PACKAGED_BUTTON_SCRIPT);
        expect(args).toEqual(["Apply hunk choices"]);
        attempts += 1;
        return attempts === 3;
      },
    }, "Apply hunk choices", {
      timeoutMs: 1_000,
      intervalMs: 25,
      delayImpl: async (milliseconds: number) => { delays.push(milliseconds); },
    });
    expect(attempts).toBe(3);
    expect(delays).toEqual([25, 25]);
  });

  it("sets exactly one visible enabled control through its native wrapping label", () => {
    const window = new Window();
    const run = window.eval(`(function(label, value) {${SET_PACKAGED_CONTROL_VALUE_SCRIPT}})`) as (
      label: string,
      value: string,
    ) => unknown;
    const visible = (element: object) => {
      Object.defineProperty(element, "getClientRects", {
        configurable: true,
        value: () => [{ width: 10, height: 10 }],
      });
    };
    const mount = (markup: string) => {
      window.document.body.innerHTML = markup;
      for (const label of window.document.querySelectorAll("label")) visible(label);
    };

    mount('<label>Message<textarea></textarea></label>');
    const textarea = window.document.querySelector("textarea");
    if (!textarea) throw new Error("Visible textarea fixture was not created.");
    visible(textarea);
    expect(run("Message", "hello")).toBe("hello");
    expect(textarea.value).toBe("hello");

    mount('<label>Message<textarea style="display:none"></textarea></label>');
    expect(run("Message", "hidden")).toBeNull();

    mount("<label>Message<textarea disabled></textarea></label>");
    const disabled = window.document.querySelector("textarea");
    if (!disabled) throw new Error("Disabled textarea fixture was not created.");
    visible(disabled);
    expect(run("Message", "disabled")).toBeNull();

    mount("<label>Message<textarea></textarea><input></label>");
    for (const control of window.document.querySelectorAll("textarea, input")) visible(control);
    expect(run("Message", "ambiguous")).toBeNull();

    window.close();
  });

  it("resolves exactly one visible enabled wrapping-label textarea", () => {
    const window = new Window();
    const find = window.eval(`(function(label) {${FIND_PACKAGED_TEXTAREA_CONTROL_SCRIPT}})`) as (
      label: string,
    ) => unknown;
    const visible = (element: object) => Object.defineProperty(element, "getClientRects", {
      configurable: true,
      value: () => [{ width: 10, height: 10 }],
    });
    window.document.body.innerHTML = "<label>Message<textarea></textarea></label>";
    for (const element of window.document.querySelectorAll("label, textarea")) visible(element);
    expect(find("Message")).toBe(window.document.querySelector("textarea"));

    window.document.body.insertAdjacentHTML("beforeend", `
      <label>Message<textarea disabled></textarea></label>
      <label>Message<textarea style="display:none"></textarea></label>
    `);
    for (const element of window.document.querySelectorAll("label, textarea")) visible(element);
    expect(find("Message")).toBe(window.document.querySelector("textarea:not([disabled]):not([style])"));

    window.document.body.insertAdjacentHTML("beforeend", "<label>Message<textarea></textarea></label>");
    for (const element of window.document.querySelectorAll("label, textarea")) visible(element);
    expect(find("Message")).toEqual({ kind: "ambiguous", count: 2 });
    window.close();
  });

  it("focuses and verifies the exact resolved packaged textarea", () => {
    const window = new Window();
    const focus = window.eval(`(function(control) {${FOCUS_PACKAGED_TEXTAREA_CONTROL_SCRIPT}})`) as (
      control: unknown,
    ) => {
      targetIsTextarea: boolean;
      targetConnected: boolean;
      targetEnabled: boolean;
      focusedBefore: boolean;
      focused: boolean;
      focusCorrected: boolean;
    };
    window.document.body.innerHTML = "<textarea>existing</textarea><input>";
    const textarea = window.document.querySelector("textarea");
    const input = window.document.querySelector("input");
    if (!textarea || !input) throw new Error("Focus fixtures were not created.");

    input.focus();
    expect(window.document.activeElement).toBe(input);
    expect(focus(textarea)).toEqual({
      targetIsTextarea: true,
      targetConnected: true,
      targetEnabled: true,
      focusedBefore: false,
      focused: true,
      focusCorrected: true,
    });
    expect(window.document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe("existing".length);
    expect(focus(input)).toEqual({
      targetIsTextarea: false,
      targetConnected: true,
      targetEnabled: false,
      focusedBefore: false,
      focused: false,
      focusCorrected: false,
    });
    window.close();
  });

  it("inserts focused text through one bounded loopback CDP page target", async () => {
    const sent: string[] = [];
    const opened: string[] = [];
    let closes = 0;
    class FakeWebSocket {
      readyState = 0;
      listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
      addEventListener(name: string, listener: (event: { data?: unknown }) => void) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
      }
      emit(name: string, event: { data?: unknown } = {}) {
        for (const listener of this.listeners.get(name) ?? []) listener(event);
      }
      send(payload: string) {
        sent.push(payload);
        queueMicrotask(() => this.emit("message", { data: JSON.stringify({
          id: 1,
          result: {
            result: {
              type: "object",
              value: {
                accepted: true, inputDispatched: true, targetReady: true, valueMatches: true,
              },
            },
          },
        }) }));
      }
      close() {
        closes += 1;
        this.readyState = 3;
        queueMicrotask(() => this.emit("close"));
      }
    }
    await insertTextThroughCdp("localhost:49673", "A🧱", "tauri://localhost/", {
      fetchImpl: async (url: string, init: { signal: AbortSignal; redirect: string }) => {
        expect(url).toBe("http://127.0.0.1:49673/json/list");
        expect(init.redirect).toBe("error");
        return new Response(JSON.stringify([{
          type: "page",
          url: "tauri://localhost/",
          webSocketDebuggerUrl: "ws://localhost:49673/devtools/page/exact-target",
        }]));
      },
      webSocketFactory: (url: string) => {
        opened.push(url);
        const socket = new FakeWebSocket();
        queueMicrotask(() => { socket.readyState = 1; socket.emit("open"); });
        return socket;
      },
      timeoutMs: 1_000,
    });
    expect(opened).toEqual(["ws://127.0.0.1:49673/devtools/page/exact-target"]);
    const [command] = sent.map((payload) => JSON.parse(payload));
    expect(command).toMatchObject({
      id: 1,
      method: "Runtime.evaluate",
      params: { returnByValue: true },
    });
    expect(command.params.expression).toContain("document.execCommand('insertText'");
    expect(command.params.expression).toContain("new InputEvent('input'");
    expect(command.params.expression).toContain(JSON.stringify("A🧱"));
    expect(closes).toBe(1);
  });

  it("rejects a CDP editing command that did not update the focused textarea", async () => {
    class RejectedEditingWebSocket {
      listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
      addEventListener(name: string, listener: (event: { data?: unknown }) => void) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
      }
      emit(name: string, event: { data?: unknown } = {}) {
        for (const listener of this.listeners.get(name) ?? []) listener(event);
      }
      send() {
        queueMicrotask(() => this.emit("message", { data: JSON.stringify({
          id: 1,
          result: {
            result: {
              type: "object",
              value: {
                accepted: false, inputDispatched: true, targetReady: true, valueMatches: false,
              },
            },
          },
        }) }));
      }
      close() { queueMicrotask(() => this.emit("close")); }
    }
    await expect(insertTextThroughCdp("localhost:9222", "value", "tauri://localhost/", {
      fetchImpl: async () => new Response(JSON.stringify([{
        type: "page", url: "tauri://localhost/",
        webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/target",
      }])),
      webSocketFactory: () => {
        const socket = new RejectedEditingWebSocket();
        queueMicrotask(() => socket.emit("open"));
        return socket;
      },
      timeoutMs: 1_000,
    })).rejects.toThrow("invalid result");
  });

  it("rejects remote, cross-port, and ambiguous CDP discovery before opening a socket", async () => {
    let sockets = 0;
    const webSocketFactory = () => { sockets += 1; throw new Error("must not open"); };
    await expect(insertTextThroughCdp("example.com:9222", "value", "tauri://localhost/", {
      fetchImpl: async () => new Response("[]"), webSocketFactory,
    })).rejects.toThrow("loopback");
    await expect(insertTextThroughCdp("localhost:9222", "value", "tauri://localhost/", {
      fetchImpl: async () => new Response(JSON.stringify([{
        type: "page", url: "tauri://localhost/",
        webSocketDebuggerUrl: "ws://localhost:9223/devtools/page/other-port",
      }])),
      webSocketFactory,
    })).rejects.toThrow("target");
    await expect(insertTextThroughCdp("localhost:9222", "value", "tauri://localhost/", {
      fetchImpl: async () => new Response(JSON.stringify([
        { type: "page", url: "tauri://localhost/", webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/one" },
        { type: "page", url: "tauri://localhost/", webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/two" },
      ])),
      webSocketFactory,
    })).rejects.toThrow("exactly one");
    await expect(insertTextThroughCdp("localhost:9222", "value", "tauri://localhost/", {
      fetchImpl: async () => new Response(JSON.stringify([{
        type: "page", url: "https://unrelated.invalid/",
        webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/wrong-page",
      }])),
      webSocketFactory,
    })).rejects.toThrow("current WebView");
    expect(sockets).toBe(0);
  });

  it("closes CDP and hashes protocol errors without retaining inserted text or messages", async () => {
    const sensitiveText = "DO-NOT-LOG-inserted-message";
    const sensitiveProtocolMessage = "DO-NOT-LOG-protocol-message";
    let closes = 0;
    class ErrorWebSocket {
      readyState = 0;
      listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
      addEventListener(name: string, listener: (event: { data?: unknown }) => void) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
      }
      emit(name: string, event: { data?: unknown } = {}) {
        for (const listener of this.listeners.get(name) ?? []) listener(event);
      }
      send() {
        queueMicrotask(() => this.emit("message", { data: JSON.stringify({
          id: 1, error: { code: -32000, message: sensitiveProtocolMessage },
        }) }));
      }
      close() {
        closes += 1;
        this.readyState = 3;
        queueMicrotask(() => this.emit("close"));
      }
    }
    const failure = await insertTextThroughCdp("127.0.0.1:9222", sensitiveText, "tauri://localhost/", {
      fetchImpl: async () => new Response(JSON.stringify([{
        type: "page", url: "tauri://localhost/",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/target",
      }])),
      webSocketFactory: () => {
        const socket = new ErrorWebSocket();
        queueMicrotask(() => { socket.readyState = 1; socket.emit("open"); });
        return socket;
      },
      timeoutMs: 1_000,
    }).then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("-32000");
    expect((failure as Error).message).not.toContain(sensitiveText);
    expect((failure as Error).message).not.toContain(sensitiveProtocolMessage);
    expect(closes).toBe(1);
  });

  it("rejects malformed CDP errors and oversized text before unsafe continuation", async () => {
    let fetches = 0;
    await expect(insertTextThroughCdp("localhost:9222", "x".repeat(8_193), "tauri://localhost/", {
      fetchImpl: async () => { fetches += 1; return new Response("[]"); },
    })).rejects.toThrow("byte limit");
    expect(fetches).toBe(0);

    class MalformedErrorWebSocket {
      listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
      addEventListener(name: string, listener: (event: { data?: unknown }) => void) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
      }
      emit(name: string, event: { data?: unknown } = {}) {
        for (const listener of this.listeners.get(name) ?? []) listener(event);
      }
      send() {
        queueMicrotask(() => this.emit("message", { data: JSON.stringify({
          id: 1, error: "malformed", result: {},
        }) }));
      }
      close() { queueMicrotask(() => this.emit("close")); }
    }
    await expect(insertTextThroughCdp("localhost:9222", "value", "tauri://localhost/", {
      fetchImpl: async () => new Response(JSON.stringify([{
        type: "page", url: "tauri://localhost/",
        webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/target",
      }])),
      webSocketFactory: () => {
        const socket = new MalformedErrorWebSocket();
        queueMicrotask(() => socket.emit("open"));
        return socket;
      },
      timeoutMs: 1_000,
    })).rejects.toThrow("error response");
  });

  it("closes CDP when socket listener setup fails", async () => {
    let closes = 0;
    const sensitiveSetupError = "DO-NOT-LOG-listener-setup-secret";
    const failure = await insertTextThroughCdp("localhost:9222", "value", "tauri://localhost/", {
      fetchImpl: async () => new Response(JSON.stringify([{
        type: "page", url: "tauri://localhost/",
        webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/target",
      }])),
      webSocketFactory: () => ({
        addEventListener: () => { throw new Error(sensitiveSetupError); },
        send: () => undefined,
        close: () => { closes += 1; },
      }),
      timeoutMs: 1_000,
    }).then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("listener setup failed");
    expect((failure as Error).message).not.toContain(sensitiveSetupError);
    expect(closes).toBe(1);
  });

  it("waits for bounded CDP close acknowledgement", async () => {
    class DeferredCloseWebSocket {
      listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
      addEventListener(name: string, listener: (event: { data?: unknown }) => void) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
      }
      emit(name: string, event: { data?: unknown } = {}) {
        for (const listener of this.listeners.get(name) ?? []) listener(event);
      }
      send() {
        queueMicrotask(() => this.emit("message", { data: JSON.stringify({
          id: 1,
          result: {
            result: {
              type: "object",
              value: {
                accepted: true, inputDispatched: true, targetReady: true, valueMatches: true,
              },
            },
          },
        }) }));
      }
      close() { /* the test controls acknowledgement */ }
    }
    const socket = new DeferredCloseWebSocket();
    let resolved = false;
    const insertion = insertTextThroughCdp("localhost:9222", "value", "tauri://localhost/", {
      fetchImpl: async () => new Response(JSON.stringify([{
        type: "page", url: "tauri://localhost/",
        webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/target",
      }])),
      webSocketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        return socket;
      },
      timeoutMs: 1_000,
    }).then(() => { resolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(false);
    socket.emit("close");
    await insertion;
    expect(resolved).toBe(true);

    const timeoutSocket = new DeferredCloseWebSocket();
    const lease = createCdpSocketLease();
    await expect(insertTextThroughCdp("localhost:9222", "value", "tauri://localhost/", {
      fetchImpl: async () => new Response(JSON.stringify([{
        type: "page", url: "tauri://localhost/",
        webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/target",
      }])),
      webSocketFactory: () => {
        queueMicrotask(() => timeoutSocket.emit("open"));
        return timeoutSocket;
      },
      onSocketCreated: (socket) => lease.register(socket),
      onSocketClosed: (socket) => lease.release(socket),
      timeoutMs: 25,
    })).rejects.toThrow("cleanup timed out");
    expect(lease.hasActive()).toBe(true);
    lease.closeActive();
    expect(lease.hasActive()).toBe(false);
  });

  it("clears a retained CDP socket even when authoritative close throws", () => {
    const lease = createCdpSocketLease();
    let closes = 0;
    lease.register({
      addEventListener: () => undefined,
      send: () => undefined,
      close: () => { closes += 1; throw new Error("close failed"); },
    });
    expect(() => lease.closeActive()).toThrow("close failed");
    expect(closes).toBe(1);
    expect(lease.hasActive()).toBe(false);
  });

  it("enters controlled textarea content through CDP before proving committed reads", async () => {
    const elementKey = "element-6066-11e4-a52e-4f735466cecf";
    const calls: string[] = [];
    let reads = 0;
    const client = {
      execute: async (script: string, args: readonly unknown[]) => {
        if (script === FIND_PACKAGED_TEXTAREA_CONTROL_SCRIPT) return { [elementKey]: "message-1" };
        if (script === FOCUS_PACKAGED_TEXTAREA_CONTROL_SCRIPT) {
          expect(args).toEqual([{ [elementKey]: "message-1" }]);
          return {
            targetIsTextarea: true,
            targetConnected: true,
            targetEnabled: true,
            focusedBefore: true,
            focused: true,
            focusCorrected: false,
          };
        }
        if (script === READ_PACKAGED_PAGE_URL_SCRIPT) return "tauri://localhost/";
        expect(script).toBe(READ_PACKAGED_CONTROL_VALUE_SCRIPT);
        expect(args).toEqual(["Message"]);
        reads += 1;
        return "Change the cube.";
      },
      clickElement: async (id: string) => { calls.push(`click:${id}`); },
      insertFocusedText: async (text: string, pageUrl: string) => { calls.push(`insert:${pageUrl}:${text}`); },
    };

    await expect(setVisibleEnabledTextArea(client, "Message", "Change the cube.", {
      timeoutMs: 1_000,
      intervalMs: 25,
      delayImpl: async () => undefined,
    })).resolves.toBe(true);
    expect(reads).toBe(2);
    expect(calls).toEqual([
      "click:message-1",
      "insert:tauri://localhost/:Change the cube.",
    ]);
  });

  it("propagates CDP textarea insertion failure", async () => {
    const elementKey = "element-6066-11e4-a52e-4f735466cecf";
    let released = 0;
    await expect(setVisibleEnabledTextArea({
      execute: async (script: string) => script === FIND_PACKAGED_TEXTAREA_CONTROL_SCRIPT
        ? { [elementKey]: "message-1" }
        : script === READ_PACKAGED_PAGE_URL_SCRIPT
          ? "tauri://localhost/"
          : {
            targetIsTextarea: true, targetConnected: true, targetEnabled: true,
            focusedBefore: true, focused: true, focusCorrected: false,
          },
      clickElement: async () => undefined,
      insertFocusedText: async () => { released += 1; throw new Error("CDP insertion failed"); },
    }, "Message", "value")).rejects.toThrow("CDP insertion failed");
    expect(released).toBe(1);
  });

  it("fails before keyboard entry when WebDriver cannot focus the resolved textarea", async () => {
    const elementKey = "element-6066-11e4-a52e-4f735466cecf";
    let keyboardCalls = 0;
    const sensitiveLabel = "DO-NOT-LOG-secret-project-path-or-token";
    const failure = await setVisibleEnabledTextArea({
      execute: async (script: string) => script === FIND_PACKAGED_TEXTAREA_CONTROL_SCRIPT
        ? { [elementKey]: "message-1" }
        : {
            targetIsTextarea: true, targetConnected: true, targetEnabled: true,
            focusedBefore: false, focused: false, focusCorrected: false,
            activeAriaLabel: sensitiveLabel,
          },
      clickElement: async () => undefined,
      insertFocusedText: async () => { keyboardCalls += 1; },
    }, "Message", "value").then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("focus");
    expect((failure as Error).message).not.toContain(sensitiveLabel);
    expect(keyboardCalls).toBe(0);
  });

  it("wires verified Windows input through the packaged WebDriver client", async () => {
    const [runner, wrapper, bootstrap, keyboardInput] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "run-packaged-desktop-evidence.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "windows", "run-packaged-desktop-evidence.ps1"), "utf8"),
      readFile(join(process.cwd(), "scripts", "windows", "run-packaged-desktop-sandbox.ps1"), "utf8"),
      readFile(join(process.cwd(), "scripts", "windows", "send-unicode-input.ps1"), "utf8"),
    ]);

    expect(runner).toContain('client.bindApplicationProcess(lastVerifiedAppProcess?.pid)');
    expect(runner).toContain('run("powershell.exe", [');
    expect(runner).toContain('"-File", this.keyboardInputPath');
    expect(runner).toContain('const minimumSent = 4 + text.length * 2;');
    expect(runner).toContain('const maximumSent = 4 + text.length * 4;');
    expect(runner).not.toContain("insertTextThroughCdp(this.debuggerAddress");
    expect(wrapper).toContain('scripts\\windows\\send-unicode-input.ps1');
    expect(wrapper).toContain('keyboardInput = [ordered]@{ path = "scripts/send-unicode-input.ps1"');
    expect(bootstrap).toContain('"--keyboard-input", "$local\\scripts\\send-unicode-input.ps1"');
    expect(keyboardInput).toContain("SendInput");
    expect(keyboardInput).toContain("SetForegroundWindow");
    expect(keyboardInput).toContain("VkKeyScanEx");
    expect(keyboardInput).toContain("AddPhysicalCharacter");
    expect(keyboardInput).toContain("GetKeyboardLayout(windowThreadId)");
    expect(keyboardInput).not.toContain("KEYEVENTF_UNICODE");
    expect(keyboardInput).not.toContain("Write-Host $text");
  });

  it("rejects invalid control wait options before any UI mutation", async () => {
    let genericCalls = 0;
    await expect(setVisibleEnabledControl({
      execute: async () => { genericCalls += 1; return "value"; },
    }, "AI model", "value", { timeoutMs: 0 })).rejects.toThrow("wait options");
    expect(genericCalls).toBe(0);

    let textareaCalls = 0;
    await expect(setVisibleEnabledTextArea({
      execute: async () => { textareaCalls += 1; return { kind: "absent" }; },
      clickElement: async () => { textareaCalls += 1; },
      insertFocusedText: async () => { textareaCalls += 1; },
    }, "Message", "value", { intervalMs: 10_001 })).rejects.toThrow("wait options");
    expect(textareaCalls).toBe(0);
  });

  it("waits for the controlled value to survive a UI commit before continuing", async () => {
    const calls: string[] = [];
    let reads = 0;
    const endpoint = "http://127.0.0.1:42123/api/chat";
    const observedValues = [endpoint, "https://late-react-commit.example/api", endpoint, endpoint];
    await setVisibleEnabledControl({
      execute: async (script: string, args: readonly unknown[]) => {
        calls.push(script);
        if (script === SET_PACKAGED_CONTROL_VALUE_SCRIPT) {
          expect(args).toEqual(["AI endpoint", endpoint]);
          return args[1];
        }
        expect(script).toBe(READ_PACKAGED_CONTROL_VALUE_SCRIPT);
        expect(args).toEqual(["AI endpoint"]);
        reads += 1;
        return observedValues.shift();
      },
    }, "AI endpoint", endpoint, {
      timeoutMs: 1_000,
      intervalMs: 25,
      delayImpl: async () => undefined,
    });

    expect(calls[0]).toBe(SET_PACKAGED_CONTROL_VALUE_SCRIPT);
    expect(reads).toBe(4);
    expect(calls.slice(1)).toEqual(Array.from({ length: 4 }, () => READ_PACKAGED_CONTROL_VALUE_SCRIPT));
  });

  it("requires an exact isolated-Sandbox harness manifest", () => {
    const sha256 = "ab".repeat(32);
    const manifest = {
      schemaVersion: 1,
      files: {
        config: { path: "scadmill-packaged-evidence.wsb", sha256 },
        credentialProbe: { path: "scripts/credential-probe.ps1", sha256 },
        keyboardInput: { path: "scripts/send-unicode-input.ps1", sha256 },
        helper: { path: "scripts/lib/packaged-desktop-evidence.mjs", sha256 },
        m4PackagedWalkthrough: { path: "scripts/lib/m4-packaged-walkthrough.mjs", sha256 },
        m4PackagedVerifier: { path: "scripts/lib/m4-packaged-verifier.mjs", sha256 },
        n2SoakConfiguration: { path: "scripts/n2-soak-config.json", sha256 },
        n2SoakEvidence: { path: "scripts/lib/n2-soak-evidence.mjs", sha256 },
        n2SoakRunner: { path: "scripts/lib/n2-soak-runner.mjs", sha256 },
        n2SoakVerifier: { path: "scripts/lib/n2-soak-verifier.mjs", sha256 },
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
