// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import type { EngineService } from "../../src/application/engine/contracts";
import type { WorkbenchProps } from "../../src/ui/workbench-props";
import { createTestPlatform } from "../helpers/test-platform";

let workbenchProps: WorkbenchProps | undefined;

vi.mock("../../src/ui/Workbench", () => ({
  Workbench: (props: WorkbenchProps) => {
    workbenchProps = props;
    return <div data-testid="workbench" />;
  },
}));

beforeEach(() => {
  workbenchProps = undefined;
});

it("composes storage-independent project portability when IndexedDB is unavailable", () => {
  const engine: EngineService = {
    cancel: vi.fn(),
    export: vi.fn(),
    render: vi.fn(),
    version: vi.fn().mockResolvedValue(null),
  };

  render(<App platform={createTestPlatform(engine, {
    artifactDestination: {
      available: true,
      save: vi.fn().mockResolvedValue({ location: "download.zip" }),
    },
  })} />);

  const portability = workbenchProps?.projectPortability;
  expect(portability).toBeDefined();
  if (!portability) throw new Error("App did not compose project portability.");
  expect(portability.projectImportAvailable).toBe(false);
});
