import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  type M4RawAiTranscriptRecord,
  sanitizeAiTranscript,
  startScriptedM4LocalProviderMock,
} from "../../scripts/lib/m4-packaged-walkthrough.mjs";
import { dismissWelcome } from "./helpers/welcome";

const INITIAL_SOURCE = "cube([10, 10, 10]);";
const CHANGED_SOURCE = "cube([12, 10, 10]);";
const ANIMATED_SOURCE = "cube([10 + (2 * $t), 10, 10]);";
const PROPOSAL_SOURCE = "cube([14, 10, 10]); // accepted hosted AI proposal";
const APPLIED_PROPOSAL_SOURCE = `${PROPOSAL_SOURCE}\n`;
const AGENT_SOURCE = "cube([16, 10, 10]); // approved hosted agent proposal";
const SYNTHETIC_SECRET = "scadmill-m4-hosted-synthetic-secret";

async function editorSource(page: Page): Promise<string> {
  return (await page.locator(
    ".editor-panel .editor-group-focused .cm-line",
  ).allTextContents()).join("\n");
}

async function replaceEditorSource(page: Page, source: string): Promise<void> {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(source);
  await expect.poll(() => editorSource(page)).toBe(source);
}

async function enterMessageThroughBrowserEditing(message: Locator, text: string): Promise<void> {
  const result = await message.evaluate((node, value) => {
    if (!(node instanceof HTMLTextAreaElement) || node.disabled) {
      return { accepted: false, inputDispatched: false, targetReady: false, valueMatches: false };
    }
    node.focus();
    node.setSelectionRange(0, node.value.length);
    const accepted = document.execCommand("insertText", false, value);
    const inputDispatched = node.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      data: value,
      inputType: "insertText",
    }));
    return {
      accepted,
      inputDispatched,
      targetReady: document.activeElement === node,
      valueMatches: node.value === value,
    };
  }, text);
  expect(result).toEqual({
    accepted: true,
    inputDispatched: true,
    targetReady: true,
    valueMatches: true,
  });
  await expect(message).toHaveValue(text);
}

async function openFilesPanel(page: Page): Promise<Locator> {
  const button = page.getByRole("button", { name: "Files", exact: true });
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
  const panel = page.getByRole("region", { name: "Files panel" });
  await expect(panel).toBeVisible();
  return panel;
}

async function renderFull(page: Page, expectedPath = "main.scad"): Promise<void> {
  const runsBefore = await page.locator(".console-run").count();
  await page.getByRole("button", { name: "Full render", exact: true }).click();
  await expect.poll(async () => ({
    runs: await page.locator(".console-run").count(),
    status: (await page.locator(".status-render").textContent())?.trim(),
  }), { timeout: 60_000 }).toEqual({
    runs: runsBefore + 1,
    status: `Rendered ${expectedPath} (3d)`,
  });
  await expect(page.locator(".viewer-pane canvas, .model-viewer canvas, canvas").first())
    .toBeVisible();
}

async function decodedImage(locator: Locator) {
  return locator.evaluate(async (node) => {
    if (!(node instanceof HTMLImageElement)) throw new Error("Thumbnail is not an image.");
    await node.decode();
    return { height: node.naturalHeight, src: node.src, width: node.naturalWidth };
  });
}

async function installAnimationMonitor(page: Page): Promise<number> {
  return page.evaluate(() => {
    const host = globalThis as typeof globalThis & {
      __scadmillM4HostedAnimation?: {
        activeRenders: number;
        lastStatus: string;
        observer: MutationObserver;
        overlapObserved: boolean;
      };
    };
    host.__scadmillM4HostedAnimation?.observer.disconnect();
    const monitor = {
      activeRenders: 0,
      lastStatus: document.querySelector(".status-render")?.textContent?.trim() ?? "",
      observer: new MutationObserver(() => undefined),
      overlapObserved: false,
    };
    const observe = () => {
      const status = document.querySelector(".status-render")?.textContent?.trim() ?? "";
      if (/^Rendering/u.test(status) && !/^Rendering/u.test(monitor.lastStatus)) {
        if (monitor.activeRenders > 0) monitor.overlapObserved = true;
        monitor.activeRenders += 1;
      } else if (/^Rendered /u.test(status) && !/^Rendered /u.test(monitor.lastStatus)
        && monitor.activeRenders > 0) {
        monitor.activeRenders -= 1;
      }
      monitor.lastStatus = status;
    };
    monitor.observer = new MutationObserver(observe);
    monitor.observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    host.__scadmillM4HostedAnimation = monitor;
    return document.querySelectorAll(".console-run").length;
  });
}

