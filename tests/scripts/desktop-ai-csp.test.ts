import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface TauriConfiguration {
  readonly app?: {
    readonly security?: {
      readonly csp?: string;
      readonly devCsp?: string;
    };
  };
}

function connectSources(policy: string | undefined): readonly string[] {
  const directive = policy?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("connect-src "));
  return directive?.split(/\s+/u).slice(1) ?? [];
}

describe("desktop AI content-security policy", () => {
  it("keeps provider HTTP out of the renderer and permits only Tauri IPC", () => {
    const configuration = JSON.parse(
      readFileSync("src/desktop-shell/src-tauri/tauri.conf.json", "utf8"),
    ) as TauriConfiguration;

    for (const [name, policy] of Object.entries({
      csp: configuration.app?.security?.csp,
      devCsp: configuration.app?.security?.devCsp,
    })) {
      const sources = connectSources(policy);
      expect(sources, `${name} must not expose arbitrary HTTP`).not.toContain("http:");
      expect(sources, `${name} must not expose arbitrary HTTPS`).not.toContain("https:");
      expect(sources, `${name} must stay bounded`).not.toContain("*");
      expect(sources, `${name} same-origin offline runtime assets`).toContain("'self'");
      expect(sources, `${name} Tauri IPC`).toContain("ipc:");
      expect(sources, `${name} Tauri IPC host`).toContain("http://ipc.localhost");
    }
  });
});
