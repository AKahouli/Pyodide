import { useEffect, useState } from 'react';

const STORAGE_KEY = 'yellowmind.home.motion';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

export function useHomeMotion() {
  const [override, setOverride] = useState<boolean | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'on' ? true : saved === 'off' ? false : null;
    } catch {
      return null; // Storage may be unavailable; the system preference still applies.
    }
  });
  const [reduced, setReduced] = useState(() => window.matchMedia?.(REDUCED_MOTION).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(REDUCED_MOTION);
    if (!media) return;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const enabled = override ?? !reduced;
  const toggle = () => {
    const next = !enabled;
    setOverride(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
    } catch {
      // The control continues to work for this visit without persistence.
    }
  };
  return { enabled, toggle };
}