async function playOneAnimationFrameAndPause(page: Page) {
  return page.evaluate(() => new Promise<{
    consoleRunsAfter: number;
    consoleRunsBefore: number;
    frame: string;
    overlapObserved: boolean;
    status: string;
  }>((resolvePlay, rejectPlay) => {
    const status = document.querySelector<HTMLElement>(".status-render");
    const play = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Play animation"]',
    );
    if (!status || !play || play.disabled) {
      rejectPlay(new Error("Enabled animation Play control is unavailable."));
      return;
    }
    const runsBefore = document.querySelectorAll(".console-run").length;
    let pauseRequested = false;
    let sawAdvancedRun = false;
    let timeout = 0;
    let observer = new MutationObserver(() => undefined);
    const finish = (error?: Error) => {
      observer.disconnect();
      window.clearTimeout(timeout);
      if (error) rejectPlay(error);
      else {
        const host = globalThis as typeof globalThis & {
          __scadmillM4HostedAnimation?: { overlapObserved: boolean };
        };
        resolvePlay({
          consoleRunsAfter: document.querySelectorAll(".console-run").length,
          consoleRunsBefore: runsBefore,
          frame: document.querySelector('[aria-label="Animation frame"]')
            ?.getAttribute("aria-valuetext") ?? "",
          overlapObserved: host.__scadmillM4HostedAnimation?.overlapObserved ?? true,
          status: status.textContent?.trim() ?? "",
        });
      }
    };
    timeout = window.setTimeout(() => finish(new Error(
      "Animation Play did not complete one serialized render before Pause.",
    )), 30_000);
    const probe = () => {
      const runsAfter = document.querySelectorAll(".console-run").length;
      if (runsAfter > runsBefore + 1) {
        finish(new Error("Animation Play started overlapping engine runs."));
        return;
      }
      sawAdvancedRun ||= runsAfter === runsBefore + 1;
      if (!sawAdvancedRun || !/^Rendered /u.test(status.textContent ?? "")) return;
      if (!pauseRequested) {
        const pause = document.querySelector<HTMLButtonElement>(
          'button[aria-label="Pause animation"]',
        );
        if (!pause || pause.disabled) return;
        pauseRequested = true;
        pause.click();
        return;
      }
      const restoredPlay = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Play animation"]',
      );
      if (restoredPlay && !restoredPlay.disabled) finish();
    };
    observer = new MutationObserver(probe);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    play.click();
  }));
}

