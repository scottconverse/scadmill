// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePresentationReadiness } from "../../../src/ui/viewer/use-presentation-readiness";

let readiness: ReturnType<typeof usePresentationReadiness>;

function Probe({ skipped = false, token }: { readonly skipped?: boolean; readonly token?: string }) {
  readiness = usePresentationReadiness(token, skipped);
  return <span data-testid="ready">{readiness.presentationStatus}</span>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("usePresentationReadiness", () => {
  it("rejects superseded waiters and ignores stale callbacks", async () => {
    const view = render(<Probe token="presentation-a" />);
    const firstWait = readiness.waitForPresentation("presentation-a");

    view.rerender(<Probe token="presentation-b" />);
    await expect(firstWait).rejects.toThrow("superseded");
    act(() => readiness.onPresentationReady("presentation-a"));
    expect(screen.getByTestId("ready")).toHaveTextContent("presenting");

    act(() => readiness.onPresentationReady("presentation-b"));
    expect(screen.getByTestId("ready")).toHaveTextContent("ready");
    await expect(readiness.waitForPresentation("presentation-b")).resolves.toBeUndefined();
  });

  it("uses a new opaque token when geometry returns after an intervening presentation", () => {
    const view = render(<Probe token="geometry-x-at-1" />);
    act(() => readiness.onPresentationReady("geometry-x-at-1"));
    expect(screen.getByTestId("ready")).toHaveTextContent("ready");

    view.rerender(<Probe token="geometry-y-at-2" />);
    act(() => readiness.onPresentationReady("geometry-y-at-2"));
    view.rerender(<Probe token="geometry-x-at-3" />);

    expect(screen.getByTestId("ready")).toHaveTextContent("presenting");
    act(() => readiness.onPresentationReady("geometry-x-at-3"));
    expect(screen.getByTestId("ready")).toHaveTextContent("ready");
  });

  it("does not reuse readiness when a token returns before the intervening token is ready", () => {
    const view = render(<Probe token="presentation-x" />);
    act(() => readiness.onPresentationReady("presentation-x"));
    view.rerender(<Probe token="presentation-y" />);
    view.rerender(<Probe token="presentation-x" />);

    expect(screen.getByTestId("ready")).toHaveTextContent("presenting");
  });

  it("terminates a failed presentation and rejects its waiter", async () => {
    render(<Probe token="failed-presentation" />);
    const pending = readiness.waitForPresentation("failed-presentation");
    const rejected = expect(pending).rejects.toThrow("could not be presented");

    act(() => readiness.onPresentationFailed("failed-presentation"));

    expect(screen.getByTestId("ready")).toHaveTextContent("failed");
    await rejected;
  });

  it("treats a pinned viewer-mode mismatch as a disclosed terminal skip", async () => {
    render(<Probe skipped token="hidden-presentation" />);

    expect(screen.getByTestId("ready")).toHaveTextContent("skipped");
    await expect(readiness.waitForPresentation("hidden-presentation")).resolves.toBeUndefined();
  });

  it("requires a fresh frame after a ready presentation is hidden and shown again", () => {
    const view = render(<Probe token="mode-toggled-presentation" />);
    act(() => readiness.onPresentationReady("mode-toggled-presentation"));
    expect(screen.getByTestId("ready")).toHaveTextContent("ready");

    view.rerender(<Probe skipped token="mode-toggled-presentation" />);
    expect(screen.getByTestId("ready")).toHaveTextContent("skipped");
    view.rerender(<Probe token="mode-toggled-presentation" />);

    expect(screen.getByTestId("ready")).toHaveTextContent("presenting");
  });

  it("rejects promptly when a caller aborts or the viewer unmounts", async () => {
    const view = render(<Probe token="abortable-presentation" />);
    const controller = new AbortController();
    const aborted = readiness.waitForPresentation("abortable-presentation", controller.signal);
    const abortedRejection = expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await abortedRejection;

    const unmounted = readiness.waitForPresentation("abortable-presentation");
    const unmountedRejection = expect(unmounted).rejects.toMatchObject({ name: "AbortError" });
    view.unmount();
    await unmountedRejection;
  });

  it("fails closed after the bounded presentation timeout", async () => {
    vi.useFakeTimers();
    render(<Probe token="timed-out-presentation" />);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(screen.getByTestId("ready")).toHaveTextContent("failed");
    act(() => readiness.onPresentationReady("timed-out-presentation"));
    expect(screen.getByTestId("ready")).toHaveTextContent("failed");
  });
});
