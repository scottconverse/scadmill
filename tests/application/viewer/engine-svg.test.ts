// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { sanitizeEngineSvg } from "../../../src/application/viewer/engine-svg";

const engineSvg = `<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="12mm" height="22mm" viewBox="1 -24 12 22" xmlns="http://www.w3.org/2000/svg" version="1.1">
<title>OpenSCAD Model</title>
<path d="M 2,-3 L 12,-3 L 12,-23 L 2,-23 z" stroke="black" fill="none" stroke-width="0.35"/>
</svg>`;

describe("engine SVG isolation", () => {
  it("preserves the pinned engine's geometry while removing the external doctype", () => {
    const sanitized = sanitizeEngineSvg(engineSvg);
    expect(sanitized).toContain("viewBox=\"1 -24 12 22\"");
    expect(sanitized).toContain("M 2,-3 L 12,-3 L 12,-23 L 2,-23 z");
    expect(sanitized).not.toContain("DOCTYPE");
    expect(sanitized).not.toContain("http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd");
  });

  it("normalizes the engine presentation margin to exact model bounds", () => {
    const sanitized = sanitizeEngineSvg(engineSvg, {
      min: [2, 3],
      max: [12, 23],
    });

    expect(sanitized).toContain('viewBox="2 -23 10 20"');
    expect(sanitized).toContain('width="10mm"');
    expect(sanitized).toContain('height="20mm"');
    expect(sanitized).not.toContain('viewBox="1 -24 12 22"');
  });

  it.each([
    `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/a.png"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(https://example.invalid/a)"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>html</div></foreignObject></svg>`,
  ])("rejects active or network-capable SVG %j", (source) => {
    expect(() => sanitizeEngineSvg(source)).toThrow(/unsafe|unsupported/i);
  });

  it("rejects malformed, non-SVG, and oversized engine output", () => {
    expect(() => sanitizeEngineSvg("<svg")).toThrow(/malformed/i);
    expect(() => sanitizeEngineSvg("<html></html>")).toThrow(/root/i);
    expect(() => sanitizeEngineSvg(`<svg xmlns="http://www.w3.org/2000/svg"><desc>${"x".repeat(5_000_001)}</desc></svg>`)).toThrow(/large/i);
  });
});
