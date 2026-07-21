import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_THUMBNAIL_BYTES = 256 * 1024;
const SCREENSHOT_PNG_LIMITS = Object.freeze({
  maximumWidth: 4_096,
  maximumHeight: 4_096,
  maximumDecodedBytes: 65 * 1024 * 1024,
});
const THUMBNAIL_PNG_LIMITS = Object.freeze({
  ...SCREENSHOT_PNG_LIMITS,
  exactWidth: 240,
  exactHeight: 160,
  maximumDecodedBytes: 240 * 160 * 4 + 160,
});
const THUMBNAIL_STORAGE_PREFIX = "scadmill.desktop-render-thumbnails.v1:desktop-project:";
const EXPECTED_MCP_TOOLS = [
  "export_model",
  "get_diagnostics",
  "get_history",
  "get_parameters",
  "list_files",
  "read_file",
  "render_preview",
  "set_parameters",
  "take_screenshot",
  "write_file",
];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export const M4_SELECTORS = Object.freeze({
  ai: '[aria-label="AI"]',
  aiMessages: ".ai-conversation-messages [data-role]",
  aiProposal: ".ai-proposal",
  animation: '[aria-label="Animation"]',
  animationFps: '[aria-label="Animation FPS"]',
  animationFrame: '[aria-label="Animation frame"]',
  consoleRun: ".console-run",
  fileTreeThumbnail: ".project-file-thumbnail",
  geometryStatus: ".status-geometry",
  message: '[aria-label="Message"]',
  renderStatus: ".status-render",
  send: 'button[type="submit"]',
  viewerCanvas: ".viewer-pane canvas, .model-viewer canvas, canvas",
  welcomeRecentThumbnail: ".welcome-recent-thumbnail",
});

