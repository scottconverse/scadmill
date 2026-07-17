import { describe, expect, it } from "vitest";

import {
  nativeAccelerator,
  withoutConflictingAccelerators,
} from "../../../src/ui/layout/use-native-menu-state";

describe("nativeAccelerator", () => {
  it("canonicalizes Mod in any modifier position for the native menu grammar", () => {
    expect(nativeAccelerator("Mod+Shift+T")).toBe("CmdOrCtrl+Shift+T");
    expect(nativeAccelerator("Shift+Mod+T")).toBe("CmdOrCtrl+Shift+T");
    expect(nativeAccelerator("Alt+Mod+S")).toBe("CmdOrCtrl+Alt+S");
  });

  it("refuses pointer and unsupported modifier bindings instead of installing a broken accelerator", () => {
    expect(nativeAccelerator("Alt+Click")).toBeUndefined();
    expect(nativeAccelerator("Hyper+F5")).toBeUndefined();
    expect(nativeAccelerator("Mod+DefinitelyNotAKey")).toBeUndefined();
  });

  it("removes cross-scope accelerator collisions from every conflicting native item", () => {
    expect(withoutConflictingAccelerators({
      "edit.find": { enabled: true, accelerator: "CmdOrCtrl+K" },
      "render.preview": { enabled: true, accelerator: "CmdOrCtrl+K" },
      "render.full": { enabled: true, accelerator: "F6" },
    })).toEqual({
      "edit.find": { enabled: true },
      "render.preview": { enabled: true },
      "render.full": { enabled: true, accelerator: "F6" },
    });
  });
});
