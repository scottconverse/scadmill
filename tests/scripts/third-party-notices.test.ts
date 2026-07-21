import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isNoticeFileName,
  readContainedFile,
  renderThirdPartyNotices,
  resolveActivatedCargoPackageIds,
  resolveContainedPath,
  windowsCargoTreeArguments,
} from "../../scripts/lib/third-party-notices.mjs";

describe("third-party notice generation", () => {
  it("retains license, notice, and copyright files without admitting arbitrary docs", () => {
    for (const name of ["LICENSE", "LICENSE_MIT", "COPYING.txt", "NOTICE", "COPYRIGHT"]) {
      expect(isNoticeFileName(name), name).toBe(true);
    }
    expect(isNoticeFileName("README.md")).toBe(false);
  });

  it("maps only the activated target Cargo tree and excludes inactive optional dependencies", () => {
    const metadata = {
      packages: [
        { id: "app-id", name: "app", version: "0.0.0" },
        { id: "runtime-id", name: "runtime", version: "1.0.0" },
        { id: "build-id", name: "build-helper", version: "2.0.0" },
        { id: "optional-id", name: "inactive-optional", version: "3.0.0" },
        { id: "dev-id", name: "dev-only", version: "4.0.0" },
      ],
    };

    const tree = [
      "app v0.0.0 (/workspace/app)",
      "runtime v1.0.0",
      "build-helper v2.0.0",
      "runtime v1.0.0",
    ].join("\n");
    expect([...resolveActivatedCargoPackageIds(metadata, tree)].sort()).toEqual([
      "app-id",
      "build-id",
      "runtime-id",
    ]);
  });

  it("pins cargo tree to the Windows target and normal/build edges", () => {
    expect(windowsCargoTreeArguments("manifest/Cargo.toml")).toEqual([
      "tree",
      "--locked",
      "--target",
      "x86_64-pc-windows-msvc",
      "--edges",
      "normal,build",
      "--no-dedupe",
      "--prefix",
      "none",
      "--format",
      "{p}",
      "--manifest-path",
      "manifest/Cargo.toml",
    ]);
  });

  it("rejects absolute and escaping dependency or manifest paths", () => {
    expect(resolveContainedPath("C:\\repo\\package", "LICENSE")).toBe(
      "C:\\repo\\package\\LICENSE",
    );
    expect(resolveContainedPath("/tmp/repo/package", "LICENSE")).toBe(
      "/tmp/repo/package/LICENSE",
    );
    for (const candidate of ["../secret.txt", "C:\\secret.txt", "/etc/passwd"]) {
      expect(() => resolveContainedPath("C:\\repo\\package", candidate)).toThrow(
        "must stay inside",
      );
    }
  });

  it("rejects a directory where a regular notice file is required", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-notice-directory-"));
    try {
      await mkdir(join(root, "LICENSE"));
      await expect(readContainedFile(root, "LICENSE")).rejects.toThrow(
        "is not a regular file",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an in-base link that resolves outside the declared directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-notice-link-"));
    const declared = join(root, "declared");
    const outside = join(root, "outside");
    try {
      await mkdir(declared);
      await mkdir(outside);
      await writeFile(join(outside, "LICENSE"), "outside notice\n", "utf8");
      await symlink(outside, join(declared, "linked"), process.platform === "win32" ? "junction" : "dir");
      await expect(readContainedFile(declared, join("linked", "LICENSE"))).rejects.toThrow(
        "must stay inside",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders deterministic, path-free inventory and deduplicated exact texts", () => {
    const input = {
      npmPackages: [
        {
          ecosystem: "npm" as const,
          name: "zeta",
          version: "1.0.0",
          license: "MIT",
          authors: ["Zed"],
          repository: "https://example.invalid/zeta",
          licenseTexts: [{ name: "LICENSE", text: "same exact license\n" }],
        },
      ],
      rustPackages: [
        {
          ecosystem: "cargo" as const,
          name: "alpha",
          version: "2.0.0",
          license: "MIT",
          authors: ["Ada"],
          repository: "https://example.invalid/alpha",
          licenseTexts: [{ name: "LICENSE-MIT", text: "same exact license\r\n" }],
        },
      ],
      webView2: {
        distribution: "Microsoft Edge WebView2 Evergreen Standalone Installer (x64)",
        termsUrl: "https://developer.microsoft.com/microsoft-edge/webview2/",
        distributionUrl:
          "https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution",
      },
      nsis: {
        distribution: "NSIS 3.11 installer and uninstaller stubs",
        compression: "zlib",
        sourceUrl: "https://nsis.sourceforge.io/Docs/AppendixI.html",
        licenseText: "exact NSIS zlib license\n",
      },
      msvc: {
        distribution: "Microsoft Visual C++ runtime support (statically linked)",
        termsUrl:
          "https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files",
      },
    };

    const first = renderThirdPartyNotices(input);
    const second = renderThirdPartyNotices(input);

    expect(first).toBe(second);
    expect(first.indexOf("cargo:alpha@2.0.0")).toBeLessThan(
      first.indexOf("npm:zeta@1.0.0"),
    );
    expect(first.match(/same exact license/g)).toHaveLength(1);
    expect(first).toContain("Microsoft Edge WebView2 Evergreen Standalone Installer");
    expect(first).toContain("NSIS 3.11");
    expect(first).toContain("Microsoft Visual C++ runtime support (statically linked)");
    expect(first).toContain("OpenSCAD is not bundled in the Windows installer");
    expect(first).not.toMatch(/[A-Z]:\\|node_modules|\.cargo\\registry|Generated at/i);
  });

  it("fails closed when a package has no exact license text", () => {
    expect(() =>
      renderThirdPartyNotices({
        npmPackages: [],
        rustPackages: [
          {
            ecosystem: "cargo",
            name: "missing",
            version: "1.0.0",
            license: "MIT",
            authors: [],
            repository: null,
            licenseTexts: [],
          },
        ],
        webView2: {
          distribution: "WebView2",
          termsUrl: "https://example.invalid/terms",
          distributionUrl: "https://example.invalid/distribution",
        },
        nsis: {
          distribution: "NSIS 3.11",
          compression: "zlib",
          sourceUrl: "https://example.invalid/nsis",
          licenseText: "exact NSIS license\n",
        },
        msvc: {
          distribution: "Microsoft Visual C++ runtime support (statically linked)",
          termsUrl: "https://example.invalid/msvc",
        },
      }),
    ).toThrow("missing@1.0.0 has no exact license text");
  });
});
