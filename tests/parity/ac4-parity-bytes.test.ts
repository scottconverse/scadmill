import { describe, expect, it } from "vitest";

import { canonicalAc4Bytes } from "./ac4-parity-bytes";

describe("AC-4.a owner-approved canonical bytes", () => {
  it("converts only SVG CRLF pairs to LF", () => {
    const raw = Uint8Array.from([0x41, 0x0d, 0x0a, 0x42, 0x0d, 0x43, 0x0a]);
    expect([...canonicalAc4Bytes("svg", raw)]).toEqual([
      0x41, 0x0a, 0x42, 0x0d, 0x43, 0x0a,
    ]);
  });

  it("does not normalize binary STL or mutate either raw input", () => {
    const raw = Uint8Array.from([0x0d, 0x0a, 0x00, 0xff]);
    const canonical = canonicalAc4Bytes("stl-binary", raw);
    expect([...canonical]).toEqual([...raw]);
    expect(canonical).not.toBe(raw);
    canonical[0] = 0;
    expect(raw[0]).toBe(0x0d);
  });
});
