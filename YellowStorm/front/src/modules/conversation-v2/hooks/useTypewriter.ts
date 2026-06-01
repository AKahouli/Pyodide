import { useEffect, useState } from 'react';

/**
 * Animate `text` character by character. Pass `null` to reset.
 * Fires `onComplete` once the full string is displayed.
 */
export function useTypewriter(
  text: string | null,
  speed = 30,
  onComplete?: () => void,
): string {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    if (!text) {
      setDisplayed('');
      return;
    }
    setDisplayed('');
    let i = 0;
    const interval = setInterval(() => {
      if (i < text.length) {
        setDisplayed(text.slice(0, i + 1));
        i++;
      } else {
        clearInterval(interval);
        onComplete?.();
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed, onComplete]);

  return displayed;
}
