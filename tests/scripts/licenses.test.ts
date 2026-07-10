import { describe, expect, it } from "vitest";

import { findDisallowedPackages, isAllowedLicenseExpression } from "../../scripts/lib/licenses.mjs";

describe("isAllowedLicenseExpression", () => {
  it("rejects Unicode-3.0 when it is a required license term", () => {
    expect(isAllowedLicenseExpression("Unicode-3.0")).toBe(false);
    expect(isAllowedLicenseExpression("(MIT OR Apache-2.0) AND Unicode-3.0")).toBe(false);
  });

  it("accepts expressions with a complete permitted choice", () => {
    expect(isAllowedLicenseExpression("MIT OR Apache-2.0 OR LGPL-2.1-or-later")).toBe(true);
    expect(isAllowedLicenseExpression("Apache-2.0 WITH LLVM-exception")).toBe(true);
    expect(isAllowedLicenseExpression("MIT/Apache-2.0")).toBe(true);
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

    expect(findDisallowedPackages(packages)).toEqual([packages[2], packages[3]]);
  });
});
