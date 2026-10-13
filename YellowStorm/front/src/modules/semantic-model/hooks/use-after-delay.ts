import { useEffect, useState } from 'react';

/** True once `active` has stayed true for `delayMs` without a break; false again as soon as it ends. */
export function useAfterDelay(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    setElapsed(false);
    if (!active) return undefined;
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && elapsed;
}
