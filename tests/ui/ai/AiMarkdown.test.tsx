// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiMarkdown } from "../../../src/ui/ai/AiMarkdown";

describe("AiMarkdown", () => {
  it("renders the supported block structures", () => {
    const { container } = render(<AiMarkdown content={`# Design note

Use the controls below.

- Preview quickly
- Export carefully

1. Edit
2. Render

\`\`\`scad
cube(10);
\`\`\``} />);

    expect(screen.getByRole("heading", { level: 1, name: "Design note" })).toBeVisible();
    expect(screen.getByText("Use the controls below.")).toBeVisible();
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelector("pre > code")).toHaveTextContent("cube(10);");
  });

  it("renders the supported inline structures and safe external links", () => {
    render(<AiMarkdown content={
      "Use *preview*, **full render**, `cube(10);`, and [OpenSCAD](https://openscad.org/)."
    } />);

    expect(screen.getByText("preview").tagName).toBe("EM");
    expect(screen.getByText("full render").tagName).toBe("STRONG");
    expect(screen.getByText("cube(10);").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "OpenSCAD" })).toHaveAttribute(
      "href",
      "https://openscad.org/",
    );
    expect(screen.getByRole("link", { name: "OpenSCAD" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "OpenSCAD" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("keeps raw HTML and unsafe link schemes inert", () => {
    const { container } = render(<AiMarkdown content={
      '<img src=x onerror="alert(1)"> [Run this](javascript:alert(1)) [Data](data:text/html,bad)'
    } />);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link", { name: "Run this" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Data" })).toBeNull();
    expect(screen.getByText(/<img src=x onerror=/u)).toBeVisible();
    expect(screen.getByText(/\[Run this\]\(javascript:/u)).toBeVisible();
  });

  it("renders https and http links but leaves deceptive relative links as text", () => {
    render(<AiMarkdown content={
      "[Secure](https://example.test/path) [Plain](http://example.test/) [Relative](/settings)"
    } />);

    expect(screen.getByRole("link", { name: "Secure" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Plain" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Relative" })).toBeNull();
    expect(screen.getByText(/\[Relative\]\(\/settings\)/u)).toBeVisible();
  });
});
