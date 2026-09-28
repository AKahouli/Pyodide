import { useCallback, useEffect, useRef } from 'react';

/**
 * Shared setTimeout debounce plumbing: one pending-timer ref with
 * schedule/cancel. The timer is cleared on unmount. Callers keep their
 * own delay computation (fixed or adaptive) and callback logic.
 */
export function useDebouncedCallback() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (callback: () => void, delayMs: number) => {
      cancel();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callback();
      }, delayMs);
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);

  return { schedule, cancel };
}