export const M4_DOM_SCRIPTS = Object.freeze({
  installNetworkAttemptMonitor: `
    if (globalThis.__scadmillM4NetworkAttemptMonitor) {
      throw new Error('M4 network-attempt monitor was installed more than once.');
    }
    const rendererObservations = [];
    const originalFetch = globalThis.fetch.bind(globalThis);
    const originalFetchValue = globalThis.fetch;
    const originalOpen = XMLHttpRequest.prototype.open;
    const tauriInternals = globalThis.__TAURI_INTERNALS__;
    const originalInvoke = tauriInternals?.invoke;
    const invokeDescriptor = tauriInternals
      ? Object.getOwnPropertyDescriptor(tauriInternals, 'invoke') : undefined;
    const monitor = {
      rendererObservations, rendererAttemptCount: 0, rendererExternalAttemptCount: 0,
      rendererDroppedAttemptCount: 0,
      tauriInvokeAttemptCount: 0,
      originalFetchValue, originalOpen, tauriInternals, originalInvoke, invokeDescriptor,
      invokePatched: false,
      tauriInvokeMonitoring: typeof originalInvoke === 'function'
        ? 'protected-nonwritable' : 'unavailable',
    };
    const observeRenderer = (kind, target, method) => {
      let targetClass = 'unparseable';
      let origin = 'unparseable';
      let command = null;
      try {
        const parsed = new URL(String(target), globalThis.location?.href);
        origin = parsed.origin === 'null' ? parsed.protocol : parsed.origin;
        if (parsed.protocol === 'ipc:' || parsed.hostname === 'ipc.localhost') {
          targetClass = 'tauri-ipc';
          const candidate = decodeURIComponent(parsed.pathname.split('/').filter(Boolean)[0] ?? '');
          command = /^[A-Za-z0-9:_-]{1,128}$/u.test(candidate) ? candidate : null;
        } else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          targetClass = parsed.origin === globalThis.location?.origin
            ? 'same-origin' : 'external-http';
        } else if (['asset:', 'blob:', 'data:', 'file:', 'tauri:'].includes(parsed.protocol)) {
          targetClass = 'local-scheme';
        } else {
          targetClass = 'external-scheme';
        }
      } catch { /* An unparseable target remains fail-closed external evidence. */ }
      monitor.rendererAttemptCount += 1;
      if (targetClass === 'external-http' || targetClass === 'external-scheme'
        || targetClass === 'unparseable') {
        monitor.rendererExternalAttemptCount += 1;
      }
      if (rendererObservations.length < 64) {
        rendererObservations.push({
          command, kind, method: String(method || 'GET').toUpperCase().slice(0, 16), origin, targetClass,
        });
      } else {
        monitor.rendererDroppedAttemptCount += 1;
      }
    };
    globalThis.__scadmillM4NetworkAttemptMonitor = monitor;
    try {
      globalThis.fetch = (...args) => {
        const request = typeof Request !== 'undefined' && args[0] instanceof Request ? args[0] : null;
        observeRenderer('fetch', request?.url ?? args[0], args[1]?.method ?? request?.method ?? 'GET');
        return originalFetch(...args);
      };
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        observeRenderer('xhr', url, method);
        return originalOpen.call(this, method, url, ...rest);
      };
      if (tauriInternals && typeof originalInvoke === 'function') {
        const invokePatchable = !invokeDescriptor || invokeDescriptor.configurable
          || ('writable' in invokeDescriptor && invokeDescriptor.writable);
        if (invokePatchable) {
          const monitoredInvoke = function(command, ...args) {
            if (command === 'ai_http_request') {
              monitor.tauriInvokeAttemptCount += 1;
              return Promise.reject(new Error('M4 unconfigured-AI monitor blocked an AI broker request.'));
            }
            return originalInvoke.call(this, command, ...args);
          };
          const monitoredDescriptor = invokeDescriptor && 'value' in invokeDescriptor
            ? { ...invokeDescriptor, value: monitoredInvoke }
            : {
                configurable: invokeDescriptor?.configurable ?? true,
                enumerable: invokeDescriptor?.enumerable ?? true,
                writable: true,
                value: monitoredInvoke,
              };
          try {
            Object.defineProperty(tauriInternals, 'invoke', monitoredDescriptor);
            monitor.invokePatched = true;
            monitor.tauriInvokeMonitoring = 'installed';
          } catch {
            monitor.tauriInvokeMonitoring = 'patch-failed';
          }
        }
      }
      return {
        rendererAttemptCount: monitor.rendererAttemptCount,
        rendererExternalAttemptCount: 0,
        rendererInternalAttemptCount: 0,
        rendererDroppedAttemptCount: monitor.rendererDroppedAttemptCount,
        rendererObservations: rendererObservations.slice(),
        tauriInvokeAttemptCount: monitor.tauriInvokeMonitoring === 'installed'
          ? monitor.tauriInvokeAttemptCount : null,
        tauriInvokeMonitoring: monitor.tauriInvokeMonitoring,
      };
    } catch (error) {
      globalThis.fetch = originalFetchValue;
      XMLHttpRequest.prototype.open = originalOpen;
      if (monitor.invokePatched && tauriInternals) {
        if (invokeDescriptor) Object.defineProperty(tauriInternals, 'invoke', invokeDescriptor);
        else delete tauriInternals.invoke;
      }
      delete globalThis.__scadmillM4NetworkAttemptMonitor;
      throw error;
    }
  `,
  networkAttemptSnapshot: `
    const monitor = globalThis.__scadmillM4NetworkAttemptMonitor;
    if (!monitor) return {
      rendererAttemptCount: -1,
      rendererExternalAttemptCount: -1,
      rendererInternalAttemptCount: -1,
      rendererDroppedAttemptCount: -1,
      rendererObservations: [],
      tauriInvokeAttemptCount: null,
      tauriInvokeMonitoring: 'unavailable',
    };
    const observation = {
      rendererAttemptCount: monitor.rendererAttemptCount,
      rendererExternalAttemptCount: monitor.rendererExternalAttemptCount,
      rendererInternalAttemptCount: monitor.rendererAttemptCount - monitor.rendererExternalAttemptCount,
      rendererDroppedAttemptCount: monitor.rendererDroppedAttemptCount,
      rendererObservations: monitor.rendererObservations.slice(),
      tauriInvokeAttemptCount: monitor.tauriInvokeMonitoring === 'installed'
        ? monitor.tauriInvokeAttemptCount : null,
      tauriInvokeMonitoring: monitor.tauriInvokeMonitoring,
    };
    const restorationErrors = [];
    try { globalThis.fetch = monitor.originalFetchValue; } catch (error) { restorationErrors.push(error); }
    try { XMLHttpRequest.prototype.open = monitor.originalOpen; } catch (error) { restorationErrors.push(error); }
    if (monitor.invokePatched && monitor.tauriInternals && typeof monitor.originalInvoke === 'function') {
      try {
        if (monitor.invokeDescriptor) {
          Object.defineProperty(monitor.tauriInternals, 'invoke', monitor.invokeDescriptor);
        } else {
          delete monitor.tauriInternals.invoke;
        }
      } catch (error) { restorationErrors.push(error); }
    }
    delete globalThis.__scadmillM4NetworkAttemptMonitor;
    if (restorationErrors.length > 0) {
      throw new AggregateError(restorationErrors, 'M4 network-attempt monitor restoration failed.');
    }
    return observation;
  `,
  consoleRunCount: `return { count: document.querySelectorAll('.console-run').length };`,
  aiUnconfigured: `
    const ai = document.querySelector('section[aria-label="AI"]');
    const text = ai?.textContent ?? '';
    return {
      guidanceVisible: text.includes('AI is not configured.')
        && text.includes('No network requests are made until you choose a provider and send a message.'),
      sendCount: ai ? [...ai.querySelectorAll('button')]
        .filter((button) => button.textContent?.trim() === 'Send').length : -1,
    };
  `,
  aiProposal: `
    const proposals = [...document.querySelectorAll('.ai-proposal')];
    return {
      acceptedCount: proposals.filter((proposal) => proposal.textContent?.includes('accepted')).length,
      assistantRoles: document.querySelectorAll('.ai-conversation-messages [data-role="assistant"]').length,
      pendingProposals: proposals.filter((proposal) => !proposal.textContent?.includes('accepted')
        && !proposal.textContent?.includes('rejected')).length,
    };
  `,
  aiProposalOutcome: `
    const expectedSource = String(arguments[0]);
    const visible = (element) => element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden'
      && getComputedStyle(element).display !== 'none';
    const ai = document.querySelector('section[aria-label="AI"]');
    const proposals = ai ? [...ai.querySelectorAll('.ai-proposal')].filter(visible) : [];
    const pending = proposals.filter((proposal) => !proposal.textContent?.includes('accepted')
      && !proposal.textContent?.includes('rejected'));
    const assistants = ai
      ? [...ai.querySelectorAll('.ai-conversation-messages [data-role="assistant"]')].filter(visible)
      : [];
    const alerts = ai ? [...ai.querySelectorAll('[role="alert"]')].filter(visible) : [];
    return {
      aiVisible: Boolean(ai && visible(ai)),
      proposalCount: proposals.length,
      pendingProposalCount: pending.length,
      assistantCount: assistants.length,
      assistantHasExpected: assistants.some((message) => message.textContent?.includes(expectedSource)),
      alertText: (alerts[0]?.textContent ?? '').trim().slice(0, 1000),
    };
  `,
  conversationModelSnapshot: `
    const control = document.querySelector('[aria-label="Conversation model"]');
    if (!(control instanceof HTMLSelectElement)) return null;
    return {
      optionCount: control.options.length,
      selectedLabel: control.selectedOptions[0]?.textContent?.trim() ?? '',
      selectedValue: control.value,
    };
  `,
  settingsAiProfileSnapshot: `
    const control = (name) => {
      const candidates = [...document.querySelectorAll('[aria-label="' + CSS.escape(name) + '"]')]
        .filter((candidate) => (candidate instanceof HTMLInputElement
          || candidate instanceof HTMLSelectElement)
          && !candidate.disabled
          && candidate.getClientRects().length > 0
          && getComputedStyle(candidate).visibility !== 'hidden'
          && getComputedStyle(candidate).display !== 'none');
      return candidates.length === 1 ? candidates[0].value : null;
    };
    return {
      provider: control('AI provider'),
      endpoint: control('AI endpoint'),
      model: control('AI model'),
    };
  `,
  renderSnapshot: `
    const status = document.querySelector('.status-render');
    const geometry = document.querySelector('.status-geometry');
    const canvas = document.querySelector('.viewer-pane canvas, .model-viewer canvas, canvas');
    return {
      status: status?.textContent?.trim() ?? '',
      geometry: geometry?.textContent?.trim() ?? '',
      consoleRuns: document.querySelectorAll('.console-run').length,
      canvasVisible: Boolean(canvas && canvas.getClientRects().length > 0
        && canvas.clientWidth > 0 && canvas.clientHeight > 0),
    };
  `,
  geometrySnapshot: `
    const geometry = document.querySelector('.status-geometry');
    const summary = geometry?.querySelector('summary');
    const detail = geometry?.querySelector('.status-geometry-detail');
    return {
      summary: (summary?.textContent ?? geometry?.textContent ?? '').trim(),
      detail: (summary?.getAttribute('aria-label') ?? detail?.textContent
        ?? geometry?.textContent ?? '').trim(),
    };
  `,
  installAnimationMonitor: `
    globalThis.__scadmillM4AnimationMonitor?.observer?.disconnect();
    const monitor = {
      initialRuns: document.querySelectorAll('.console-run').length,
      activeRenders: 0,
      overlapObserved: false,
      lastStatus: document.querySelector('.status-render')?.textContent?.trim() ?? '',
      observer: null,
    };
    const observe = () => {
      const status = document.querySelector('.status-render')?.textContent?.trim() ?? '';
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
    monitor.observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    observe();
    globalThis.__scadmillM4AnimationMonitor = monitor;
    return { consoleRuns: monitor.initialRuns };
  `,
  animationScrubCompleted: `
    const done = arguments[arguments.length - 1];
    const monitor = globalThis.__scadmillM4AnimationMonitor;
    const status = document.querySelector('.status-render');
    const play = document.querySelector('button[aria-label="Play animation"]');
    if (!monitor || !(status instanceof HTMLElement)) {
      done({ error: 'Animation phase monitor is unavailable.' });
      return;
    }
    const probe = () => {
      const consoleRuns = document.querySelectorAll('.console-run').length;
      const activePlay = document.querySelector('button[aria-label="Play animation"]');
      if (consoleRuns <= monitor.initialRuns
        || !/^Rendered /u.test(status.textContent ?? '')
        || !(activePlay instanceof HTMLButtonElement) || activePlay.disabled) return false;
      done({
        consoleRunsBefore: monitor.initialRuns,
        consoleRunsAfter: consoleRuns,
        status: status.textContent?.trim() ?? '',
      });
      return true;
    };
    if (probe()) return;
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      done({ error: 'Animation scrub did not complete a new engine run.' });
    }, 30000);
    const observer = new MutationObserver(() => {
      if (!probe()) return;
      observer.disconnect();
      window.clearTimeout(timeout);
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true });
  `,
  animationPlayFrameCompleted: `
    const done = arguments[arguments.length - 1];
    const status = document.querySelector('.status-render');
    const play = document.querySelector('button[aria-label="Play animation"]');
    if (!(status instanceof HTMLElement) || !(play instanceof HTMLButtonElement) || play.disabled) {
      done({ error: 'Enabled animation Play control is unavailable.' });
      return;
    }
    const consoleRunsBefore = document.querySelectorAll('.console-run').length;
    let sawNewRun = false;
    let pauseRequested = false;
    const probe = () => {
      const consoleRunsAfter = document.querySelectorAll('.console-run').length;
      if (consoleRunsAfter > consoleRunsBefore + 1) {
        observer.disconnect();
        window.clearTimeout(timeout);
        done({ error: 'Animation Play started more than one engine run before Pause.' });
        return true;
      }
      sawNewRun ||= consoleRunsAfter > consoleRunsBefore;
      if (!sawNewRun || !/^Rendered /u.test(status.textContent ?? '')) return false;
      if (!pauseRequested) {
        const pause = document.querySelector('button[aria-label="Pause animation"]');
        if (!(pause instanceof HTMLButtonElement) || pause.disabled) return false;
        pauseRequested = true;
        pause.click();
        return false;
      }
      const restoredPlay = document.querySelector('button[aria-label="Play animation"]');
      const frame = document.querySelector('[aria-label="Animation frame"]');
      if (!(restoredPlay instanceof HTMLButtonElement) || restoredPlay.disabled
        || frame?.getAttribute('aria-valuetext') !== 'Frame 52 of 100') return false;
      done({
        consoleRunsBefore,
        consoleRunsAfter,
        status: status.textContent?.trim() ?? '',
        paused: true,
        playLabel: restoredPlay.getAttribute('aria-label'),
      });
      return true;
    };
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      done({ error: 'Animation Play did not complete a new engine run.' });
    }, 30000);
    const observer = new MutationObserver(() => {
      if (!probe()) return;
      observer.disconnect();
      window.clearTimeout(timeout);
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    play.click();
  `,
  animationSnapshot: `
    const region = document.querySelector('[aria-label="Animation"]');
    const frame = region?.querySelector('[aria-label="Animation frame"]');
    const fps = region?.querySelector('[aria-label="Animation FPS"]');
    const play = region?.querySelector('button[aria-label]');
    const monitor = globalThis.__scadmillM4AnimationMonitor;
    monitor?.observer?.disconnect();
    return {
      frame: frame?.getAttribute('aria-valuetext') ?? '',
      time: region?.querySelector('output')?.textContent?.trim() ?? '',
      fps: fps?.value ?? '',
      playLabel: play?.getAttribute('aria-label') ?? '',
      consoleRuns: document.querySelectorAll('.console-run').length,
      overlapObserved: monitor?.overlapObserved ?? true,
    };
  `,
  focusFileTreeThumbnail: `
    const wanted = arguments[0];
    const candidate = [...document.querySelectorAll('button, [role="treeitem"]')]
      .find((node) => node.textContent?.trim() === wanted);
    if (!(candidate instanceof HTMLElement)) return false;
    candidate.focus();
    candidate.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return true;
  `,
  thumbnailSnapshot: `
    const storageEntries = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('scadmill.desktop-render-thumbnails.v1:desktop-project:')) {
        storageEntries.push({ key, value: localStorage.getItem(key) });
      }
    }
    const visible = (selector) => [...document.querySelectorAll(selector)]
      .filter((node) => node instanceof HTMLImageElement && node.getClientRects().length > 0);
    const fileTree = visible('.project-file-thumbnail');
    const welcome = visible('.welcome-recent-thumbnail');
    return {
      storageEntries,
      fileTree: { count: fileTree.length, src: fileTree[0]?.src ?? null },
      welcome: { count: welcome.length, src: welcome[0]?.src ?? null },
    };
  `,
  thumbnailDecodedSnapshot: `
    const surface = arguments[0];
    const expectedPath = arguments[1];
    const notBeforeMs = arguments[2];
    const done = arguments[arguments.length - 1];
    if (!['fileTree', 'welcome'].includes(surface)
      || typeof expectedPath !== 'string' || !Number.isFinite(notBeforeMs)) {
      done({ error: 'Thumbnail wait arguments are invalid.' });
      return;
    }
    const collect = () => {
      const storageEntries = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('scadmill.desktop-render-thumbnails.v1:desktop-project:')) {
          storageEntries.push({ key, value: localStorage.getItem(key) });
        }
      }
      const visible = (selector) => [...document.querySelectorAll(selector)]
        .filter((node) => node instanceof HTMLImageElement && node.getClientRects().length > 0);
      return {
        storageEntries,
        fileTree: visible('.project-file-thumbnail'),
        welcome: visible('.welcome-recent-thumbnail'),
      };
    };
    const currentRecord = (storageEntries) => {
      for (const entry of storageEntries) {
        try {
          const envelope = JSON.parse(entry.value);
          const record = envelope?.records?.find((candidate) => candidate?.documentPath === expectedPath);
          if (record && Date.parse(record.capturedAt) >= notBeforeMs) return record;
        } catch { /* Keep polling until a complete bounded envelope exists. */ }
      }
      return null;
    };
    const evidence = (items) => ({
      count: items.length,
      src: items[0]?.src ?? null,
      complete: items[0]?.complete ?? false,
      naturalWidth: items[0]?.naturalWidth ?? 0,
      naturalHeight: items[0]?.naturalHeight ?? 0,
      decoded: items.length === 1,
    });
    let settled = false;
    let probing = false;
    let interval;
    let timeout;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (interval !== undefined) window.clearInterval(interval);
      if (timeout !== undefined) window.clearTimeout(timeout);
      done(value);
    };
    const probe = async () => {
      if (settled || probing) return;
      probing = true;
      try {
        const snapshot = collect();
        const selected = snapshot[surface];
        if (snapshot.storageEntries.length !== 1 || selected.length !== 1
          || !currentRecord(snapshot.storageEntries)) return;
        await selected[0].decode();
        const decoded = collect();
        const decodedSelected = decoded[surface];
        if (decoded.storageEntries.length !== 1 || decodedSelected.length !== 1
          || !currentRecord(decoded.storageEntries)
          || !decodedSelected[0].complete
          || decodedSelected[0].naturalWidth !== 240
          || decodedSelected[0].naturalHeight !== 160) return;
        finish({
          storageEntries: decoded.storageEntries,
          fileTree: evidence(decoded.fileTree),
          welcome: evidence(decoded.welcome),
        });
      } catch { /* A not-yet-decodable image remains inside the bounded poll. */ }
      finally { probing = false; }
    };
    interval = window.setInterval(() => { void probe(); }, 25);
    timeout = window.setTimeout(() => {
      const snapshot = collect();
      finish({
        error: 'Timed out waiting for the current persisted thumbnail and visible decoded image.',
        storageEntryCount: snapshot.storageEntries.length,
        visibleCount: snapshot[surface].length,
      });
    }, 5000);
    void probe();
  `,
  secretSurfaceSnapshot: `
    const storage = (area) => {
      const rows = [];
      for (let index = 0; index < area.length; index += 1) {
        const key = area.key(index);
        rows.push([key, key === null ? null : area.getItem(key)]);
      }
      return JSON.stringify(rows);
    };
    return {
      body: document.body?.innerText ?? '',
      consoleText: [...document.querySelectorAll('.diagnostic-console, .console-run')]
        .map((node) => node.textContent ?? '').join('\n'),
      localStorage: storage(localStorage),
      sessionStorage: storage(sessionStorage),
    };
  `,
  fullRenderCompleted: `
    const expectedPath = arguments[0];
    const done = arguments[arguments.length - 1];
    let settled = false;
    let readinessInterval;
    let readinessTimeout;
    let completionTimeout;
    let observer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (readinessInterval !== undefined) window.clearInterval(readinessInterval);
      if (readinessTimeout !== undefined) window.clearTimeout(readinessTimeout);
      if (completionTimeout !== undefined) window.clearTimeout(completionTimeout);
      observer?.disconnect();
      done(value);
    };
    const begin = () => {
      if (settled) return;
      const status = document.querySelector('.status-render');
      const render = [...document.querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === 'Full render');
      const canvas = document.querySelector('.viewer-pane canvas, .model-viewer canvas, canvas');
      if (!(status instanceof HTMLElement) || !(render instanceof HTMLButtonElement)
        || render.disabled || !(canvas instanceof HTMLCanvasElement)) return;
      const consoleRunsBefore = document.querySelectorAll('.console-run').length;
      const expectedStatus = 'Rendered ' + expectedPath + ' (3d)';
      const probe = () => {
        const consoleRunsAfter = document.querySelectorAll('.console-run').length;
        if (consoleRunsAfter !== consoleRunsBefore + 1
          || status.textContent?.trim() !== expectedStatus) return false;
        finish({
          consoleRunsBefore,
          consoleRunsAfter,
          status: expectedStatus,
          canvasVisible: canvas.getClientRects().length > 0
            && canvas.clientWidth > 0 && canvas.clientHeight > 0,
        });
        return true;
      };
      if (readinessInterval !== undefined) window.clearInterval(readinessInterval);
      if (readinessTimeout !== undefined) window.clearTimeout(readinessTimeout);
      completionTimeout = window.setTimeout(() => {
        finish({ error: 'Full render did not complete exactly one new engine run.' });
      }, 60000);
      observer = new MutationObserver(() => { probe(); });
      observer.observe(document.body, { childList: true, characterData: true, subtree: true });
      render.click();
      probe();
    };
    readinessInterval = window.setInterval(begin, 25);
    readinessTimeout = window.setTimeout(() => {
      finish({ error: 'Full-render completion controls did not become available.' });
    }, 15000);
    begin();
  `,
  cachedPaint: `
    const done = arguments[arguments.length - 1];
    const status = document.querySelector('.status-render');
    const render = [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Full render');
    const canvas = document.querySelector('.viewer-pane canvas, .model-viewer canvas, canvas');
    if (!(status instanceof HTMLElement) || !(render instanceof HTMLButtonElement)
      || render.disabled || !(canvas instanceof HTMLCanvasElement)) {
      done({ error: 'Cached paint controls are unavailable.' });
      return;
    }
    const consoleRunsBefore = document.querySelectorAll('.console-run').length;
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      done({ error: 'Cached full render did not reach the visible status area.' });
    }, 10000);
    const startedAt = performance.now();
    const observer = new MutationObserver(() => {
      if (!/\\bcached\\b/iu.test(status.textContent ?? '')) return;
      observer.disconnect();
      window.clearTimeout(timeout);
      requestAnimationFrame(() => requestAnimationFrame(() => done({
        elapsedMs: performance.now() - startedAt,
        status: status.textContent?.trim() ?? '',
        consoleRunsBefore,
        consoleRunsAfter: document.querySelectorAll('.console-run').length,
        canvasVisible: canvas.getClientRects().length > 0
          && canvas.clientWidth > 0 && canvas.clientHeight > 0,
      })));
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    render.click();
  `,
});

