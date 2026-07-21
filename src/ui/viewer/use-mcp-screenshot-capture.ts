import { type RefObject, useCallback, useEffect } from "react";

import type { ModelViewerHandle } from "./ModelViewer";

export type McpScreenshotCapture = (width: number, height: number) => Promise<Uint8Array>;

export function useMcpScreenshotCapture(
  viewer: RefObject<ModelViewerHandle | null>,
  visibleKind: "2d" | "3d" | undefined,
  onAvailable: ((capture: McpScreenshotCapture | undefined) => void) | undefined,
) {
  const capture = useCallback(async (width: number, height: number) => {
    if (visibleKind !== "3d") throw new Error("The current model viewport is unavailable.");
    const capturePng = viewer.current?.capturePng;
    if (!capturePng) throw new Error("The current model viewport is unavailable.");
    return capturePng(width, height);
  }, [viewer, visibleKind]);
  useEffect(() => {
    onAvailable?.(visibleKind === "3d" ? capture : undefined);
    return () => onAvailable?.(undefined);
  }, [capture, onAvailable, visibleKind]);
}
