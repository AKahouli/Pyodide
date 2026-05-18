import { useCallback, useState } from 'react';

import { useAgentStore } from '../store';

export interface UseAgentBulkDeleteResult {
  inFlight: boolean;
  done: number;
  total: number;
  runBulkDelete: (ids: string[]) => Promise<void>;
}

export function useAgentBulkDelete(onComplete?: () => void): UseAgentBulkDeleteResult {
  const bulkDeleteAgents = useAgentStore((s) => s.bulkDeleteAgents);

  const [inFlight, setInFlight] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  const runBulkDelete = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0 || inFlight) return;
      setInFlight(true);
      setDone(0);
      setTotal(ids.length);
      try {
        await bulkDeleteAgents(ids, (d, t) => {
          setDone(d);
          setTotal(t);
        });
      } finally {
        setInFlight(false);
        setDone(0);
        setTotal(0);
        onComplete?.();
      }
    },
    [bulkDeleteAgents, inFlight, onComplete],
  );

  return { inFlight, done, total, runBulkDelete };
}