export function validateM4ZeroNetworkAttempts(value) {
  assert.ok(exactKeys(value, ["rendererAttemptCount", "rendererExternalAttemptCount", "rendererInternalAttemptCount", "rendererDroppedAttemptCount", "rendererObservations", "tauriInvokeAttemptCount", "tauriInvokeMonitoring"]), "Unconfigured AI network observation has the wrong shape.");
  for (const count of [value.rendererAttemptCount, value.rendererExternalAttemptCount, value.rendererInternalAttemptCount, value.rendererDroppedAttemptCount]) {
    assert.ok(Number.isSafeInteger(count) && count >= 0, "Unconfigured AI renderer transport count is invalid.");
  }
  assert.equal(value.rendererAttemptCount, value.rendererExternalAttemptCount + value.rendererInternalAttemptCount, "Unconfigured AI renderer transport counts are inconsistent.");
  assert.equal(value.rendererDroppedAttemptCount, 0, "Unconfigured AI renderer transport observations exceeded their retention bound.");
  assert.ok(Array.isArray(value.rendererObservations) && value.rendererObservations.length === value.rendererAttemptCount, "Unconfigured AI renderer transport observations are incomplete.");
  for (const observation of value.rendererObservations) {
    assert.ok(exactKeys(observation, ["command", "kind", "method", "origin", "targetClass"]), "Unconfigured AI renderer transport detail has the wrong shape.");
    assert.ok(observation.kind === "fetch" || observation.kind === "xhr", "Unconfigured AI renderer transport kind is invalid.");
    assert.ok(typeof observation.method === "string" && /^[A-Z]{1,16}$/u.test(observation.method), "Unconfigured AI renderer transport method is invalid.");
    assert.ok(typeof observation.origin === "string" && observation.origin.length > 0 && observation.origin.length <= 256, "Unconfigured AI renderer transport origin is invalid.");
    assert.ok(["tauri-ipc", "same-origin", "local-scheme", "external-http", "external-scheme", "unparseable"].includes(observation.targetClass), "Unconfigured AI renderer transport class is invalid.");
    assert.ok(observation.command === null || (typeof observation.command === "string" && /^[A-Za-z0-9:_-]{1,128}$/u.test(observation.command)), "Unconfigured AI renderer transport command is invalid.");
    assert.notEqual(
      observation.targetClass === "tauri-ipc" ? observation.command : null,
      "ai_http_request",
      "Unconfigured AI attempted an AI broker request through renderer-observed Tauri IPC.",
    );
  }
  assert.equal(
    value.rendererExternalAttemptCount,
    0,
    `Unconfigured AI attempted external renderer network access: ${JSON.stringify(value.rendererObservations)}`,
  );
  assert.ok(["installed", "protected-nonwritable", "patch-failed"].includes(value.tauriInvokeMonitoring), "Tauri invoke monitoring status is invalid.");
  assert.equal(
    value.tauriInvokeAttemptCount,
    value.tauriInvokeMonitoring === "installed" ? 0 : null,
    "Unconfigured AI Tauri invoke observation is inconsistent with its monitoring status.",
  );
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return exactRecord(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (exactRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeString(value, maximum = 4_096) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint === 9 || codePoint === 10 || codePoint === 13
        || (codePoint >= 32 && codePoint !== 127);
    });
}

function m4LocalResponse(ordinal, proposalSource, agentSource) {
  const toolCall = (name, argumentsValue) => ({
    message: {
      content: "",
      tool_calls: [{
        id: `m4-call-${ordinal}`,
        function: { name, arguments: argumentsValue },
      }],
    },
    done: true,
  });
  switch (ordinal) {
    case 1:
      return { responseToolName: null, body: { message: { content: `\`\`\`scad\n${proposalSource.trimEnd()}\n\`\`\`` }, done: true } };
    case 2:
      return { responseToolName: "render_preview", body: toolCall("render_preview", { path: "main.scad" }) };
    case 3:
      return { responseToolName: "get_diagnostics", body: toolCall("get_diagnostics", { path: "main.scad" }) };
    case 4:
      return { responseToolName: "write_file", body: toolCall("write_file", { path: "main.scad", content: agentSource }) };
    case 5:
      return { responseToolName: null, body: { message: { content: "M4 agent completed." }, done: true } };
    case 6:
    case 7:
      return { responseToolName: "render_preview", body: toolCall("render_preview", { path: "main.scad" }) };
    default:
      throw new Error("M4 local-provider response ordinal is out of range.");
  }
}

