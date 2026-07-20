import { useCallback, useEffect, useRef } from "react";

import type { ModelMeshParser } from "./model-viewer-defaults";
import { createDefaultMeshParser } from "./model-viewer-defaults";

export function useMeshParser(supplied?: ModelMeshParser): ModelMeshParser {
  const owned = useRef<ReturnType<typeof createDefaultMeshParser> | null>(null);
  const parseOwned = useCallback<ModelMeshParser>((bytes, signal) => {
    owned.current ??= createDefaultMeshParser();
    return owned.current.parse(bytes, signal);
  }, []);
  useEffect(() => () => {
    owned.current?.dispose();
    owned.current = null;
  }, []);
  return supplied ?? parseOwned;
}
