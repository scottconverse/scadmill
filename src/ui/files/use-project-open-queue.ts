import { useCallback, useEffect, useRef, useState } from "react";

import type { AssociatedFileOpenSource } from "../../application/platform/scadmill-platform";
import type { ProjectOpenRequest } from "./ProjectLifecycleControls";

export function useProjectOpenQueue(source?: AssociatedFileOpenSource) {
  const [requests, setRequests] = useState<readonly ProjectOpenRequest[]>([]);
  const [error, setError] = useState<string>();
  const sequence = useRef(0);
  const enqueue = useCallback((request: Omit<ProjectOpenRequest, "sequence">) => {
    const queued = { ...request, sequence: ++sequence.current };
    setError(undefined);
    setRequests((current) => [...current, queued]);
  }, []);
  const settle = useCallback((requestSequence: number) => {
    setError(undefined);
    setRequests((current) => current[0]?.sequence === requestSequence
      ? current.slice(1)
      : current.filter((request) => request.sequence !== requestSequence));
  }, []);
  useEffect(() => source?.subscribe((request) => enqueue({
    projectId: request.projectId,
    displayName: request.displayName,
    preferredEntryFile: request.entryFile,
    openWhenClean: true,
  })), [enqueue, source]);
  useEffect(() => source?.subscribeErrors(setError), [source]);
  const dismissError = useCallback(() => setError(undefined), []);
  return { dismissError, enqueue, error, request: requests[0], settle } as const;
}
