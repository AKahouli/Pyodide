import { useEffect, useRef } from 'react';
import { useSidebar } from '@/components/ui/sidebar';

/** Below this width the rail auto-collapses; above it, it auto-expands. */
const COLLAPSE_BREAKPOINT = 1024;

/**
 * Keeps the responsive breakpoint and the manual toggle on the same `open`
 * state: crossing the breakpoint sets the same state the toggle uses.
 *
 * `setOpen` is not identity-stable across toggles, so the listener is
 * registered once and reads the latest setter through a ref — otherwise the
 * effect would re-run after every toggle and undo the user's choice.
 */
export function useAutoCollapse() {
  const { isMobile, state, setOpen, toggleSidebar } = useSidebar();
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  useEffect(() => {
    const below = () => window.innerWidth < COLLAPSE_BREAKPOINT;
    // First load: a persisted preference wins; otherwise apply the breakpoint.
    const hasPersistedState =
      typeof document !== 'undefined' && /(?:^|;\s*)sidebar_state=/.test(document.cookie);
    if (!hasPersistedState) setOpenRef.current(!below());

    let prevBelow = below();
    const handleResize = () => {
      const nowBelow = below();
      if (nowBelow !== prevBelow) {
        prevBelow = nowBelow;
        setOpenRef.current(!nowBelow);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return { isMobile, state, setOpen, toggleSidebar };
}
