import { useState, useEffect, useRef } from 'react';

/**
 * Hook for character-by-character typing animation.
 * Returns a progressively longer substring of the full text.
 *
 * @param fullText - The complete text to reveal
 * @param speed - Milliseconds per character (default 15ms)
 * @param enabled - Whether animation is active (default true)
 * @returns The currently visible portion of the text
 */
export function useTypingAnimation(fullText: string, speed = 15, enabled = true): string {
  const [visibleLength, setVisibleLength] = useState(0);
  const prevTextRef = useRef('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setVisibleLength(fullText.length);
      return;
    }

    // If text grew (new chunk appended), keep current position and continue
    if (fullText.startsWith(prevTextRef.current)) {
      // Text extended - continue from where we are
    } else {
      // Text completely changed - reset
      setVisibleLength(0);
    }

    prevTextRef.current = fullText;

    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Start revealing characters
    intervalRef.current = setInterval(() => {
      setVisibleLength((prev) => {
        if (prev >= fullText.length) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return prev;
        }
        // Batch reveal if we're far behind (catch up quickly)
        const remaining = fullText.length - prev;
        const batchSize = remaining > 50 ? Math.ceil(remaining / 10) : 1;
        return Math.min(prev + batchSize, fullText.length);
      });
    }, speed);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fullText, speed, enabled]);

  return fullText.slice(0, visibleLength);
}
