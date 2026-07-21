import { useCallback } from "react";

export function useModelFrameReport(
  expectedToken: string | undefined,
  onReady: ((token: string) => void) | undefined,
  onThumbnail: () => void,
) {
  return useCallback((_durationMs: number, token?: string) => {
    if (!token || token !== expectedToken) return;
    onReady?.(token);
    onThumbnail();
  }, [expectedToken, onReady, onThumbnail]);
}
