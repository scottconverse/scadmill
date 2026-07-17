// @vitest-environment happy-dom
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  AssociatedFileOpenRequest,
  AssociatedFileOpenSource,
} from "../../../src/application/platform/scadmill-platform";
import { useProjectOpenQueue } from "../../../src/ui/files/use-project-open-queue";

function sourceFixture() {
  let onRequest: ((request: AssociatedFileOpenRequest) => void) | undefined;
  let onError: ((message: string) => void) | undefined;
  const source: AssociatedFileOpenSource = {
    subscribe(listener) { onRequest = listener; return () => { onRequest = undefined; }; },
    subscribeErrors(listener) { onError = listener; return () => { onError = undefined; }; },
  };
  return {
    source,
    request: (request: AssociatedFileOpenRequest) => onRequest?.(request),
    error: (message: string) => onError?.(message),
  };
}

function Harness({ source }: { readonly source: AssociatedFileOpenSource }) {
  const queue = useProjectOpenQueue(source);
  return (
    <div>
      {queue.error && <p role="alert">{queue.error}</p>}
      {queue.request && <p>{queue.request.preferredEntryFile}</p>}
      <button onClick={queue.dismissError} type="button">Dismiss</button>
      <button onClick={() => queue.request && queue.settle(queue.request.sequence)} type="button">Settle</button>
    </div>
  );
}

describe("useProjectOpenQueue", () => {
  it("clears a stale bridge error on valid activity, settlement, or explicit dismissal", () => {
    const fixture = sourceFixture();
    const view = render(<Harness source={fixture.source} />);

    act(() => fixture.error("bridge failed"));
    expect(view.getByRole("alert")).toHaveTextContent("bridge failed");
    act(() => fixture.request({ projectId: "C:\\models", displayName: "models", entryFile: "main.scad" }));
    expect(view.queryByRole("alert")).not.toBeInTheDocument();

    act(() => fixture.error("bridge failed again"));
    fireEvent.click(view.getByRole("button", { name: "Settle" }));
    expect(view.queryByRole("alert")).not.toBeInTheDocument();

    act(() => fixture.error("last failure"));
    fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
  });
});
