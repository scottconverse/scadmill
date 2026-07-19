import { useCallback, useEffect, useRef, useState } from "react";

import { projectUsesAnimationTime, usesAnimationTime } from "../../application/animation/animation-source";
import type { ProjectFileContent } from "../../application/files/project-snapshot";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import { messages } from "../../messages/en";
import "./animation-bar.css";

const FRAME_COUNT = 100;
const DEFAULT_FPS = 24;
const MIN_FPS = 1;
const MAX_FPS = 60;

function animationTime(frame: number): number {
  return frame / FRAME_COUNT;
}

function boundedFps(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FPS;
  return Math.max(MIN_FPS, Math.min(MAX_FPS, Math.round(value)));
}

export interface AnimationBarProps {
  readonly documentId: string;
  readonly engineAvailable: boolean;
  readonly entryFile?: string;
  readonly runtime: WorkbenchRuntime;
  readonly source: string;
  readonly sourceFiles?: ReadonlyMap<string, ProjectFileContent>;
}

export function AnimationBar({
  documentId,
  engineAvailable,
  entryFile,
  runtime,
  source,
  sourceFiles,
}: AnimationBarProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fpsRef = useRef(fps);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const previousDocumentId = useRef(documentId);
  const timer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined);
  const visible = entryFile && sourceFiles
    ? projectUsesAnimationTime(entryFile, sourceFiles)
    : usesAnimationTime(source);

  const clearTimer = useCallback(() => {
    if (timer.current !== undefined) globalThis.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const updateBusy = useCallback((next: boolean) => {
    busyRef.current = next;
    setBusy(next);
  }, []);

  const stop = useCallback((cancelActive = true, origin: "system" | "user" = "system") => {
    generation.current += 1;
    clearTimer();
    if (cancelActive && busyRef.current) {
      void runtime.dispatch({ kind: "cancel-animation", origin }).catch((reason: unknown) => {
        if (mounted.current) setError(messages.animationError(reason));
      });
    }
    updateBusy(false);
    setPlaying(false);
  }, [clearTimer, runtime, updateBusy]);

  const renderFrame = useCallback(async (
    nextFrame: number,
    expectedGeneration: number,
    continuePlayback: boolean,
  ) => {
    const startedAt = performance.now();
    updateBusy(true);
    try {
      await runtime.dispatch({
        kind: "render-active",
        origin: "system",
        quality: "preview",
        animationTime: animationTime(nextFrame),
      });
    } catch (reason: unknown) {
      if (mounted.current && generation.current === expectedGeneration) {
        setError(messages.animationError(reason));
        stop(false);
      }
      return;
    } finally {
      if (mounted.current && generation.current === expectedGeneration) updateBusy(false);
    }
    if (!mounted.current || generation.current !== expectedGeneration || !continuePlayback) return;
    const render = runtime.render.getState();
    if (render.status !== "success" || render.quality !== "preview") {
      stop();
      return;
    }
    const remainingDelay = Math.max(0, (1_000 / fpsRef.current) - (performance.now() - startedAt));
    timer.current = globalThis.setTimeout(() => {
      if (!mounted.current || generation.current !== expectedGeneration) return;
      const followingFrame = (nextFrame + 1) % FRAME_COUNT;
      setFrame(followingFrame);
      void renderFrame(followingFrame, expectedGeneration, true);
    }, remainingDelay);
  }, [runtime, stop, updateBusy]);

  const play = useCallback(() => {
    clearTimer();
    setError(undefined);
    const expectedGeneration = ++generation.current;
    setPlaying(true);
    void renderFrame(frame, expectedGeneration, true);
  }, [clearTimer, frame, renderFrame]);

  const scrub = useCallback((nextFrame: number) => {
    const boundedFrame = Math.max(0, Math.min(FRAME_COUNT - 1, Math.round(nextFrame)));
    stop(true, "user");
    setError(undefined);
    const expectedGeneration = generation.current;
    setFrame(boundedFrame);
    void renderFrame(boundedFrame, expectedGeneration, false);
  }, [renderFrame, stop]);

  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);
  useEffect(() => {
    if (previousDocumentId.current === documentId) return;
    previousDocumentId.current = documentId;
    stop();
    updateBusy(false);
    setFrame(0);
  }, [documentId, stop, updateBusy]);
  useEffect(() => {
    if (!engineAvailable || !visible) stop();
  }, [engineAvailable, stop, visible]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      clearTimer();
      if (busyRef.current) void runtime.dispatch({ kind: "cancel-animation", origin: "system" });
    };
  }, [clearTimer, runtime]);

  if (!visible) return null;
  return (
    <section aria-label={messages.animation} className="animation-bar">
      <button
        aria-label={playing ? messages.pauseAnimation : messages.playAnimation}
        disabled={!engineAvailable || (busy && !playing)}
        onClick={playing ? () => stop(true, "user") : play}
        type="button"
      >
        <span aria-hidden="true">{playing ? "Pause" : "Play"}</span>
      </button>
      <label>
        <span>{messages.animationFps}</span>
        <input
          aria-label={messages.animationFps}
          max={MAX_FPS}
          min={MIN_FPS}
          onChange={(event) => setFps(boundedFps(event.currentTarget.valueAsNumber))}
          type="number"
          value={fps}
        />
      </label>
      <label className="animation-scrubber">
        <span>{messages.animationFrame(frame + 1, FRAME_COUNT)}</span>
        <input
          aria-label={messages.animationFrameControl}
          aria-valuetext={messages.animationFrame(frame + 1, FRAME_COUNT)}
          disabled={!engineAvailable}
          max={FRAME_COUNT - 1}
          min={0}
          onChange={(event) => scrub(event.currentTarget.valueAsNumber)}
          step={1}
          type="range"
          value={frame}
        />
      </label>
      <output>{messages.animationTime(animationTime(frame))}</output>
      {error && <p className="animation-error" role="alert">{error}</p>}
    </section>
  );
}
