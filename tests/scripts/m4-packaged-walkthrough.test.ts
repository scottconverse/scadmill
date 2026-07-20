import { request as requestHttp } from "node:http";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type {
  M4PackagedAutomation,
  M4RawAiTranscriptRecord,
} from "../../scripts/lib/m4-packaged-walkthrough.mjs";
import {
  inspectM4Png,
  M4_DOM_SCRIPTS,
  runM4PackagedWalkthrough,
  startScriptedM4LocalProviderMock,
  validateM4RawTranscriptSemantics,
  validateM4ZeroNetworkAttempts,
} from "../../scripts/lib/m4-packaged-walkthrough.mjs";
import { messages } from "../../src/messages/en";

function fixtureCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.byteLength);
  output.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(output, 4);
  Buffer.from(data).copy(output, 8);
  output.writeUInt32BE(fixtureCrc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength);
  return output;
}

function validRgbaPng(width = 240, height = 160): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const pixels = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row += 1) pixels[row * (1 + width * 4)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const PNG = validRgbaPng();

function pngBase64(): string {
  return PNG.toString("base64");
}

describe("M4 packaged newcomer walkthrough", () => {
  it("serves the exact seven-response local-provider script on loopback with CORS", async () => {
    const secret = "bounded-m4-provider-secret";
    const mock = await startScriptedM4LocalProviderMock({
      proposalSource: "cube([12, 10, 10]);\n",
      agentSource: "cube([14, 10, 10]);\n",
      cappedRounds: 2,
      secret,
    });
    try {
      expect(new URL(mock.endpoint).hostname).toBe("127.0.0.1");
      const options = await fetch(mock.endpoint, {
        method: "OPTIONS",
        headers: { "access-control-request-private-network": "true" },
      });
      expect(options.status).toBe(204);
      expect(options.headers.get("access-control-allow-origin")).toBe("*");
      expect(options.headers.get("access-control-allow-private-network")).toBe("true");

      const selected: Array<string | null> = [];
      for (let ordinal = 1; ordinal <= 7; ordinal += 1) {
        const response = await fetch(mock.endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: "m4-local",
            stream: true,
            messages: [
              { role: "system", content: "<current-file>\ncube(10);\n</current-file>" },
              { role: "user", content: `turn ${ordinal}` },
            ],
            ...(ordinal === 1 ? {} : { tools: [
              { type: "function", function: { name: "render_preview" } },
              { type: "function", function: { name: "get_diagnostics" } },
              { type: "function", function: { name: "write_file" } },
            ] }),
          }),
        });
        expect(response.status).toBe(200);
        const line = JSON.parse((await response.text()).trim()) as { message?: { tool_calls?: Array<{ function?: { name?: string } }> } };
        selected.push(line.message?.tool_calls?.[0]?.function?.name ?? null);
      }
      expect(selected).toEqual([null, "render_preview", "get_diagnostics", "write_file", null, "render_preview", "render_preview"]);
      const overflow = await fetch(mock.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "m4-local", stream: true, messages: [{ role: "user", content: "overflow" }] }),
      });
      expect(overflow.status).toBe(409);
    } finally {
      const [transcript, concurrentTranscript] = await Promise.all([mock.close(), mock.close()]);
      expect(concurrentTranscript).toEqual(transcript);
      await expect(mock.close()).resolves.toEqual(transcript);
      expect(transcript).toHaveLength(7);
      expect(transcript.map(({ ordinal, responseToolName }) => [ordinal, responseToolName])).toEqual([
        [1, null], [2, "render_preview"], [3, "get_diagnostics"], [4, "write_file"],
        [5, null], [6, "render_preview"], [7, "render_preview"],
      ]);
      expect(transcript[0]).toMatchObject({
        method: "POST",
        path: "/api/chat",
        roles: ["system", "user"],
        toolNames: [],
        context: { source: true, diagnostics: false, parameters: false, screenshot: false },
      });
      expect(transcript[1].toolNames).toEqual(["render_preview", "get_diagnostics", "write_file"]);
    }
  });

  it("closes concurrent callers idempotently and forces a held request within its bound", async () => {
    const mock = await startScriptedM4LocalProviderMock({
      proposalSource: "cube(12);",
      agentSource: "cube(14);",
      cappedRounds: 2,
      closeGraceMs: 100,
      secret: "bounded-close-secret",
    });
    const endpoint = new URL(mock.endpoint);
    const held = requestHttp({
      hostname: endpoint.hostname,
      method: "POST",
      path: endpoint.pathname,
      port: endpoint.port,
      headers: { "content-type": "application/json" },
    });
    held.on("error", () => undefined);
    let heldSocket: import("node:net").Socket | undefined;
    let socketClosed: Promise<void> | undefined;
    const connected = new Promise<void>((resolveConnected, rejectConnected) =>
      held.once("socket", (socket) => {
        heldSocket = socket;
        socketClosed = new Promise((resolveClosed) => socket.once("close", resolveClosed));
        if (!socket.connecting) resolveConnected();
        else {
          socket.once("connect", resolveConnected);
          socket.once("error", rejectConnected);
        }
      }));
    held.write("{");
    await connected;
    await mock.waitForRequestStart();
    expect(heldSocket?.destroyed).toBe(false);

    const startedAt = Date.now();
    let settled = false;
    const closing = Promise.all([mock.close(), mock.close()])
      .finally(() => { settled = true; });
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    expect(settled).toBe(false);
    expect(heldSocket?.destroyed).toBe(false);
    const [first, second] = await closing;
    if (!socketClosed) throw new Error("Held M4 mock socket close monitor is unavailable.");
    await Promise.race([
      socketClosed,
      new Promise((_, rejectClosed) => setTimeout(() =>
        rejectClosed(new Error("Held M4 mock socket did not close.")), 250)),
    ]);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(heldSocket?.destroyed).toBe(true);
    expect(first).toEqual([]);
    expect(second).toEqual(first);
    await expect(mock.close()).resolves.toEqual(first);
    held.destroy();
  });

  it("rejects corrupt CRC and deflate bytes and requires IDAT plus terminal IEND", () => {
    const ihdr = PNG.subarray(8, 33);
    const iend = PNG.subarray(PNG.byteLength - 12);
    const noIdat = Buffer.concat([PNG.subarray(0, 8), ihdr, pngChunk("tEXt", Buffer.alloc(20)), iend]);
    const noIend = PNG.subarray(0, PNG.byteLength - 12);
    const corruptCrc = Buffer.from(PNG);
    corruptCrc[29] ^= 0xff;
    const corruptIdat = Buffer.from(PNG);
    const idatType = corruptIdat.indexOf(Buffer.from("IDAT", "ascii"));
    const idatLength = corruptIdat.readUInt32BE(idatType - 4);
    corruptIdat[idatType + 4] = 0;
    corruptIdat.writeUInt32BE(
      fixtureCrc32(corruptIdat.subarray(idatType, idatType + 4 + idatLength)),
      idatType + 4 + idatLength,
    );
    expect(() => inspectM4Png(PNG.subarray(0, 33), "prefix")).toThrow("size");
    expect(() => inspectM4Png(noIdat, "no-idat")).toThrow("IDAT");
    expect(() => inspectM4Png(noIend, "no-iend")).toThrow("IEND");
    expect(() => inspectM4Png(corruptCrc, "bad-crc")).toThrow("CRC");
    expect(() => inspectM4Png(corruptIdat, "bad-idat")).toThrow("decodable");
    expect(inspectM4Png(PNG)).toMatchObject({ width: 240, height: 160, byteLength: PNG.byteLength });
    expect(() => inspectM4Png(validRgbaPng(239, 160), "thumbnail", 256 * 1024, {
      maximumWidth: 4_096,
      maximumHeight: 4_096,
      maximumDecodedBytes: 240 * 160 * 4 + 160,
      exactWidth: 240,
      exactHeight: 160,
    })).toThrow("dimensions");
  });

  it("rejects a small compressed PNG that expands beyond the bounded image budget", () => {
    const expansion = validRgbaPng(1, 4_000_000);
    expect(expansion.byteLength).toBeLessThan(25 * 1024);
    expect(() => inspectM4Png(expansion, "expansion", 256 * 1024)).toThrow(/dimension|decoded size/u);
  });

  it("rejects any unconfigured-AI renderer network attempt", () => {
    expect(() => validateM4ZeroNetworkAttempts({
      rendererAttemptCount: 1,
      tauriInvokeAttemptCount: 0,
      tauriInvokeMonitoring: "installed",
    })).toThrow("network access");
    expect(M4_DOM_SCRIPTS.installNetworkAttemptMonitor).toContain("command === 'ai_http_request'");
    expect(M4_DOM_SCRIPTS.installNetworkAttemptMonitor).toContain("blocked an AI broker request");
    expect(M4_DOM_SCRIPTS.networkAttemptSnapshot).toContain("Object.defineProperty(monitor.tauriInternals, 'invoke', monitor.invokeDescriptor)");
  });

  it("recognizes the current unconfigured-AI security guidance without a send path", () => {
    const target = globalThis as typeof globalThis & { document?: unknown };
    const priorDocument = Object.getOwnPropertyDescriptor(target, "document");
    Object.defineProperty(target, "document", {
      configurable: true,
      value: {
        querySelector: (selector: string) => selector === '[aria-label="AI"]'
          ? {
              textContent: `${messages.aiNotConfigured} ${messages.aiSetupGuidance}`,
              querySelectorAll: () => [],
            }
          : null,
      },
    });
    try {
      expect(new Function(M4_DOM_SCRIPTS.aiUnconfigured)()).toEqual({
        guidanceVisible: true,
        sendCount: 0,
      });
    } finally {
      if (priorDocument) Object.defineProperty(target, "document", priorDocument);
      else Reflect.deleteProperty(target, "document");
    }
  });

  it("keeps renderer monitoring usable when Tauri protects its invoke bridge", () => {
    const target = globalThis as typeof globalThis & {
      __TAURI_INTERNALS__?: { invoke: (...args: unknown[]) => Promise<unknown> };
      __scadmillM4NetworkAttemptMonitor?: unknown;
      XMLHttpRequest?: { prototype: { open: (...args: unknown[]) => unknown } };
    };
    const priorInternals = Object.getOwnPropertyDescriptor(target, "__TAURI_INTERNALS__");
    const priorXmlHttpRequest = Object.getOwnPropertyDescriptor(target, "XMLHttpRequest");
    const priorFetch = target.fetch;
    const XMLHttpRequestFixture = class {
      open(..._args: unknown[]) { return undefined; }
    };
    Object.defineProperty(target, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: XMLHttpRequestFixture,
    });
    const priorOpen = XMLHttpRequestFixture.prototype.open;
    const invoke = async () => undefined;
    const internals = {} as { invoke: (...args: unknown[]) => Promise<unknown> };
    Object.defineProperty(internals, "invoke", {
      configurable: false,
      enumerable: true,
      writable: false,
      value: invoke,
    });
    Object.defineProperty(target, "__TAURI_INTERNALS__", {
      configurable: true,
      writable: true,
      value: internals,
    });
    try {
      const install = new Function(M4_DOM_SCRIPTS.installNetworkAttemptMonitor);
      const snapshot = new Function(M4_DOM_SCRIPTS.networkAttemptSnapshot);
      expect(install()).toEqual({
        rendererAttemptCount: 0,
        tauriInvokeAttemptCount: null,
        tauriInvokeMonitoring: "protected-nonwritable",
      });
      expect(snapshot()).toEqual({
        rendererAttemptCount: 0,
        tauriInvokeAttemptCount: null,
        tauriInvokeMonitoring: "protected-nonwritable",
      });
      expect(internals.invoke).toBe(invoke);
    } finally {
      target.fetch = priorFetch;
      XMLHttpRequestFixture.prototype.open = priorOpen;
      delete target.__scadmillM4NetworkAttemptMonitor;
      if (priorInternals) Object.defineProperty(target, "__TAURI_INTERNALS__", priorInternals);
      else delete target.__TAURI_INTERNALS__;
      if (priorXmlHttpRequest) Object.defineProperty(target, "XMLHttpRequest", priorXmlHttpRequest);
      else Reflect.deleteProperty(target, "XMLHttpRequest");
    }
  });

  it("restores a configurable Tauri invoke accessor exactly after monitoring", () => {
    const target = globalThis as typeof globalThis & {
      __TAURI_INTERNALS__?: { readonly invoke: (...args: unknown[]) => Promise<unknown> };
      __scadmillM4NetworkAttemptMonitor?: unknown;
      XMLHttpRequest?: { prototype: { open: (...args: unknown[]) => unknown } };
    };
    const priorInternals = Object.getOwnPropertyDescriptor(target, "__TAURI_INTERNALS__");
    const priorXmlHttpRequest = Object.getOwnPropertyDescriptor(target, "XMLHttpRequest");
    const priorFetch = target.fetch;
    const XMLHttpRequestFixture = class { open(..._args: unknown[]) { return undefined; } };
    Object.defineProperty(target, "XMLHttpRequest", { configurable: true, writable: true, value: XMLHttpRequestFixture });
    const invoke = async () => undefined;
    const getter = () => invoke;
    const internals = {} as { readonly invoke: (...args: unknown[]) => Promise<unknown> };
    Object.defineProperty(internals, "invoke", { configurable: true, enumerable: true, get: getter });
    const originalDescriptor = Object.getOwnPropertyDescriptor(internals, "invoke");
    Object.defineProperty(target, "__TAURI_INTERNALS__", { configurable: true, writable: true, value: internals });
    try {
      const install = new Function(M4_DOM_SCRIPTS.installNetworkAttemptMonitor);
      const snapshot = new Function(M4_DOM_SCRIPTS.networkAttemptSnapshot);
      expect(install()).toMatchObject({ tauriInvokeMonitoring: "installed", tauriInvokeAttemptCount: 0 });
      expect(snapshot()).toMatchObject({ tauriInvokeMonitoring: "installed", tauriInvokeAttemptCount: 0 });
      expect(Object.getOwnPropertyDescriptor(internals, "invoke")).toEqual(originalDescriptor);
    } finally {
      target.fetch = priorFetch;
      delete target.__scadmillM4NetworkAttemptMonitor;
      if (priorInternals) Object.defineProperty(target, "__TAURI_INTERNALS__", priorInternals);
      else delete target.__TAURI_INTERNALS__;
      if (priorXmlHttpRequest) Object.defineProperty(target, "XMLHttpRequest", priorXmlHttpRequest);
      else Reflect.deleteProperty(target, "XMLHttpRequest");
    }
  });

  it("removes an installed network monitor after a mid-probe walkthrough failure", async () => {
    const initialSource = "cube([10, 10, 10]);";
    let source = initialSource;
    const scripts: string[] = [];
    const observation = {
      rendererAttemptCount: 0,
      tauriInvokeAttemptCount: null,
      tauriInvokeMonitoring: "protected-nonwritable",
    };
    const automation: M4PackagedAutomation = {
      readSource: async () => source,
      replaceSource: async (next) => { source = next; },
      waitForSource: async () => undefined,
      clickAria: async () => undefined,
      clickButton: async () => undefined,
      setControl: async () => undefined,
      setChecked: async () => undefined,
      waitForText: async () => { throw new Error("forced mid-probe failure"); },
      execute: async (script) => { scripts.push(script); return observation; },
      executeAsync: async () => undefined,
      captureScreenshot: async () => PNG,
      startAiMock: async () => ({ endpoint: "http://127.0.0.1:1", model: "unused", secret: "unused" }),
      stopAiMock: async () => [],
      probeMcpDefaultDeny: async () => ({ error: { code: -32001, message: "MCP mutation denied by the current permission gate." }, writeOccurred: false }),
      runMcpAllowSessionJourney: async () => ({
        protocolVersion: "2025-11-25", toolNames: [], preview: { kind: "3d", triangles: 12 },
        diagnostics: { quality: "preview", count: 0 }, pendingReview: { status: "pending_review" }, mutationApproved: true,
      }),
      restartApplication: async () => ({ beforePid: 1, afterPid: 2, freshWebViewProcesses: true }),
    };

    await expect(runM4PackagedWalkthrough({
      automation,
      initialSource,
      proposalSource: "cube([12, 10, 10]);\n",
      agentSource: "cube([14, 10, 10]);\n",
      projectPath: "main.scad",
    })).rejects.toThrow("forced mid-probe failure");
    expect(scripts.filter((script) => script === M4_DOM_SCRIPTS.installNetworkAttemptMonitor)).toHaveLength(1);
    expect(scripts.filter((script) => script === M4_DOM_SCRIPTS.networkAttemptSnapshot)).toHaveLength(1);
    expect(source).toBe(initialSource);
  });

  it("retries cleanup when the first network snapshot transport call rejects", async () => {
    const initialSource = "cube([10, 10, 10]);";
    let source = initialSource;
    let snapshotCalls = 0;
    const observation = {
      rendererAttemptCount: 0,
      tauriInvokeAttemptCount: null,
      tauriInvokeMonitoring: "protected-nonwritable",
    };
    const automation: M4PackagedAutomation = {
      readSource: async () => source,
      replaceSource: async (next) => { source = next; },
      waitForSource: async () => undefined,
      clickAria: async () => undefined,
      clickButton: async () => undefined,
      setControl: async () => undefined,
      setChecked: async () => undefined,
      waitForText: async () => undefined,
      execute: async (script) => {
        if (script === M4_DOM_SCRIPTS.installNetworkAttemptMonitor) return observation;
        if (script === M4_DOM_SCRIPTS.aiUnconfigured) return { guidanceVisible: true, sendCount: 0 };
        if (script === M4_DOM_SCRIPTS.networkAttemptSnapshot) {
          snapshotCalls += 1;
          if (snapshotCalls === 1) throw new Error("first snapshot transport failure");
          return observation;
        }
        return undefined;
      },
      executeAsync: async () => undefined,
      captureScreenshot: async () => PNG,
      startAiMock: async () => ({ endpoint: "http://127.0.0.1:1", model: "unused", secret: "unused" }),
      stopAiMock: async () => [],
      probeMcpDefaultDeny: async () => ({ error: { code: -32001, message: "MCP mutation denied by the current permission gate." }, writeOccurred: false }),
      runMcpAllowSessionJourney: async () => ({
        protocolVersion: "2025-11-25", toolNames: [], preview: { kind: "3d", triangles: 12 },
        diagnostics: { quality: "preview", count: 0 }, pendingReview: { status: "pending_review" }, mutationApproved: true,
      }),
      restartApplication: async () => ({ beforePid: 1, afterPid: 2, freshWebViewProcesses: true }),
    };

    await expect(runM4PackagedWalkthrough({
      automation,
      initialSource,
      proposalSource: "cube([12, 10, 10]);\n",
      agentSource: "cube([14, 10, 10]);\n",
      projectPath: "main.scad",
    })).rejects.toThrow("first snapshot transport failure");
    expect(snapshotCalls).toBe(2);
    expect(source).toBe(initialSource);
  });

  it("proves the ordered C10/C11/cache/delta/animation/thumbnail/restart journey without retaining secrets", async () => {
    const initialSource = "cube([10, 10, 10]);";
    const proposalSource = "cube([12, 10, 10]);\n";
    const agentSource = "cube([14, 10, 10]);\n";
    const secret = "m4-synthetic-secret-never-retain";
    let source = initialSource;
    let sourceReadCount = 0;
    let mockStarted = false;
    let restartCount = 0;
    let consoleRuns = 7;
    let sendCount = 0;
    let thumbnailPhase = "file-tree";
    const calls: string[] = [];
    const contextFixtureSource = "width = 10; // [1:1:20]\necho(m4_missing_context_value);\ncube([width, 10, 10]);";
    const enabledContext = [
      `<current-file>\n${contextFixtureSource}\n</current-file>`,
      "<diagnostics>\nWARNING: Ignoring unknown variable 'm4_missing_context_value' in file main.scad, line 2\n</diagnostics>",
      "<parameters>\nwidth = 10\n</parameters>",
      `<viewer-screenshot>\ndata:image/png;base64,${pngBase64()}\n</viewer-screenshot>`,
    ].join("\n\n");
    const sourceContext = `<current-file>\n${agentSource}\n</current-file>`;
    const renderToolResult = JSON.stringify({ kind: "3d", stats: { triangles: 12 }, diagnostics: [] });
    const diagnosticToolResult = JSON.stringify({ renderId: "m4-agent-render", quality: "preview", diagnostics: [] });
    const request = (messages: readonly Record<string, unknown>[]) => JSON.stringify({ model: "m4-local", stream: true, messages });

    const transcript: M4RawAiTranscriptRecord[] = [
      {
        ordinal: 1,
        method: "POST",
        path: "/api/chat",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        requestBody: request([{ role: "system", content: enabledContext }, { role: "user", content: "change cube" }]),
        responseBody: JSON.stringify({ message: { role: "assistant", content: proposalSource } }),
        roles: ["system", "user"],
        toolNames: [],
        responseToolName: null,
        context: { source: true, diagnostics: true, parameters: true, screenshot: true },
      },
      {
        ordinal: 2,
        method: "POST",
        path: "/api/chat",
        headers: { authorization: `Bearer ${secret}` },
        requestBody: request([{ role: "system", content: "agent" }, { role: "user", content: "run tools" }]),
        responseBody: JSON.stringify({ tool: "render_preview", image: "data:image/png;base64,SECRET" }),
        roles: ["system", "user"],
        toolNames: ["render_preview", "get_diagnostics", "write_file"],
        responseToolName: "render_preview",
        context: { source: false, diagnostics: false, parameters: false, screenshot: false },
      },
      {
        ordinal: 3,
        method: "POST",
        path: "/api/chat",
        headers: { authorization: `Bearer ${secret}` },
        requestBody: request([{ role: "system", content: "agent" }, { role: "user", content: "run tools" }, { role: "assistant", content: "" }, { role: "tool", tool_name: "render_preview", content: renderToolResult }]),
        responseBody: JSON.stringify({ tool: "get_diagnostics" }),
        roles: ["system", "user", "assistant", "tool"],
        toolNames: ["render_preview", "get_diagnostics", "write_file"],
        responseToolName: "get_diagnostics",
        context: { source: false, diagnostics: false, parameters: false, screenshot: false },
      },
      {
        ordinal: 4,
        method: "POST",
        path: "/api/chat",
        headers: { authorization: `Bearer ${secret}` },
        requestBody: request([{ role: "system", content: "agent" }, { role: "user", content: "run tools" }, { role: "tool", tool_name: "render_preview", content: renderToolResult }, { role: "tool", tool_name: "get_diagnostics", content: diagnosticToolResult }]),
        responseBody: JSON.stringify({ tool: "write_file", proposedSha256: "c".repeat(64) }),
        roles: ["system", "user", "assistant", "tool"],
        toolNames: ["render_preview", "get_diagnostics", "write_file"],
        responseToolName: "write_file",
        context: { source: false, diagnostics: false, parameters: false, screenshot: false },
      },
      {
        ordinal: 5,
        method: "POST",
        path: "/api/chat",
        headers: { authorization: `Bearer ${secret}` },
        requestBody: request([{ role: "system", content: "agent" }, { role: "user", content: "run tools" }, { role: "tool", tool_name: "write_file", content: JSON.stringify({ status: "pending_review", commandId: "m4-review" }) }]),
        responseBody: JSON.stringify({ message: { role: "assistant", content: "done" } }),
        roles: ["system", "user", "assistant", "tool"],
        toolNames: ["render_preview", "get_diagnostics", "write_file"],
        responseToolName: null,
        context: { source: false, diagnostics: false, parameters: false, screenshot: false },
      },
      {
        ordinal: 6,
        method: "POST",
        path: "/api/chat",
        headers: { authorization: `Bearer ${secret}` },
        requestBody: request([{ role: "system", content: sourceContext }, { role: "user", content: "loop" }]),
        responseBody: JSON.stringify({ tool: "render_preview" }),
        roles: ["system", "user"],
        toolNames: ["render_preview"],
        responseToolName: "render_preview",
        context: { source: true, diagnostics: false, parameters: false, screenshot: false },
      },
      {
        ordinal: 7,
        method: "POST",
        path: "/api/chat",
        headers: { authorization: `Bearer ${secret}` },
        requestBody: request([{ role: "system", content: sourceContext }, { role: "user", content: "loop" }, { role: "assistant", content: "" }, { role: "tool", tool_name: "render_preview", content: renderToolResult }]),
        responseBody: JSON.stringify({ tool: "render_preview" }),
        roles: ["system", "user", "assistant", "tool"],
        toolNames: ["render_preview"],
        responseToolName: "render_preview",
        context: { source: true, diagnostics: false, parameters: false, screenshot: false },
      },
    ];

    const automation: M4PackagedAutomation = {
      readSource: async () => {
        sourceReadCount += 1;
        return source;
      },
      replaceSource: async (next: string) => {
        calls.push(`source:${next.replaceAll("\n", "\\n")}`);
        source = next;
      },
      waitForSource: async (expected: string) => {
        calls.push(`wait-source:${expected.replaceAll("\n", "\\n")}`);
        expect(source).toBe(expected);
      },
      clickAria: async (label: string) => {
        calls.push(`aria:${label}`);
        if (label === "Close welcome") thumbnailPhase = "file-tree";
      },
      clickButton: async (label: string) => {
        calls.push(`button:${label}`);
        if (label === "Send") {
          sendCount += 1;
          if (sendCount === 2) consoleRuns += 1;
        }
        if (label === "Full render") consoleRuns += 1;
        if (label === "Apply hunk choices") source = proposalSource;
        if (label === "Approve change") source = agentSource;
        if (label === "Welcome") thumbnailPhase = "welcome";
      },
      setControl: async (label: string, value: string) => {
        calls.push(`control:${label}=${value}`);
        if (label === "Animation frame") consoleRuns += 1;
      },
      setChecked: async (label: string, checked: boolean) => { calls.push(`checked:${label}=${checked}`); },
      waitForText: async (text: string) => { calls.push(`wait:${text}`); },
      execute: async (script: string) => {
        if (script === M4_DOM_SCRIPTS.installNetworkAttemptMonitor
          || script === M4_DOM_SCRIPTS.networkAttemptSnapshot) {
          return {
            rendererAttemptCount: 0,
            tauriInvokeAttemptCount: null,
            tauriInvokeMonitoring: "protected-nonwritable",
          };
        }
        if (script === M4_DOM_SCRIPTS.consoleRunCount) return { count: consoleRuns };
        if (script === M4_DOM_SCRIPTS.installAnimationMonitor) return { consoleRuns };
        if (script === M4_DOM_SCRIPTS.focusFileTreeThumbnail) return true;
        if (script === M4_DOM_SCRIPTS.aiUnconfigured) {
          return { guidanceVisible: true, sendCount: 0 };
        }
        if (script === M4_DOM_SCRIPTS.aiProposal) {
          return { acceptedCount: 1, assistantRoles: 1, pendingProposals: 0 };
        }
        if (script === M4_DOM_SCRIPTS.conversationModelSnapshot) {
          return { optionCount: 1, selectedLabel: "Local — m4-local", selectedValue: "model-6d342d6c6f63616c" };
        }
        if (script === M4_DOM_SCRIPTS.renderSnapshot) {
          return {
            status: "Rendered main.scad (3d)",
            geometry: "Geometry baseline established",
            consoleRuns,
            canvasVisible: true,
          };
        }
        if (script === M4_DOM_SCRIPTS.geometrySnapshot) {
          return source.includes("12, 10, 10")
            ? { summary: "Geometry changed: ΔV +200 mm³; Δbounds +2/0/0 mm size; Δtriangles 0", detail: "Geometry changed; Δvolume +200 mm³; Δbounds min 0/0/0 mm, max +2/0/0 mm, size +2/0/0 mm; Δtriangles 0" }
            : { summary: "Geometry unchanged", detail: "Geometry unchanged" };
        }
        if (script === M4_DOM_SCRIPTS.animationSnapshot) {
          return { frame: "Frame 51 of 100", time: "$t 0.50", fps: "24", playLabel: "Play animation", consoleRuns, overlapObserved: false };
        }
        if (script === M4_DOM_SCRIPTS.thumbnailSnapshot) {
          return {
            storageEntries: [{
              key: `scadmill.desktop-render-thumbnails.v1:desktop-project:${"a".repeat(64)}`,
              value: JSON.stringify({
                version: 1,
                records: [{ documentPath: "main.scad", renderIdentity: "b".repeat(64), capturedAt: "2026-07-18T12:00:00.000Z", pngBase64: pngBase64() }],
              }),
            }],
            fileTree: { count: thumbnailPhase === "file-tree" ? 1 : 0, src: thumbnailPhase === "file-tree" ? `data:image/png;base64,${pngBase64()}` : null, complete: true, naturalWidth: 240, naturalHeight: 160, decoded: true },
            welcome: { count: thumbnailPhase === "welcome" ? 1 : 0, src: thumbnailPhase === "welcome" ? `data:image/png;base64,${pngBase64()}` : null, complete: true, naturalWidth: 240, naturalHeight: 160, decoded: true },
          };
        }
        if (script === M4_DOM_SCRIPTS.secretSurfaceSnapshot) {
          return { body: "ordinary UI", consoleText: "", localStorage: "", sessionStorage: "" };
        }
        throw new Error("Unknown DOM script");
      },
      executeAsync: async (script: string) => {
        if (script === M4_DOM_SCRIPTS.thumbnailDecodedSnapshot) {
          return {
            storageEntries: [{
              key: `scadmill.desktop-render-thumbnails.v1:desktop-project:${"a".repeat(64)}`,
              value: JSON.stringify({
                version: 1,
                records: [{ documentPath: "main.scad", renderIdentity: "b".repeat(64), capturedAt: "2026-07-18T12:00:00.000Z", pngBase64: pngBase64() }],
              }),
            }],
            fileTree: { count: thumbnailPhase === "file-tree" ? 1 : 0, src: thumbnailPhase === "file-tree" ? `data:image/png;base64,${pngBase64()}` : null, complete: true, naturalWidth: 240, naturalHeight: 160, decoded: true },
            welcome: { count: thumbnailPhase === "welcome" ? 1 : 0, src: thumbnailPhase === "welcome" ? `data:image/png;base64,${pngBase64()}` : null, complete: true, naturalWidth: 240, naturalHeight: 160, decoded: true },
          };
        }
        if (script === M4_DOM_SCRIPTS.fullRenderCompleted) {
          calls.push("async:full-render");
          const before = consoleRuns;
          consoleRuns += 1;
          return { consoleRunsBefore: before, consoleRunsAfter: consoleRuns, status: "Rendered main.scad (3d)", canvasVisible: true };
        }
        if (script === M4_DOM_SCRIPTS.animationScrubCompleted) {
          calls.push("async:animation-scrub");
          return { consoleRunsBefore: consoleRuns - 1, consoleRunsAfter: consoleRuns, status: "Rendered main.scad (3d)" };
        }
        if (script === M4_DOM_SCRIPTS.animationPlayFrameCompleted) {
          calls.push("async:animation-play");
          const before = consoleRuns;
          consoleRuns += 1;
          return { consoleRunsBefore: before, consoleRunsAfter: consoleRuns, status: "Rendered main.scad (3d)", paused: true, playLabel: "Play animation" };
        }
        expect(script).toBe(M4_DOM_SCRIPTS.cachedPaint);
        calls.push("async:cached-paint");
        return { elapsedMs: 42.25, status: "Rendered main.scad (3d, cached)", consoleRunsBefore: consoleRuns, consoleRunsAfter: consoleRuns, canvasVisible: true };
      },
      captureScreenshot: async (name: string) => {
        calls.push(`screenshot:${name}`);
        return PNG;
      },
      startAiMock: async () => {
        calls.push("ai-mock:start");
        mockStarted = true;
        return { endpoint: "http://127.0.0.1:42123", model: "m4-local", secret };
      },
      stopAiMock: async () => {
        calls.push("ai-mock:stop");
        expect(mockStarted).toBe(true);
        return transcript;
      },
      probeMcpDefaultDeny: async () => {
        calls.push("mcp:deny");
        return { error: { code: -32001, message: "MCP mutation denied by the current permission gate." }, writeOccurred: false };
      },
      runMcpAllowSessionJourney: async () => {
        calls.push("mcp:allow-session");
        return {
          protocolVersion: "2025-11-25",
          toolNames: ["export_model", "get_diagnostics", "get_history", "get_parameters", "list_files", "read_file", "render_preview", "set_parameters", "take_screenshot", "write_file"],
          preview: { kind: "3d", triangles: 12 },
          diagnostics: { quality: "preview", count: 0 },
          pendingReview: { status: "pending_review" },
          mutationApproved: true,
        };
      },
      restartApplication: async (expectedSource: string) => {
        expect(expectedSource).toBe(`${initialSource}\n// M4 thumbnail cold-cache`);
        calls.push("restart");
        restartCount += 1;
        return { beforePid: 100, afterPid: 200, freshWebViewProcesses: true };
      },
    };

    const evidence = await runM4PackagedWalkthrough({
      automation,
      initialSource,
      proposalSource,
      agentSource,
      projectPath: "main.scad",
      cachePaintLimitMs: 100,
    });

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      status: "passed",
      order: ["c10-unconfigured", "c10-proposal", "c10-agent", "c10-agent-cap", "c11-default-deny", "c11-allow-session", "cache", "delta", "animation", "thumbnail", "restart", "source-restored"],
      ai: {
        unconfiguredRequestCount: 0,
        unconfiguredRendererNetworkAttempts: 0,
        unconfiguredTauriInvokeAttempts: null,
        unconfiguredInvokeMonitoring: "protected-nonwritable",
        requestCount: 7,
        proposalAccepted: true,
        agentStatus: "completed",
        capStatus: "capped",
        capToolRounds: 2,
        selectedResponseToolSequence: [null, "render_preview", "get_diagnostics", "write_file", null, "render_preview", "render_preview"],
        contextPatterns: [
          { source: true, diagnostics: true, parameters: true, screenshot: true },
          ...Array.from({ length: 4 }, () => ({ source: false, diagnostics: false, parameters: false, screenshot: false })),
          ...Array.from({ length: 2 }, () => ({ source: true, diagnostics: false, parameters: false, screenshot: false })),
        ],
      },
      mcp: { defaultDenyCode: -32001, mutationApproved: true },
      cache: { baselineConsoleRunsAdded: 1, elapsedMs: 42.25, consoleRunsAdded: 0, restoredAfterRestart: true },
      delta: { unchanged: true, volumeDeltaMm3: 200, boundsDeltaMm: [2, 0, 0] },
      animation: { frame: 51, time: 0.5, scrubConsoleRunsAdded: 1, playConsoleRunsAdded: 1, serialized: true },
      thumbnails: { documentPath: "main.scad", width: 240, height: 160, persistedAcrossRestart: true },
      source: { restoredExactly: true },
    });
    expect(restartCount).toBe(1);
    expect(sourceReadCount).toBeGreaterThan(3);
    expect(source).toBe(initialSource);
    expect(evidence.screenshots.map(({ name }) => name)).toEqual([
      "04a-ai-unconfigured.png",
      "04b-ai-proposal-applied.png",
      "04c-ai-agent-pending-diff.png",
      "04d-cache-geometry-delta.png",
      "04e-animation-frame-51.png",
      "04f-file-tree-thumbnail.png",
      "04g-welcome-recent-thumbnail.png",
      "04h-cold-cache-restored-thumbnail.png",
    ]);
    expect(evidence.screenshots.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256))).toBe(true);

    const retained = JSON.stringify(evidence);
    expect(retained).not.toContain(secret);
    expect(retained).not.toContain(initialSource);
    expect(retained).not.toContain(proposalSource.trim());
    expect(retained).not.toContain(agentSource.trim());
    expect(retained).not.toContain("data:image/png;base64");
    expect(evidence.ai.transcript.records.every((record) => (
      record.authorizationPresent && /^[a-f0-9]{64}$/u.test(record.authorizationSha256)
    ))).toBe(true);
    const tamperedContext = transcript.map((record) => ({ ...record }));
    const tamperedBody = JSON.parse(tamperedContext[0].requestBody) as { messages: Array<{ content: string }> };
    tamperedBody.messages[0].content = tamperedBody.messages[0].content.replace(contextFixtureSource, "cube(999);");
    tamperedContext[0].requestBody = JSON.stringify(tamperedBody);
    expect(() => validateM4RawTranscriptSemantics(tamperedContext, {
      contextFixtureSource,
      agentSource,
      agentConsoleRunsBefore: 1,
      agentConsoleRunsAfter: 2,
    })).toThrow("current-file");
    expect(() => validateM4RawTranscriptSemantics(transcript, {
      contextFixtureSource,
      agentSource,
      agentConsoleRunsBefore: 2,
      agentConsoleRunsAfter: 2,
    })).toThrow("console run");
    expect(calls).toContain("checked:Viewer screenshot=true");
    expect(calls).toContain("checked:Current file=false");
    expect(calls).toContain("checked:Diagnostics=false");
    expect(calls).toContain("checked:Parameters=false");
    expect(calls.indexOf("mcp:deny")).toBeLessThan(calls.indexOf("mcp:allow-session"));
    expect(calls.indexOf("mcp:allow-session")).toBeLessThan(calls.indexOf("async:cached-paint"));
    expect(calls).not.toContain("aria:Pause animation");
    expect(calls.at(-2)).toBe("ai-mock:stop");
    expect(calls.at(-1)).toBe(`source:${initialSource}`);
  });
});