test("hosted M4 journey uses real web capabilities while keeping MCP desktop-only", async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const mock = await startScriptedM4LocalProviderMock({
    proposalSource: PROPOSAL_SOURCE,
    agentSource: AGENT_SOURCE,
    cappedRounds: 2,
    secret: SYNTHETIC_SECRET,
  });
  let rawTranscript: readonly M4RawAiTranscriptRecord[] | null = null;
  try {
    await page.goto("/");
    await dismissWelcome(page);
    await expect(page.locator(".status-engine")).toHaveText("OpenSCAD 2026.06.12", {
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "AI", exact: true }).click();
    await expect(page.getByRole("region", { name: "AI panel" }))
      .toContainText("AI is not configured.");

    const files = await openFilesPanel(page);
    await files.getByRole("button", { name: "Create workspace" }).click();
    await files.getByRole("textbox", { name: "Workspace name" }).fill("M4 hosted evidence");
    await files.getByRole("button", { name: "Create and open workspace" }).click();
    await files.getByRole("dialog", { name: "Confirm project replacement" })
      .getByRole("button", { name: "Confirm project replacement" }).click();
    await expect(files.getByRole("button", { name: "main.scad", exact: true })).toBeVisible();

    await replaceEditorSource(page, INITIAL_SOURCE);
    await files.getByRole("button", { name: "Save active file" }).click();
    await renderFull(page);

    await replaceEditorSource(page, CHANGED_SOURCE);
    await files.getByRole("button", { name: "Save active file" }).click();
    await renderFull(page);
    await expect(page.locator(".status-geometry")).toContainText("Geometry changed");
    await expect(page.locator(".status-geometry summary"))
      .toHaveAttribute("aria-label", /size \+2\/0\/0 mm/iu);

    const runsBeforeCache = await page.locator(".console-run").count();
    await page.getByRole("button", { name: "Full render", exact: true }).click();
    await expect(page.locator(".status-render")).toContainText("cached");
    await expect(page.locator(".console-run")).toHaveCount(runsBeforeCache);

    const mainFile = files.getByRole("button", { name: "main.scad", exact: true });
    await mainFile.hover();
    const fileTreeThumbnail = files.locator(".project-file-thumbnail");
    await expect(fileTreeThumbnail).toBeVisible();
    const initialThumbnail = await decodedImage(fileTreeThumbnail);
    expect(initialThumbnail).toMatchObject({ height: 160, width: 240 });
    await page.getByRole("button", { name: "Welcome", exact: true }).click();
    const welcome = page.getByRole("dialog", { name: "Welcome to ScadMill" });
    const welcomeThumbnail = welcome.locator(".welcome-recent-thumbnail");
    await expect(welcomeThumbnail).toBeVisible();
    expect(await decodedImage(welcomeThumbnail)).toEqual(initialThumbnail);
    await welcome.getByRole("button", { name: "Close welcome" }).click();

    await page.reload();
    await expect(page.locator(".status-engine")).toHaveText("OpenSCAD 2026.06.12", {
      timeout: 30_000,
    });
    const reloadedWelcome = page.getByRole("dialog", { name: "Welcome to ScadMill" });
    if (!await reloadedWelcome.isVisible()) {
      await page.getByRole("button", { name: "Welcome", exact: true }).click();
    }
    const persistedWelcomeThumbnail = reloadedWelcome.locator(".welcome-recent-thumbnail");
    await expect(persistedWelcomeThumbnail).toBeVisible();
    expect(await decodedImage(persistedWelcomeThumbnail)).toEqual(initialThumbnail);
    await reloadedWelcome.getByRole("button", { name: "Reopen M4 hosted evidence" }).click();
    const replacement = page.getByRole("dialog", { name: "Confirm project replacement" });
    if (await replacement.isVisible()) {
      await replacement.getByRole("button", { name: "Confirm project replacement" }).click();
    }
    const reloadedFiles = await openFilesPanel(page);
    await expect.poll(() => editorSource(page)).toBe(CHANGED_SOURCE);
    const reloadedMain = reloadedFiles.getByRole("button", { name: "main.scad", exact: true });
    await reloadedMain.hover();
    const persistedFileThumbnail = reloadedFiles.locator(".project-file-thumbnail");
    await expect(persistedFileThumbnail).toBeVisible();
    expect(await decodedImage(persistedFileThumbnail)).toEqual(initialThumbnail);

    await replaceEditorSource(page, ANIMATED_SOURCE);
    const animation = page.getByRole("region", { name: "Animation" });
    await expect(animation).toBeVisible();
    const runsBeforeScrub = await installAnimationMonitor(page);
    await animation.getByLabel("Animation frame").fill("50");
    await expect(animation.locator("output")).toHaveText("$t 0.50");
    await expect.poll(() => page.locator(".console-run").count(), { timeout: 30_000 })
      .toBe(runsBeforeScrub + 1);
    await expect(page.locator(".status-render")).toHaveText(/^Rendered /u);
    await expect(animation.getByLabel("Animation frame"))
      .toHaveAttribute("aria-valuetext", "Frame 51 of 100");
    await animation.getByLabel("Animation FPS").fill("24");
    const played = await playOneAnimationFrameAndPause(page);
    expect(played).toMatchObject({
      consoleRunsBefore: runsBeforeScrub + 1,
      consoleRunsAfter: runsBeforeScrub + 2,
      frame: "Frame 52 of 100",
      overlapObserved: false,
    });
    expect(played.status).toMatch(/^Rendered /u);
    await expect(animation.getByRole("button", { name: "Play animation" })).toBeVisible();
    const pausedRuns = await page.locator(".console-run").count();
    await page.waitForTimeout(250);
    await expect(page.locator(".console-run")).toHaveCount(pausedRuns);
    await expect(animation.getByLabel("Animation frame"))
      .toHaveAttribute("aria-valuetext", "Frame 52 of 100");

    await page.getByRole("button", { name: "Open settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByLabel("Enable local MCP server (stdio)")).toHaveCount(0);
    await settings.getByLabel("Search settings").fill("AI");
    await settings.getByLabel("AI provider").selectOption("local");
    await expect(settings.getByLabel("AI provider")).toHaveValue("local");
    await settings.getByLabel("AI endpoint").fill(mock.endpoint);
    await expect(settings.getByLabel("AI endpoint")).toHaveValue(mock.endpoint);
    await settings.getByLabel("AI model", { exact: true }).fill(mock.model);
    await expect(settings.getByLabel("AI model", { exact: true })).toHaveValue(mock.model);
    await settings.getByLabel("AI API key").fill(mock.secret);
    await settings.getByRole("button", { name: "Save AI key" }).click();
    await expect(settings.getByRole("status")).toHaveText("AI key saved.");
    await settings.getByRole("button", { name: "Close settings" }).click();

    await page.getByRole("button", { name: "AI", exact: true }).click();
    const ai = page.getByRole("region", { name: "AI panel" });
    await enterMessageThroughBrowserEditing(
      ai.getByLabel("Message"),
      "Change the cube to the requested dimensions.",
    );
    await ai.getByRole("button", { name: "Send", exact: true }).click();
    await expect(ai.locator(".ai-proposal")).toContainText(PROPOSAL_SOURCE, { timeout: 30_000 });
    await ai.getByRole("radio", { name: "Inline" }).check();
    await ai.getByRole("button", { name: "Use disk change" }).click();
    await ai.getByRole("button", { name: "Apply hunk choices" }).click();
    await expect.poll(() => editorSource(page)).toBe(APPLIED_PROPOSAL_SOURCE);
    await expect(ai.locator(".ai-proposal")).toContainText("accepted");

    await ai.getByLabel("Current file").uncheck();
    await ai.getByLabel("Diagnostics").uncheck();
    await ai.getByLabel("Parameters").uncheck();
    await ai.getByLabel("Viewer screenshot").uncheck();
    await ai.getByLabel("Allow tool calls for this conversation").check();
    await ai.getByLabel("Maximum tool-call rounds").fill("6");
    const runsBeforeAgent = await page.locator(".console-run").count();
    await ai.getByLabel("Message").fill("Render, inspect diagnostics, and propose the agent edit.");
    await ai.getByRole("button", { name: "Send", exact: true }).click();
    await expect(ai).toContainText("Agent status: completed", { timeout: 60_000 });
    await expect.poll(() => page.locator(".console-run").count()).toBe(runsBeforeAgent + 1);

    await page.getByRole("button", { name: /^History(?:, activity pending)?$/u }).click();
    const history = page.getByRole("region", { name: "History panel" });
    await expect(history).toContainText("Pending review");
    await history.getByRole("button", { name: "Approve change" }).click();
    await expect.poll(() => editorSource(page)).toBe(AGENT_SOURCE);
    await expect(history).toContainText("AI panel");
    await expect(history).toContainText("User");

    await page.getByRole("button", { name: "AI", exact: true }).click();
    await ai.getByLabel("Current file").check();
    await ai.getByLabel("Diagnostics").check();
    await ai.getByLabel("Parameters").check();
    const agentOptIn = ai.getByLabel("Allow tool calls for this conversation");
    await expect(agentOptIn).not.toBeChecked();
    await expect(ai.getByLabel("Maximum tool-call rounds")).toHaveCount(0);
    await ai.getByLabel("Allow tool calls for this conversation").check();
    const maximumRounds = ai.getByLabel("Maximum tool-call rounds");
    await expect(maximumRounds).toBeVisible();
    await maximumRounds.fill("2");
    await ai.getByLabel("Message").fill("Exercise the bounded looping-tool response.");
    await ai.getByRole("button", { name: "Send", exact: true }).click();
    await expect(ai).toContainText("Agent status: capped", { timeout: 60_000 });
    await expect.poll(() => editorSource(page)).toBe(AGENT_SOURCE);

    rawTranscript = await mock.close();
    const transcript = sanitizeAiTranscript(rawTranscript, SYNTHETIC_SECRET);
    const serializedTranscript = JSON.stringify(transcript, null, 2);
    expect(rawTranscript).toHaveLength(7);
    expect(transcript.records.map(({ ordinal }) => ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(transcript.records.map(({ responseToolName }) => responseToolName)).toEqual([
      null,
      "render_preview",
      "get_diagnostics",
      "write_file",
      null,
      "render_preview",
      "render_preview",
    ]);
    expect(transcript.records[0]?.context.source).toBe(true);
    expect(transcript.records.slice(1, 5).every(({ context }) =>
      Object.values(context).every((enabled) => !enabled))).toBe(true);
    expect(transcript.records.slice(5).every(({ context }) => context.source)).toBe(true);
    expect(serializedTranscript).not.toContain(SYNTHETIC_SECRET);
    await testInfo.attach("sanitized-local-provider-transcript", {
      body: Buffer.from(serializedTranscript, "utf8"),
      contentType: "application/json",
    });

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    if (rawTranscript === null) await mock.close();
  }
});
