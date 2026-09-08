import { useLayoutEffect } from 'react';
import { useConversationStore } from '../store';

/**
 * One-shot first-paint observer for the conversation latency instrumentation.
 *
 * `useLayoutEffect` runs after the DOM commit that applied the first
 * model-derived chunk; the double `requestAnimationFrame` approximates the
 * first paint opportunity having passed. Hidden tabs are skipped because
 * browsers throttle animation frames there, which would skew the metric.
 */
export function useLatencyPaintObserver(): void {
  const pending = useConversationStore((s) => s.pendingLatencyPaint);
  const recordLatencyFirstPaint = useConversationStore((s) => s.recordLatencyFirstPaint);

  useLayoutEffect(() => {
    if (!pending || pending.measured) return;
    if (document.visibilityState !== 'visible') return;

    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        recordLatencyFirstPaint();
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [pending, recordLatencyFirstPaint]);
}