function requestMetadata(body) {
  assert.ok(exactRecord(body) && safeString(body.model, 256), "M4 local-provider request body is invalid.");
  assert.equal(body.stream, true, "M4 local-provider request must use streaming NDJSON.");
  assert.ok(Array.isArray(body.messages) && body.messages.length > 0, "M4 local-provider request has no messages.");
  const roles = body.messages.map((message) => message?.role);
  assert.ok(roles.every((role) => ["system", "user", "assistant", "tool"].includes(role)), "M4 local-provider request roles are invalid.");
  const toolNames = Array.isArray(body.tools) ? body.tools.map((tool) => tool?.function?.name) : [];
  assert.ok(toolNames.every((name) => safeString(name, 128)), "M4 local-provider request tools are invalid.");
  const text = body.messages.map((message) => typeof message?.content === "string" ? message.content : "").join("\n");
  const hasImages = body.messages.some((message) => Array.isArray(message?.images) && message.images.length > 0);
  return {
    model: body.model,
    roles,
    toolNames,
    context: {
      source: text.includes("<current-file>"),
      diagnostics: text.includes("<diagnostics>"),
      parameters: text.includes("<parameters>"),
      screenshot: hasImages || text.includes("<viewer-screenshot>"),
    },
  };
}

export async function startScriptedM4LocalProviderMock({
  proposalSource,
  agentSource,
  cappedRounds,
  secret,
  closeGraceMs = 250,
}) {
  assert.ok(safeString(proposalSource, 1_000_000), "M4 mock proposal source is invalid.");
  assert.ok(safeString(agentSource, 1_000_000), "M4 mock agent source is invalid.");
  assert.equal(cappedRounds, 2, "M4 mock must use exactly two capped tool rounds.");
  assert.ok(safeString(secret, 512), "M4 mock secret is invalid.");
  assert.ok(Number.isSafeInteger(closeGraceMs) && closeGraceMs >= 10 && closeGraceMs <= 10_000,
    "M4 mock close grace must be an integer from 10 through 10000 ms.");
  const records = [];
  let resolveRequestStarted;
  const requestStarted = new Promise((resolveStarted) => { resolveRequestStarted = resolveStarted; });
  const server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "authorization, content-type");
    response.setHeader("access-control-allow-methods", "POST, OPTIONS");
    response.setHeader("access-control-allow-private-network", "true");
    response.setHeader("cache-control", "no-store");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/chat") {
      response.writeHead(404, { "content-type": "application/json" }).end('{"error":"not found"}');
      return;
    }
    if (records.length >= 7) {
      response.writeHead(409, { "content-type": "application/json" }).end('{"error":"script exhausted"}');
      return;
    }
    resolveRequestStarted();
    const chunks = [];
    let byteLength = 0;
    try {
      for await (const chunk of request) {
        byteLength += chunk.byteLength;
        if (byteLength > 4 * 1024 * 1024) throw new Error("M4 local-provider request exceeded 4 MiB.");
        chunks.push(chunk);
      }
      const requestBody = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(requestBody);
      const metadata = requestMetadata(body);
      const ordinal = records.length + 1;
      const scripted = m4LocalResponse(ordinal, proposalSource, agentSource);
      const responseBody = `${JSON.stringify(scripted.body)}\n`;
      records.push({
        ordinal,
        method: "POST",
        path: request.url,
        headers: {
          authorization: String(request.headers.authorization ?? ""),
          "content-type": String(request.headers["content-type"] ?? ""),
        },
        requestBody,
        responseBody,
        roles: metadata.roles,
        toolNames: metadata.toolNames,
        responseToolName: scripted.responseToolName,
        context: metadata.context,
      });
      response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" }).end(responseBody);
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({
        error: error instanceof Error ? error.message : "invalid request",
      }));
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object" && address.address === "127.0.0.1"
    && Number.isSafeInteger(address.port) && address.port > 0, "M4 mock did not bind an ephemeral loopback port.");
  let closed = false;
  let closing;
  const transcript = () => records.map((record) => ({
    ...record,
    headers: { ...record.headers },
    roles: [...record.roles],
    toolNames: [...record.toolNames],
    context: { ...record.context },
  }));
  const closeServer = () => new Promise((resolveClose, rejectClose) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(deadlineTimer);
      if (error) rejectClose(error);
      else resolveClose();
    };
    const forceTimer = setTimeout(() => server.closeAllConnections(), closeGraceMs);
    const deadlineTimer = setTimeout(() => {
      server.closeAllConnections();
      finish(new Error(`M4 mock did not close within ${closeGraceMs * 4} ms.`));
    }, closeGraceMs * 4);
    server.close((error) => finish(error));
    server.closeIdleConnections();
  });
  return {
    endpoint: `http://127.0.0.1:${address.port}/api/chat`,
    model: "m4-local",
    secret,
    waitForRequestStart: () => requestStarted,
    async close() {
      if (!closed) {
        closing ??= closeServer().then(() => { closed = true; }, (error) => {
          closing = undefined;
          throw error;
        });
        await closing;
      }
      return transcript();
    },
  };
}

function parseJsonRecord(serialized, label) {
  assert.ok(safeString(serialized, 4 * 1024 * 1024), `${label} must be bounded JSON text.`);
  const value = JSON.parse(serialized);
  assert.ok(exactRecord(value), `${label} must contain a JSON object.`);
  return value;
}

function validateContext(value) {
  assert.ok(exactKeys(value, ["source", "diagnostics", "parameters", "screenshot"]), "AI context evidence has the wrong shape.");
  for (const enabled of Object.values(value)) assert.equal(typeof enabled, "boolean", "AI context evidence must be boolean.");
  return { ...value };
}

export function sanitizeAiTranscript(records, secret) {
  assert.ok(Array.isArray(records) && records.length > 0, "AI mock transcript must contain requests.");
  assert.ok(safeString(secret, 512), "AI mock secret must be bounded text.");
  const sanitized = records.map((record, index) => {
    assert.ok(exactRecord(record), "AI mock transcript record must be an object.");
    assert.equal(record.ordinal, index + 1, "AI mock transcript ordinals must be sequential.");
    assert.equal(record.method, "POST", "AI mock transcript must contain POST requests only.");
    assert.ok(typeof record.path === "string" && /^\/[a-z0-9_./-]{1,128}$/iu.test(record.path), "AI mock request path is invalid.");
    assert.ok(exactRecord(record.headers), "AI mock request headers are invalid.");
    assert.ok(safeString(record.requestBody, 4 * 1024 * 1024), "AI mock request body is invalid.");
    assert.ok(safeString(record.responseBody, 4 * 1024 * 1024), "AI mock response body is invalid.");
    const body = parseJsonRecord(record.requestBody, "AI mock request body");
    assert.ok(safeString(body.model, 256), "AI mock request model is missing.");
    assert.ok(Array.isArray(record.roles) && record.roles.length > 0
      && record.roles.every((role) => ["system", "user", "assistant", "tool"].includes(role)), "AI roles are invalid.");
    assert.ok(Array.isArray(record.toolNames)
      && record.toolNames.every((name) => safeString(name, 128)), "AI tool names are invalid.");
    assert.ok(record.responseToolName === null || safeString(record.responseToolName, 128), "AI selected response tool is invalid.");
    if (record.responseToolName !== null) {
      assert.ok(record.toolNames.includes(record.responseToolName), "AI selected a response tool that was not offered.");
    }
    const authorization = Object.entries(record.headers)
      .find(([name]) => name.toLowerCase() === "authorization")?.[1];
    assert.ok(typeof authorization === "string" && authorization.includes(secret), "AI mock did not observe the synthetic authorization secret.");
    return {
      ordinal: record.ordinal,
      method: record.method,
      path: record.path,
      model: body.model,
      roles: [...record.roles],
      toolNames: [...record.toolNames],
      responseToolName: record.responseToolName,
      context: validateContext(record.context),
      bodySha256: sha256(record.requestBody),
      responseSha256: sha256(record.responseBody),
      authorizationPresent: true,
      authorizationSha256: sha256(authorization),
    };
  });
  const retained = canonicalJson(sanitized);
  assert.equal(retained.includes(secret), false, "Sanitized AI transcript retained its secret.");
  return { records: sanitized, sha256: sha256(retained) };
}

