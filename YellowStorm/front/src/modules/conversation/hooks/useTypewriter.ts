import { useState, useEffect, useCallback } from 'react';

/**
 * Hook that creates a typewriter effect for displaying text character by character.
 *
 * @param text - The text to animate (null to clear/reset)
 * @param speed - Milliseconds between each character (default: 30ms)
 * @param onComplete - Callback fired when animation completes
 * @returns The currently displayed text
 */
export function useTypewriter(text: string | null, speed: number = 30, onComplete?: () => void): string {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    if (!text) {
      setDisplayedText('');
      return;
    }

    setDisplayedText('');
    let index = 0;

    const interval = setInterval(() => {
      if (index < text.length) {
        setDisplayedText(text.slice(0, index + 1));
        index++;
      } else {
        clearInterval(interval);
        onComplete?.();
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed, onComplete]);

  return displayedText;
}
