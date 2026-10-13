import { useEffect, useState } from 'react';

const TICK_MS = 1000;

/**
 * Whole seconds elapsed since `active` became true; 0 while inactive. The
 * counter restarts each time the hook is re-activated.
 */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setSeconds(0);
    const interval = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / TICK_MS));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [active]);

  return seconds;
}
