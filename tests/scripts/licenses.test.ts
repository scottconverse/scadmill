import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { findDisallowedPackages, isAllowedLicenseExpression } from "../../scripts/lib/licenses.mjs";

describe("isAllowedLicenseExpression", () => {
  it("permits Unicode-3.0 alone and in unicode-ident's compound expression", () => {
    expect(isAllowedLicenseExpression("Unicode-3.0")).toBe(true);
    expect(isAllowedLicenseExpression("(MIT OR Apache-2.0) AND Unicode-3.0")).toBe(true);
  });

  it("requires every AND term to be permitted", () => {
    expect(isAllowedLicenseExpression("(MIT OR Apache-2.0) AND LicenseRef-Unknown")).toBe(false);
  });

  it("accepts expressions with a complete permitted choice", () => {
    expect(isAllowedLicenseExpression("MIT OR Apache-2.0 OR LGPL-2.1-or-later")).toBe(true);
    expect(isAllowedLicenseExpression("Apache-2.0 WITH LLVM-exception")).toBe(true);
    expect(isAllowedLicenseExpression("MIT/Apache-2.0")).toBe(true);
  });
});

describe("dependency-license command policy", () => {
  it("does not retain blocker copy for resolved Q-0001", () => {
    const source = readFileSync(new URL("../../scripts/check-licenses.mjs", import.meta.url), "utf8");

    expect(source).not.toContain("Blocked by spec/QUESTIONS.md Q-0001");
  });
});

describe("findDisallowedPackages", () => {
  it("reports unknown transitive licenses but excludes local workspace packages", () => {
    const packages = [
      { name: "scadmill", version: "0.0.0", license: "LicenseRef-Proprietary", source: null },
      { name: "react", version: "19.2.7", license: "MIT", source: "registry" },
      { name: "tinystr", version: "0.8.3", license: "Unicode-3.0", source: "registry" },
      { name: "mystery", version: "1.0.0", license: null, source: "registry" },
    ];

    expect(findDisallowedPackages(packages)).toEqual([packages[3]]);
  });
});
