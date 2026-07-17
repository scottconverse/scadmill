// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiMarkdown } from "../../../src/ui/ai/AiMarkdown";

describe("AiMarkdown", () => {
  it("renders prose and fenced code without interpreting HTML", () => {
    render(<AiMarkdown content={'Use **this**.\n```scad\ncube(10);\n```\nDone.'} />);
    expect(screen.getByText("Use **this**.")).toBeVisible();
    expect(screen.getByText("cube(10);", { exact: false })).toBeVisible();
    expect(screen.getByText("Done.")).toBeVisible();
  });
});
