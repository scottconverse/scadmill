import { describe, expect, it } from "vitest";

import { verifyTauriBundleIdentity } from "../../scripts/lib/tauri-bundle-identity.mjs";

const BUILT_TOKEN = "__TAURI_BUNDLE_TYPE_VAR_UNK";
const NSIS_TOKEN = "__TAURI_BUNDLE_TYPE_VAR_NSS";

function binaryWith(token: string, suffix = "same-payload") {
  return Buffer.from(`prefix:${token}:${suffix}`, "utf8");
}

describe("verifyTauriBundleIdentity", () => {
  it("accepts the single documented Tauri NSIS bundle-token patch", () => {
    const result = verifyTauriBundleIdentity(
      binaryWith(BUILT_TOKEN),
      binaryWith(NSIS_TOKEN),
    );

    expect(result.normalizedMatch).toBe(true);
    expect(result.patch).toEqual({
      from: BUILT_TOKEN,
      offset: 7,
      to: NSIS_TOKEN,
    });
    expect(result.builtSha256).not.toBe(result.packagedSha256);
    expect(result.builtSha256).toBe(result.normalizedPackagedSha256);
  });

  it("rejects any difference outside the bundle token", () => {
    expect(() =>
      verifyTauriBundleIdentity(
        binaryWith(BUILT_TOKEN),
        binaryWith(NSIS_TOKEN, "changed-payload"),
      ),
    ).toThrow("differs outside the documented Tauri bundle-type token");
  });

  it("rejects missing or duplicate bundle tokens", () => {
    expect(() =>
      verifyTauriBundleIdentity(Buffer.from("no token"), binaryWith(NSIS_TOKEN)),
    ).toThrow("exactly one unbundled token");

    expect(() =>
      verifyTauriBundleIdentity(
        binaryWith(BUILT_TOKEN),
        Buffer.from(`${NSIS_TOKEN}:${NSIS_TOKEN}`),
      ),
    ).toThrow("exactly one NSIS token");
  });
});
