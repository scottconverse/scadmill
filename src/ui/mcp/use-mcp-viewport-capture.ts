import { useCallback, useRef } from "react";

export type McpViewportCapture = (width: number, height: number) => Promise<Uint8Array>;

export function useMcpViewportCapture() {
  const registeredCapture = useRef<McpViewportCapture | undefined>(undefined);
  const setCapture = useCallback((capture: McpViewportCapture | undefined) => {
    registeredCapture.current = capture;
  }, []);
  const capture = useCallback(async (width: number, height: number) => {
    if (!registeredCapture.current) throw new Error("The current viewport is unavailable for capture.");
    return registeredCapture.current(width, height);
  }, []);
  return { capture, setCapture };
}