export function inspectM4Png(
  bytes,
  label = "M4 evidence",
  maximumBytes = MAX_THUMBNAIL_BYTES,
  limits = SCREENSHOT_PNG_LIMITS,
) {
  const png = Buffer.from(bytes);
  assert.ok(Number.isSafeInteger(maximumBytes) && maximumBytes >= 57, `${label} PNG budget is invalid.`);
  assert.ok(exactRecord(limits)
    && Number.isSafeInteger(limits.maximumWidth) && limits.maximumWidth > 0 && limits.maximumWidth <= 4_096
    && Number.isSafeInteger(limits.maximumHeight) && limits.maximumHeight > 0 && limits.maximumHeight <= 4_096
    && Number.isSafeInteger(limits.maximumDecodedBytes) && limits.maximumDecodedBytes > 0
    && limits.maximumDecodedBytes <= 65 * 1024 * 1024
    && (limits.exactWidth === undefined || (Number.isSafeInteger(limits.exactWidth) && limits.exactWidth > 0))
    && (limits.exactHeight === undefined || (Number.isSafeInteger(limits.exactHeight) && limits.exactHeight > 0)), `${label} PNG decoded-image budget is invalid.`);
  assert.ok(png.byteLength >= 57 && png.byteLength <= maximumBytes, `${label} PNG size is invalid.`);
  assert.ok(png.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE), `${label} is not a PNG.`);
  let offset = PNG_SIGNATURE.byteLength;
  let chunkIndex = 0;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let sawIdat = false;
  let sawIend = false;
  const idat = [];
  while (offset < png.byteLength) {
    assert.ok(offset + 12 <= png.byteLength, `${label} PNG has a truncated chunk.`);
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const next = offset + 12 + length;
    assert.ok(Number.isSafeInteger(next) && next <= png.byteLength, `${label} PNG chunk overruns its bytes.`);
    const expectedCrc = png.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(png.subarray(offset + 4, offset + 8 + length));
    assert.equal(actualCrc, expectedCrc, `${label} PNG ${type} CRC is invalid.`);
    if (chunkIndex === 0) {
      assert.equal(type, "IHDR", `${label} PNG has no leading IHDR.`);
      assert.equal(length, 13, `${label} PNG IHDR length is not 13.`);
      width = png.readUInt32BE(offset + 8);
      height = png.readUInt32BE(offset + 12);
      assert.ok(Number.isSafeInteger(width) && Number.isSafeInteger(height)
        && width > 0 && height > 0
        && width <= limits.maximumWidth && height <= limits.maximumHeight
        && (limits.exactWidth === undefined || width === limits.exactWidth)
        && (limits.exactHeight === undefined || height === limits.exactHeight), `${label} PNG dimensions exceed the allowed image bounds.`);
      bitDepth = png[offset + 16];
      colorType = png[offset + 17];
      assert.equal(png[offset + 18], 0, `${label} PNG uses unsupported compression.`);
      assert.equal(png[offset + 19], 0, `${label} PNG uses unsupported filtering.`);
      assert.equal(png[offset + 20], 0, `${label} PNG must be non-interlaced.`);
    } else {
      assert.notEqual(type, "IHDR", `${label} PNG contains a repeated IHDR.`);
    }
    if (type === "IDAT") {
      sawIdat = true;
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    }
    if (type === "IEND") {
      assert.equal(length, 0, `${label} PNG IEND must be empty.`);
      assert.equal(next, png.byteLength, `${label} PNG contains bytes after IEND.`);
      sawIend = true;
    }
    offset = next;
    chunkIndex += 1;
  }
  assert.equal(sawIdat, true, `${label} PNG has no IDAT chunk.`);
  assert.equal(sawIend, true, `${label} PNG has no terminal IEND chunk.`);
  const validDepths = {
    0: new Set([1, 2, 4, 8, 16]),
    2: new Set([8, 16]),
    3: new Set([1, 2, 4, 8]),
    4: new Set([8, 16]),
    6: new Set([8, 16]),
  };
  assert.equal(validDepths[colorType]?.has(bitDepth), true, `${label} PNG color type or bit depth is invalid.`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bitsPerRow = width * channels * bitDepth;
  assert.ok(Number.isSafeInteger(bitsPerRow) && bitsPerRow > 0, `${label} PNG decoded row size is invalid.`);
  const rowBytes = Math.ceil(bitsPerRow / 8);
  const decodedByteLength = height * (rowBytes + 1);
  assert.ok(Number.isSafeInteger(decodedByteLength) && decodedByteLength > 0
    && decodedByteLength <= limits.maximumDecodedBytes, `${label} PNG decoded size exceeds the allowed image budget.`);
  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(idat), { maxOutputLength: decodedByteLength });
  } catch (error) {
    throw new Error(`${label} PNG IDAT is not decodable.`, { cause: error });
  }
  assert.equal(decoded.byteLength, decodedByteLength, `${label} PNG decoded byte length is invalid.`);
  for (let row = 0; row < height; row += 1) {
    assert.ok(decoded[row * (rowBytes + 1)] <= 4, `${label} PNG scanline filter is invalid.`);
  }
  return {
    byteLength: png.byteLength,
    width,
    height,
    sha256: sha256(png),
  };
}

function taggedContext(messages, tag) {
  const text = messages.map((message) => typeof message?.content === "string" ? message.content : "").join("\n");
  const expression = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`, "gu");
  const matches = [...text.matchAll(expression)];
  assert.equal(matches.length, 1, `M4 raw request must contain exactly one ${tag} context section.`);
  return matches[0][1];
}

function rawToolResult(messages, toolName) {
  const matches = messages.filter((message) => message?.role === "tool" && message?.tool_name === toolName);
  assert.equal(matches.length, 1, `M4 raw request must contain exactly one ${toolName} tool result.`);
  return parseJsonRecord(matches[0].content, `${toolName} tool result`);
}

export function validateM4RawTranscriptSemantics(records, {
  contextFixtureSource,
  agentSource,
  agentConsoleRunsBefore,
  agentConsoleRunsAfter,
}) {
  assert.ok(Array.isArray(records) && records.length === 7, "M4 semantic transcript requires exactly seven raw requests.");
  const bodies = records.map((record) => parseJsonRecord(record.requestBody, `M4 raw request ${record.ordinal}`));
  const firstMessages = bodies[0].messages;
  assert.ok(Array.isArray(firstMessages), "M4 first request messages are unavailable.");
  assert.equal(taggedContext(firstMessages, "current-file"), contextFixtureSource, "M4 current-file context bytes changed.");
  assert.match(taggedContext(firstMessages, "diagnostics"), /Ignoring unknown variable ['"]?m4_missing_context_value/iu, "M4 context lacks the known native warning.");
  assert.equal(taggedContext(firstMessages, "parameters").trim(), "width = 10", "M4 context lacks the exact Customizer parameter.");
  const contextScreenshot = dataUrlPng(taggedContext(firstMessages, "viewer-screenshot").trim(), "M4 AI context screenshot", 2 * 1024 * 1024);
  for (const body of bodies.slice(1, 5)) {
    const text = body.messages.map((message) => typeof message?.content === "string" ? message.content : "").join("\n");
    assert.equal(/<(?:current-file|diagnostics|parameters|viewer-screenshot)>/u.test(text), false, "Disabled M4 context leaked into an agent request.");
  }
  for (const body of bodies.slice(5)) {
    assert.equal(taggedContext(body.messages, "current-file"), agentSource, "Re-enabled M4 source context differs from the approved agent source.");
  }
  const previewResult = rawToolResult(bodies[2].messages, "render_preview");
  assert.equal(previewResult.kind, "3d", "M4 agent render tool did not return 3D geometry.");
  assert.ok(exactRecord(previewResult.stats)
    && Number.isSafeInteger(previewResult.stats.triangles)
    && previewResult.stats.triangles > 0, "M4 agent render tool lacks positive triangle statistics.");
  assert.ok(Array.isArray(previewResult.diagnostics), "M4 agent render diagnostics are not an array.");
  const diagnosticsResult = rawToolResult(bodies[3].messages, "get_diagnostics");
  assert.equal(diagnosticsResult.quality, "preview", "M4 agent diagnostic result is not from preview geometry.");
  assert.ok(safeString(diagnosticsResult.renderId, 512), "M4 agent diagnostic result lacks its render identity.");
  assert.ok(Array.isArray(diagnosticsResult.diagnostics), "M4 agent diagnostic payload is not an array.");
  assert.equal(agentConsoleRunsAfter - agentConsoleRunsBefore, 1, "M4 agent render tool did not add exactly one observable engine console run.");
  return {
    contextSourceSha256: sha256(contextFixtureSource),
    contextScreenshotSha256: contextScreenshot.sha256,
    contextScreenshotWidth: contextScreenshot.width,
    contextScreenshotHeight: contextScreenshot.height,
    renderTriangles: previewResult.stats.triangles,
    diagnosticCount: diagnosticsResult.diagnostics.length,
    agentRenderConsoleRunsAdded: 1,
  };
}

function dataUrlPng(value, label, maximumBytes = MAX_THUMBNAIL_BYTES, limits = SCREENSHOT_PNG_LIMITS) {
  assert.ok(typeof value === "string" && value.startsWith("data:image/png;base64,"), `${label} is not a PNG data URL.`);
  return inspectM4Png(Buffer.from(value.slice("data:image/png;base64,".length), "base64"), label, maximumBytes, limits);
}

function validateThumbnailSnapshot(snapshot, projectPath, surface) {
  assert.ok(exactRecord(snapshot) && Array.isArray(snapshot.storageEntries), "Thumbnail snapshot has the wrong shape.");
  assert.equal(snapshot.storageEntries.length, 1, "Thumbnail persistence must have one project envelope.");
  const entry = snapshot.storageEntries[0];
  assert.ok(exactKeys(entry, ["key", "value"])
    && typeof entry.key === "string"
    && new RegExp(`^${THUMBNAIL_STORAGE_PREFIX.replaceAll(".", "\\.")}[a-f0-9]{64}$`, "u").test(entry.key), "Thumbnail storage key is not opaque.");
  const envelope = parseJsonRecord(entry.value, "Thumbnail envelope");
  assert.ok(exactKeys(envelope, ["records", "version"])
    && envelope.version === 1 && Array.isArray(envelope.records), "Thumbnail envelope has the wrong shape.");
  const matching = envelope.records.filter((record) => record?.documentPath === projectPath);
  assert.equal(matching.length, 1, "Thumbnail envelope must contain the active file exactly once.");
  const record = matching[0];
  assert.ok(exactKeys(record, ["documentPath", "renderIdentity", "capturedAt", "pngBase64"]), "Thumbnail record has the wrong shape.");
  assert.match(record.renderIdentity, /^[a-f0-9]{64}$/u, "Thumbnail geometry identity is not canonical SHA-256.");
  assert.ok(Number.isFinite(Date.parse(record.capturedAt)), "Thumbnail timestamp is invalid.");
  const png = inspectM4Png(Buffer.from(record.pngBase64, "base64"), "Persisted thumbnail", MAX_THUMBNAIL_BYTES, THUMBNAIL_PNG_LIMITS);
  const visual = snapshot[surface];
  assert.ok(exactKeys(visual, ["count", "src", "complete", "naturalWidth", "naturalHeight", "decoded"])
    && visual.count === 1, `${surface} must show one thumbnail.`);
  assert.deepEqual({
    complete: visual.complete,
    naturalWidth: visual.naturalWidth,
    naturalHeight: visual.naturalHeight,
    decoded: visual.decoded,
  }, {
    complete: true,
    naturalWidth: 240,
    naturalHeight: 160,
    decoded: true,
  }, `${surface} thumbnail did not complete and decode at 240 by 160.`);
  const displayed = dataUrlPng(visual.src, `${surface} thumbnail`, MAX_THUMBNAIL_BYTES, THUMBNAIL_PNG_LIMITS);
  assert.equal(displayed.sha256, png.sha256, `${surface} thumbnail differs from persisted bytes.`);
  return { ...png, documentPath: record.documentPath, renderIdentity: record.renderIdentity };
}

function assertSecretAbsent(snapshot, secret) {
  assert.ok(exactKeys(snapshot, ["body", "consoleText", "localStorage", "sessionStorage"]), "Secret-surface snapshot has the wrong shape.");
  for (const [surface, content] of Object.entries(snapshot)) {
    assert.equal(typeof content, "string", `Secret surface ${surface} is not text.`);
    assert.equal(content.includes(secret), false, `Synthetic AI secret leaked into ${surface}.`);
  }
}

function assertLoopbackMock(mock) {
  assert.ok(exactKeys(mock, ["endpoint", "model", "secret"]), "AI mock identity has the wrong shape.");
  const endpoint = new URL(mock.endpoint);
  assert.equal(endpoint.protocol, "http:", "AI mock must use HTTP inside the isolated guest.");
  assert.equal(endpoint.hostname, "127.0.0.1", "AI mock must bind loopback only.");
  assert.ok(/^\d+$/u.test(endpoint.port) && Number(endpoint.port) > 0, "AI mock must use an explicit ephemeral port.");
  assert.ok(safeString(mock.model, 256) && safeString(mock.secret, 512), "AI mock model or secret is invalid.");
  return mock;
}

function assertMcpEvidence(denied, allowed) {
  assert.deepEqual(denied, {
    error: { code: -32001, message: "MCP mutation denied by the current permission gate." },
    writeOccurred: false,
  }, "MCP default-deny probe did not fail closed with -32001.");
  assert.equal(allowed?.protocolVersion, "2025-11-25", "MCP protocol version is wrong.");
  assert.deepEqual([...allowed.toolNames].sort(), EXPECTED_MCP_TOOLS, "MCP tool surface is not Appendix B exact.");
  assert.deepEqual(allowed.preview, { kind: "3d", triangles: 12 }, "MCP preview result is wrong.");
  assert.equal(allowed.diagnostics?.quality, "preview", "MCP diagnostics quality is wrong.");
  assert.ok(Number.isSafeInteger(allowed.diagnostics?.count) && allowed.diagnostics.count >= 0, "MCP diagnostics count is invalid.");
  assert.deepEqual(allowed.pendingReview, { status: "pending_review" }, "MCP mutation skipped pending review.");
  assert.equal(allowed.mutationApproved, true, "MCP mutation was not explicitly approved.");
}

async function screenshot(automation, screenshots, name) {
  const bytes = await automation.captureScreenshot(name);
  const png = inspectM4Png(bytes, name, 16 * 1024 * 1024);
  screenshots.push({ name, sha256: png.sha256, byteLength: png.byteLength });
}

function validateCachedPaint(value, limitMs) {
  assert.ok(exactKeys(value, ["elapsedMs", "status", "consoleRunsBefore", "consoleRunsAfter", "canvasVisible"]), "Cached-paint observation has the wrong shape.");
  assert.ok(Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0 && value.elapsedMs < limitMs, `Cached full render painted in ${value.elapsedMs} ms, not under ${limitMs} ms.`);
  assert.match(value.status, /Rendered .+ \(3d, cached\)$/u, "Cached-paint status is not exact.");
  assert.equal(value.consoleRunsAfter, value.consoleRunsBefore, "Cached render launched an engine console run.");
  assert.equal(value.canvasVisible, true, "Cached render did not leave a visible viewer canvas.");
  return value;
}

function validateRestart(value) {
  assert.ok(exactKeys(value, ["beforePid", "afterPid", "freshWebViewProcesses"]), "Restart observation has the wrong shape.");
  assert.ok(Number.isSafeInteger(value.beforePid) && value.beforePid > 0, "Restart prior PID is invalid.");
  assert.ok(Number.isSafeInteger(value.afterPid) && value.afterPid > 0 && value.afterPid !== value.beforePid, "Restart did not create a fresh application process.");
  assert.equal(value.freshWebViewProcesses, true, "Restart did not create fresh WebView processes.");
}

export async function waitForM4AiProposalOutcome(
  automation,
  expectedSource,
  {
    timeoutMs = 60_000,
    intervalMs = 50,
    delayImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) {
  assert.ok(exactRecord(automation) && typeof automation.execute === "function", "M4 AI outcome wait requires automation execution.");
  assert.ok(safeString(expectedSource, 1_000_000), "M4 AI outcome wait requires bounded expected source.");
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    && Number.isSafeInteger(intervalMs) && intervalMs > 0 && intervalMs <= timeoutMs
    && typeof delayImpl === "function", "M4 AI outcome wait options are invalid.");
  const deadline = Date.now() + timeoutMs;
  let lastObservation;
  do {
    const observation = await automation.execute(M4_DOM_SCRIPTS.aiProposalOutcome, [expectedSource.trim()]);
    assert.ok(exactKeys(observation, ["aiVisible", "proposalCount", "pendingProposalCount", "assistantCount", "assistantHasExpected", "alertText"]), "M4 AI proposal-outcome observation has the wrong shape.");
    assert.equal(typeof observation.aiVisible, "boolean", "M4 AI proposal visibility observation is invalid.");
    for (const key of ["proposalCount", "pendingProposalCount", "assistantCount"]) {
      assert.ok(Number.isSafeInteger(observation[key]) && observation[key] >= 0, `M4 AI ${key} is invalid.`);
    }
    assert.equal(typeof observation.assistantHasExpected, "boolean", "M4 AI assistant source observation is invalid.");
    assert.ok(typeof observation.alertText === "string" && observation.alertText.length <= 1_000, "M4 AI alert observation is invalid.");
    if (observation.alertText) {
      throw new Error(`M4 AI request failed before producing a proposal: visible error (sha256 ${sha256(observation.alertText)}).`);
    }
    if (observation.proposalCount > 1 || observation.pendingProposalCount > 1) {
      throw new Error(`M4 AI request produced an ambiguous proposal set: ${JSON.stringify(observation)}`);
    }
    if (observation.aiVisible && observation.proposalCount === 1
      && observation.pendingProposalCount === 1 && observation.assistantHasExpected) return observation;
    lastObservation = observation;
    await delayImpl(intervalMs);
  } while (Date.now() < deadline);
  throw new Error(`M4 AI proposal did not arrive within ${timeoutMs} ms; last observation: ${JSON.stringify(lastObservation)}`);
}

function aiFailureTranscriptDiagnostic(records) {
  if (!Array.isArray(records)) return { requestCount: null, ordinals: [], responseToolNames: [] };
  return {
    requestCount: records.length,
    ordinals: records.slice(0, 8).map((record) => Number.isSafeInteger(record?.ordinal) ? record.ordinal : null),
    responseToolNames: records.slice(0, 8).map((record) => safeString(record?.responseToolName, 128) ? record.responseToolName : null),
  };
}

export async function runM4PackagedWalkthrough({
  automation,
  initialSource,
  proposalSource,
  agentSource,
  projectPath,
  cachePaintLimitMs = 100,
  aiConversationMode = "automated",
}) {
  assert.ok(exactRecord(automation), "M4 walkthrough requires an automation adapter.");
  for (const name of ["readSource", "replaceSource", "waitForSource", "activateRail", "clickAria", "clickButton", "setControl", "setChecked", "waitForText", "execute", "executeAsync", "captureScreenshot", "startAiMock", "stopAiMock", "probeMcpDefaultDeny", "runMcpAllowSessionJourney", "restartApplication"]) {
    assert.equal(typeof automation[name], "function", `M4 automation adapter is missing ${name}.`);
  }
  for (const [name, value] of Object.entries({ initialSource, proposalSource, agentSource, projectPath })) {
    assert.ok(safeString(value, 1_000_000), `M4 ${name} is invalid.`);
  }
  assert.ok(Number.isFinite(cachePaintLimitMs) && cachePaintLimitMs > 0 && cachePaintLimitMs <= 100, "M4 cache-paint limit must be greater than zero and no more than 100 ms.");
  assert.ok(["automated", "hosted-plus-manual"].includes(aiConversationMode), "M4 AI conversation mode is invalid.");
  assert.equal(await automation.readSource(), initialSource, "M4 walkthrough did not start from the declared source.");

  const order = [];
  const screenshots = [];
  let mock;
  let mockStopped = false;
  let networkMonitorActive = false;
  let failureMockDiagnostic;
  let result;
  let failure;
  let finalNetworkObservation;
  let contextFixtureSource;
  let agentConsoleRunsBefore;
  let agentConsoleRunsAfter;
  try {
    const initialNetworkObservationRaw = await automation.execute(M4_DOM_SCRIPTS.installNetworkAttemptMonitor);
    networkMonitorActive = true;
    const initialNetworkObservation = validateM4ZeroNetworkAttempts(initialNetworkObservationRaw);
    await automation.activateRail("AI");
    await automation.waitForText("AI is not configured.");
    const unconfigured = await automation.execute(M4_DOM_SCRIPTS.aiUnconfigured);
    assert.deepEqual(unconfigured, { guidanceVisible: true, sendCount: 0 }, "Unconfigured AI exposed a send path or lost its setup guidance.");
    const finalNetworkObservationRaw = await automation.execute(M4_DOM_SCRIPTS.networkAttemptSnapshot);
    networkMonitorActive = false;
    finalNetworkObservation = validateM4ZeroNetworkAttempts(finalNetworkObservationRaw);
    assert.equal(
      finalNetworkObservation.tauriInvokeMonitoring,
      initialNetworkObservation.tauriInvokeMonitoring,
      "Tauri invoke monitoring status changed during the unconfigured-AI probe.",
    );
    order.push("c10-unconfigured");
    await screenshot(automation, screenshots, "04a-ai-unconfigured.png");

    if (aiConversationMode === "automated") {
      mock = assertLoopbackMock(await automation.startAiMock({
      proposalSource,
      agentSource,
      cappedRounds: 2,
    }));
    await automation.clickAria("Open settings");
    await automation.setControl("Search settings", "AI");
    await automation.setControl("AI provider", "local");
    await automation.setControl("AI endpoint", mock.endpoint);
    await automation.setControl("AI model", mock.model);
    await automation.setControl("AI API key", mock.secret);
    const committedAiProfile = await automation.execute(M4_DOM_SCRIPTS.settingsAiProfileSnapshot);
    assert.deepEqual(committedAiProfile, {
      provider: "local",
      endpoint: mock.endpoint,
      model: mock.model,
    }, "Packaged Settings did not retain the exact AI profile before close.");
    await automation.clickButton("Save AI key");
    await automation.waitForText("AI key saved.");
    await automation.clickAria("Close settings");
    await automation.activateRail("AI");
    const conversationModel = await automation.execute(M4_DOM_SCRIPTS.conversationModelSnapshot);
    assert.ok(exactKeys(conversationModel, ["optionCount", "selectedLabel", "selectedValue"]), "Conversation-model observation has the wrong shape.");
    assert.equal(conversationModel.optionCount, 1, "The bounded M4 journey requires exactly one configured conversation model.");
    assert.ok(conversationModel.selectedLabel.includes(mock.model), "The sole conversation-model label does not identify the configured mock model.");
    assert.match(conversationModel.selectedValue, /^model-[a-f0-9]+$/u, "Conversation model did not use its generated model identity.");
      contextFixtureSource = "width = 10; // [1:1:20]\necho(m4_missing_context_value);\ncube([width, 10, 10]);";
    await automation.replaceSource(contextFixtureSource);
    await automation.executeAsync(M4_DOM_SCRIPTS.fullRenderCompleted, [projectPath]);
    await automation.clickAria("Capture viewport as PNG");
    await automation.waitForText("Scene-only PNG captured.");
    await automation.setChecked("Current file", true);
    await automation.setChecked("Diagnostics", true);
    await automation.setChecked("Parameters", true);
    await automation.setChecked("Viewer screenshot", true);
    await automation.setControl("Message", "Change the cube to the exact requested dimensions.");
    await automation.clickButton("Send");
    await waitForM4AiProposalOutcome(automation, proposalSource);
    await automation.setChecked("Inline", true);
    await automation.clickButton("Use disk change");
    await automation.clickButton("Apply hunk choices");
    await automation.waitForText("accepted");
    await automation.waitForSource(proposalSource);
    assert.equal(await automation.readSource(), proposalSource, "AI proposal did not apply exact source.");
    assert.deepEqual(await automation.execute(M4_DOM_SCRIPTS.aiProposal), {
      acceptedCount: 1,
      assistantRoles: 1,
      pendingProposals: 0,
    }, "AI proposal evidence is not exactly one accepted assistant proposal.");
    order.push("c10-proposal");
    await screenshot(automation, screenshots, "04b-ai-proposal-applied.png");

    await automation.setChecked("Current file", false);
    await automation.setChecked("Diagnostics", false);
    await automation.setChecked("Parameters", false);
    await automation.setChecked("Viewer screenshot", false);
    await automation.setChecked("Allow tool calls for this conversation", true);
    await automation.setControl("Maximum tool-call rounds", "6");
      agentConsoleRunsBefore = await automation.execute(M4_DOM_SCRIPTS.consoleRunCount);
    assert.ok(exactKeys(agentConsoleRunsBefore, ["count"])
      && Number.isSafeInteger(agentConsoleRunsBefore.count), "M4 agent console-run baseline is invalid.");
    await automation.setControl("Message", "Render, inspect diagnostics, and propose the exact agent edit.");
    await automation.clickButton("Send");
    await automation.waitForText("Agent status: completed");
      agentConsoleRunsAfter = await automation.execute(M4_DOM_SCRIPTS.consoleRunCount);
    assert.ok(exactKeys(agentConsoleRunsAfter, ["count"])
      && Number.isSafeInteger(agentConsoleRunsAfter.count), "M4 agent console-run result is invalid.");
    await automation.activateRail("History");
    await automation.waitForText("Pending review");
    await screenshot(automation, screenshots, "04c-ai-agent-pending-diff.png");
    await automation.clickButton("Approve change");
    await automation.waitForSource(agentSource);
    assert.equal(await automation.readSource(), agentSource, "AI agent review did not apply exact source.");
    order.push("c10-agent");

    await automation.activateRail("AI");
    await automation.setChecked("Allow tool calls for this conversation", true);
    await automation.setChecked("Current file", true);
    await automation.setChecked("Diagnostics", true);
    await automation.setChecked("Parameters", true);
    await automation.setControl("Maximum tool-call rounds", "2");
    await automation.setControl("Message", "Exercise the bounded looping-tool response.");
    await automation.clickButton("Send");
    await automation.waitForText("Agent status: capped");
    order.push("c10-agent-cap");
      assertSecretAbsent(await automation.execute(M4_DOM_SCRIPTS.secretSurfaceSnapshot), mock.secret);
    }

    const denied = await automation.probeMcpDefaultDeny();
    order.push("c11-default-deny");
    const allowed = await automation.runMcpAllowSessionJourney();
    assertMcpEvidence(denied, allowed);
    order.push("c11-allow-session");

    await automation.clickAria("Open settings");
    await automation.setControl("Search settings", "Rendering");
    await automation.setChecked("Persist render cache for this project", true);
    await automation.clickAria("Close settings");
    await automation.replaceSource(`${initialSource}\n// M4 cache baseline`);
    const baselineRun = await automation.executeAsync(M4_DOM_SCRIPTS.fullRenderCompleted, [projectPath]);
    assert.ok(exactKeys(baselineRun, ["consoleRunsBefore", "consoleRunsAfter", "status", "canvasVisible"]), "Baseline full-render evidence has the wrong shape.");
    assert.equal(baselineRun.consoleRunsAfter - baselineRun.consoleRunsBefore, 1, "Baseline full render did not produce exactly one new engine run.");
    const baseline = await automation.execute(M4_DOM_SCRIPTS.renderSnapshot);
    assert.equal(baseline.canvasVisible, true, "Baseline full render did not paint a viewer canvas.");
    assert.equal(baseline.consoleRuns, baselineRun.consoleRunsAfter, "Baseline DOM run count differs from its completion observation.");
    const cached = validateCachedPaint(await automation.executeAsync(M4_DOM_SCRIPTS.cachedPaint), cachePaintLimitMs);
    order.push("cache");

    await automation.replaceSource(`// cosmetic-only\n${initialSource}\n// M4 cache baseline`);
    await automation.executeAsync(M4_DOM_SCRIPTS.fullRenderCompleted, [projectPath]);
    await automation.waitForText("Geometry unchanged");
    const unchanged = await automation.execute(M4_DOM_SCRIPTS.geometrySnapshot);
    assert.deepEqual(unchanged, { summary: "Geometry unchanged", detail: "Geometry unchanged" }, "Cosmetic edit did not report unchanged geometry.");
    await automation.replaceSource(proposalSource.trimEnd());
    await automation.executeAsync(M4_DOM_SCRIPTS.fullRenderCompleted, [projectPath]);
    await automation.waitForText("Geometry changed");
    const changed = await automation.execute(M4_DOM_SCRIPTS.geometrySnapshot);
    const deltaText = `${changed.summary}\n${changed.detail}`;
    assert.match(deltaText, /(?:\+|\u0394V\s*)200(?:\.0+)?\s*mm(?:³|3)/iu, "Geometry volume delta is not +200 mm3.");
    assert.match(deltaText, /\u0394bounds\s+\+2(?:\.0+)?\/0(?:\.0+)?\/0(?:\.0+)?\s*mm\s+size/iu, "Geometry bounds-size delta is not +2/0/0 mm.");
    order.push("delta");
    await screenshot(automation, screenshots, "04d-cache-geometry-delta.png");

    await automation.replaceSource("cube([10 + $t * 2, 10, 10]);");
    const animationStart = await automation.execute(M4_DOM_SCRIPTS.installAnimationMonitor);
    assert.ok(exactKeys(animationStart, ["consoleRuns"])
      && Number.isSafeInteger(animationStart.consoleRuns) && animationStart.consoleRuns >= 0, "Animation monitor could not establish its phase baseline.");
    await automation.setControl("Animation frame", "50");
    await automation.waitForText("Frame 51 of 100");
    const scrubFrame = await automation.executeAsync(M4_DOM_SCRIPTS.animationScrubCompleted);
    assert.ok(exactKeys(scrubFrame, ["consoleRunsBefore", "consoleRunsAfter", "status"]), "Animation scrub evidence has the wrong shape.");
    assert.equal(scrubFrame.consoleRunsBefore, animationStart.consoleRuns, "Animation scrub used the wrong phase baseline.");
    assert.equal(scrubFrame.consoleRunsAfter - scrubFrame.consoleRunsBefore, 1, "Frame 51 scrub did not complete exactly one new engine run.");
    assert.match(scrubFrame.status, /^Rendered /u, "Frame 51 scrub did not finish rendering.");
    await automation.setControl("Animation FPS", "24");
    const playedFrame = await automation.executeAsync(M4_DOM_SCRIPTS.animationPlayFrameCompleted);
    assert.ok(exactKeys(playedFrame, ["consoleRunsBefore", "consoleRunsAfter", "status", "paused", "playLabel"]), "Animation Play evidence has the wrong shape.");
    assert.equal(playedFrame.consoleRunsBefore, scrubFrame.consoleRunsAfter, "Animation Play did not start from the completed scrub run.");
    assert.equal(playedFrame.consoleRunsAfter - playedFrame.consoleRunsBefore, 1, "Animation Play did not complete exactly one new engine run before Pause.");
    assert.match(playedFrame.status, /^Rendered /u, "Animation Play frame did not finish rendering.");
    assert.deepEqual({ paused: playedFrame.paused, playLabel: playedFrame.playLabel }, {
      paused: true,
      playLabel: "Play animation",
    }, "Animation Play was not paused in-page before the probe resolved.");
    const animation = await automation.execute(M4_DOM_SCRIPTS.animationSnapshot);
    assert.deepEqual({
      frame: animation.frame,
      time: animation.time,
      fps: animation.fps,
      playLabel: animation.playLabel,
      overlapObserved: animation.overlapObserved,
    }, {
      frame: "Frame 52 of 100",
      time: "$t 0.51",
      fps: "24",
      playLabel: "Play animation",
      overlapObserved: false,
    }, "Animation did not advance to frame 52, $t 0.51, 24 FPS, and serialized runs.");
    assert.ok(animation.consoleRuns >= playedFrame.consoleRunsAfter, "Animation run count regressed after Pause.");
    order.push("animation");
    await screenshot(automation, screenshots, "04e-animation-frame-52.png");

    const thumbnailCacheSource = `${initialSource}\n// M4 thumbnail cold-cache`;
    const thumbnailCaptureNotBeforeMs = Date.now();
    await automation.replaceSource(thumbnailCacheSource);
    await automation.executeAsync(M4_DOM_SCRIPTS.fullRenderCompleted, [projectPath]);
    await automation.activateRail("Files");
    assert.equal(await automation.execute(M4_DOM_SCRIPTS.focusFileTreeThumbnail, [projectPath]), true, "Active file could not be focused for thumbnail preview.");
    const fileTreeThumbnail = validateThumbnailSnapshot(await automation.executeAsync(
      M4_DOM_SCRIPTS.thumbnailDecodedSnapshot,
      ["fileTree", projectPath, thumbnailCaptureNotBeforeMs],
    ), projectPath, "fileTree");
    order.push("thumbnail");
    await screenshot(automation, screenshots, "04f-file-tree-thumbnail.png");
    await automation.clickButton("Welcome");
    await automation.waitForText("Recent projects");
    const welcomeThumbnail = validateThumbnailSnapshot(await automation.executeAsync(
      M4_DOM_SCRIPTS.thumbnailDecodedSnapshot,
      ["welcome", projectPath, thumbnailCaptureNotBeforeMs],
    ), projectPath, "welcome");
    assert.equal(welcomeThumbnail.sha256, fileTreeThumbnail.sha256, "Welcome and file tree thumbnails differ.");
    await screenshot(automation, screenshots, "04g-welcome-recent-thumbnail.png");
    await automation.clickAria("Close welcome");

    const restart = await automation.restartApplication(thumbnailCacheSource);
    validateRestart(restart);
    await automation.waitForText("ScadMill");
    await automation.clickButton("Welcome");
    await automation.waitForText("Recent projects");
    const restoredThumbnail = validateThumbnailSnapshot(await automation.executeAsync(
      M4_DOM_SCRIPTS.thumbnailDecodedSnapshot,
      ["welcome", projectPath, thumbnailCaptureNotBeforeMs],
    ), projectPath, "welcome");
    assert.equal(restoredThumbnail.sha256, fileTreeThumbnail.sha256, "Thumbnail bytes changed across restart.");
    await automation.clickAria("Close welcome");
    const coldCached = validateCachedPaint(await automation.executeAsync(M4_DOM_SCRIPTS.cachedPaint), cachePaintLimitMs);
    order.push("restart");
    await screenshot(automation, screenshots, "04h-cold-cache-restored-thumbnail.png");

    let aiEvidence;
    if (aiConversationMode === "automated") {
      const rawTranscript = await automation.stopAiMock();
      mockStopped = true;
      const semanticTranscript = validateM4RawTranscriptSemantics(rawTranscript, {
        contextFixtureSource,
        agentSource,
        agentConsoleRunsBefore: agentConsoleRunsBefore.count,
        agentConsoleRunsAfter: agentConsoleRunsAfter.count,
      });
      const transcript = sanitizeAiTranscript(rawTranscript, mock.secret);
      assert.equal(transcript.records.length, 7, "M4 AI mock must observe exactly seven bounded requests.");
      const selectedResponseToolSequence = transcript.records.map(({ responseToolName }) => responseToolName);
      assert.deepEqual(selectedResponseToolSequence, [
        null,
        "render_preview",
        "get_diagnostics",
        "write_file",
        null,
        "render_preview",
        "render_preview",
      ], "M4 AI responses did not follow the exact proposal, three-tool agent, final, and two-round cap sequence.");
      const contextPatterns = transcript.records.map(({ context }) => context);
      assert.deepEqual(contextPatterns, [
        { source: true, diagnostics: true, parameters: true, screenshot: true },
        { source: false, diagnostics: false, parameters: false, screenshot: false },
        { source: false, diagnostics: false, parameters: false, screenshot: false },
        { source: false, diagnostics: false, parameters: false, screenshot: false },
        { source: false, diagnostics: false, parameters: false, screenshot: false },
        { source: true, diagnostics: false, parameters: false, screenshot: false },
        { source: true, diagnostics: false, parameters: false, screenshot: false },
      ], "M4 AI context toggles did not produce the exact enabled, disabled, and re-enabled per-send request patterns.");
      assertSecretAbsent(await automation.execute(M4_DOM_SCRIPTS.secretSurfaceSnapshot), mock.secret);
      aiEvidence = {
        unconfiguredRequestCount: 0,
        unconfiguredRendererAttempts: finalNetworkObservation.rendererAttemptCount,
        unconfiguredRendererExternalAttempts: finalNetworkObservation.rendererExternalAttemptCount,
        unconfiguredRendererInternalAttempts: finalNetworkObservation.rendererInternalAttemptCount,
        unconfiguredRendererObservations: finalNetworkObservation.rendererObservations,
        unconfiguredTauriInvokeAttempts: finalNetworkObservation.tauriInvokeAttemptCount,
        unconfiguredInvokeMonitoring: finalNetworkObservation.tauriInvokeMonitoring,
        requestCount: transcript.records.length,
        proposalAccepted: true,
        agentStatus: "completed",
        capStatus: "capped",
        capToolRounds: 2,
        selectedResponseToolSequence,
        contextPatterns,
        semanticTranscript,
        transcript,
      };
    } else {
      aiEvidence = {
        mode: "hosted-plus-manual",
        unconfiguredRequestCount: 0,
        unconfiguredRendererAttempts: finalNetworkObservation.rendererAttemptCount,
        unconfiguredRendererExternalAttempts: finalNetworkObservation.rendererExternalAttemptCount,
        unconfiguredRendererInternalAttempts: finalNetworkObservation.rendererInternalAttemptCount,
        unconfiguredRendererObservations: finalNetworkObservation.rendererObservations,
        unconfiguredTauriInvokeAttempts: finalNetworkObservation.tauriInvokeAttemptCount,
        unconfiguredInvokeMonitoring: finalNetworkObservation.tauriInvokeMonitoring,
        requestCount: 0,
        hostedAutomationRequired: true,
        manualPackagedInputRequired: true,
      };
    }

    result = {
      schemaVersion: aiConversationMode === "automated" ? 1 : 2,
      status: "passed",
      order,
      ai: aiEvidence,
      mcp: { defaultDenyCode: denied.error.code, mutationApproved: allowed.mutationApproved },
      cache: {
        baselineConsoleRunsAdded: baselineRun.consoleRunsAfter - baselineRun.consoleRunsBefore,
        elapsedMs: cached.elapsedMs,
        consoleRunsAdded: cached.consoleRunsAfter - cached.consoleRunsBefore,
        coldElapsedMs: coldCached.elapsedMs,
        restoredAfterRestart: true,
      },
      delta: { unchanged: true, volumeDeltaMm3: 200, boundsDeltaMm: [2, 0, 0] },
      animation: {
        frame: 52,
        time: 0.51,
        fps: 24,
        scrubConsoleRunsAdded: scrubFrame.consoleRunsAfter - scrubFrame.consoleRunsBefore,
        playConsoleRunsAdded: playedFrame.consoleRunsAfter - playedFrame.consoleRunsBefore,
        serialized: true,
      },
      thumbnails: {
        documentPath: fileTreeThumbnail.documentPath,
        renderIdentity: fileTreeThumbnail.renderIdentity,
        pngSha256: fileTreeThumbnail.sha256,
        byteLength: fileTreeThumbnail.byteLength,
        width: fileTreeThumbnail.width,
        height: fileTreeThumbnail.height,
        persistedAcrossRestart: true,
      },
      restart,
      screenshots,
      source: {
        initialSha256: sha256(initialSource),
        restoredSha256: null,
        restoredExactly: false,
      },
    };
  } catch (error) {
    failure = error;
  } finally {
    if (networkMonitorActive) {
      try {
        await automation.execute(M4_DOM_SCRIPTS.networkAttemptSnapshot);
        networkMonitorActive = false;
      } catch (cleanupError) {
        failure = failure
          ? new AggregateError([failure, cleanupError], "M4 journey and network-monitor cleanup failed.")
          : cleanupError;
      }
    }
    if (mock && !mockStopped) {
      try {
        const failureTranscript = await automation.stopAiMock();
        failureMockDiagnostic = aiFailureTranscriptDiagnostic(failureTranscript);
      } catch (stopError) {
        failure = failure ? new AggregateError([failure, stopError], "M4 journey and AI mock shutdown failed.") : stopError;
      }
    }
    try {
      await automation.replaceSource(initialSource);
      const restored = await automation.readSource();
      assert.equal(restored, initialSource, "M4 source restoration was not exact.");
      if (result) {
        result.order.push("source-restored");
        result.source.restoredSha256 = sha256(restored);
        result.source.restoredExactly = true;
      }
    } catch (restoreError) {
      failure = failure ? new AggregateError([failure, restoreError], "M4 journey and source restoration failed.") : restoreError;
    }
  }
  if (failure && failureMockDiagnostic) {
    failure = new Error(
      `${failure instanceof Error ? failure.message : String(failure)}; safe AI mock diagnostic: ${JSON.stringify(failureMockDiagnostic)}`,
      { cause: failure },
    );
  }
  if (failure) throw failure;
  assert.ok(result, "M4 walkthrough produced no result.");
  return result;
}
